# or-cost

OpenRouter model cost comparison + spend visibility CLI/dashboard.

`or-cost` answers two questions: what does each model on OpenRouter actually cost, and what has my
key spent. The catalog side — comparing prices across every model OpenRouter lists, ranking them,
estimating a workload — needs **no API key at all**, because `GET /api/v1/models` is a public
endpoint. Only the `spend` command talks to an authenticated endpoint.

Zero runtime dependencies. Node 22+, native `fetch`, `node:http`. MIT.

## Install

```bash
git clone https://github.com/shoemoney/or-cost.git
cd or-cost
npm install
npm run build
node dist/cli.js models --limit 12
```

Or link it onto your PATH so the `or-cost` bin works anywhere:

```bash
npm link
or-cost models --provider anthropic
```

An API key is only needed for `spend` (and for the spend panel of `serve`):

```bash
export OPENROUTER_API_KEY=sk-or-...
```

## Usage

### models — compare prices across the catalog

```bash
or-cost models                                  # cheapest 30 by blended cost
or-cost models --provider anthropic             # one author/org
or-cost models --search sonnet                  # substring match on id or name
or-cost models --sort output --desc             # blended | input | output | context | name
or-cost models --max-price 2 --limit 0          # everything under $2/1M blended, no row cap
or-cost models --free                           # only $0 models
or-cost models --input-ratio 1                  # weight input and output equally
or-cost models --no-cache --json                # skip the disk cache, emit JSON
```

### estimate — cost of a concrete workload

Takes prompt tokens and completion tokens as positional arguments, then applies the same filters
as `models`.

```bash
or-cost estimate 100000 20000                   # 100K in, 20K out, cheapest 30 models (--limit 0 for all)
or-cost estimate 100000 20000 --provider openai --limit 10
or-cost estimate 8000 2000 --max-price 5 --json
```

### spend — key usage and per-generation breakdown

Requires `OPENROUTER_API_KEY`. Prints key label, usage, credit limit, remaining, and tier.
OpenRouter has no public "list all my generations" endpoint, so a per-model breakdown is built from
generation ids you already hold (from your own logs, or from the `id` on a chat completion response)
and pass in with `--ids`.

```bash
or-cost spend                                   # key usage summary only
or-cost spend --ids gen-abc,gen-def             # + per-model breakdown for those generations
or-cost spend --json
```

### serve — local dashboard

Serves the catalog view at `/`, the spend view at `/spend`, and the model list as JSON at
`/api/models`. Binds `127.0.0.1` only; no key is required to browse the catalog.

```bash
or-cost serve                                   # http://localhost:7777
or-cost serve --port 8080
```

## Sample output

Captured from real runs against the live public catalog.

`or-cost models --limit 12`

```
MODEL                                               PROVIDER     IN /1M  OUT /1M  BLENDED  CONTEXT
--------------------------------------------------  -----------  ------  -------  -------  -------
cohere/north-mini-code:free                         cohere         free     free     free     256K
google/gemma-4-26b-a4b-it:free                      google         free     free     free   262.1K
google/gemma-4-31b-it:free                          google         free     free     free   262.1K
google/lyria-3-clip-preview                         google         free     free     free     1.0M
google/lyria-3-pro-preview                          google         free     free     free     1.0M
inclusionai/ling-3.0-flash:free                     inclusionai    free     free     free   262.1K
nvidia/nemotron-3-nano-30b-a3b:free                 nvidia         free     free     free     256K
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free  nvidia         free     free     free     256K
nvidia/nemotron-3-super-120b-a12b:free              nvidia         free     free     free   262.1K
nvidia/nemotron-3-ultra-550b-a55b:free              nvidia         free     free     free       1M
nvidia/nemotron-3.5-content-safety:free             nvidia         free     free     free     128K
nvidia/nemotron-nano-12b-v2-vl:free                 nvidia         free     free     free     128K
```

`or-cost models --provider anthropic --limit 8`

```
MODEL                        PROVIDER   IN /1M  OUT /1M  BLENDED  CONTEXT
---------------------------  ---------  ------  -------  -------  -------
anthropic/claude-3-haiku     anthropic  $0.250    $1.25   $0.500     200K
anthropic/claude-haiku-4.5   anthropic   $1.00    $5.00    $2.00     200K
anthropic/claude-sonnet-5    anthropic   $2.00   $10.00    $4.00       1M
anthropic/claude-sonnet-4    anthropic   $3.00   $15.00    $6.00       1M
anthropic/claude-sonnet-4.5  anthropic   $3.00   $15.00    $6.00       1M
anthropic/claude-sonnet-4.6  anthropic   $3.00   $15.00    $6.00       1M
anthropic/claude-opus-4.5    anthropic   $5.00   $25.00   $10.00     200K
anthropic/claude-opus-4.6    anthropic   $5.00   $25.00   $10.00       1M
```

`or-cost estimate 100000 20000 --limit 8`

```
MODEL                                               COST (100000 in / 20000 out)
--------------------------------------------------  ----------------------------
cohere/north-mini-code:free                                                 free
google/gemma-4-26b-a4b-it:free                                              free
google/gemma-4-31b-it:free                                                  free
google/lyria-3-clip-preview                                                 free
google/lyria-3-pro-preview                                                  free
inclusionai/ling-3.0-flash:free                                             free
nvidia/nemotron-3-nano-30b-a3b:free                                         free
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free                          free
```

Sorting is cheapest-first, so the free tier fills the top. Add `--max-price`, `--provider`, or
`--desc` to see the other end of the range.

Two caveats visible in that first table. `google/lyria-3-*` are billed **per second of audio**, and
OpenRouter publishes their per-token rates as `0` — or-cost reports what the API publishes, so they
read as `free` even though they are paid models. Where OpenRouter instead publishes `-1` ("variable"),
or-cost prints `n/a` and never $0:

```
MODEL                   PROVIDER    IN /1M  OUT /1M  BLENDED  CONTEXT
----------------------  ----------  ------  -------  -------  -------
openrouter/free         openrouter    free     free     free     200K
openrouter/auto         openrouter     n/a      n/a      n/a       2M
openrouter/auto-beta    openrouter     n/a      n/a      n/a       2M
openrouter/bodybuilder  openrouter     n/a      n/a      n/a     128K
```

`or-cost help`

```
or-cost — OpenRouter model cost comparison + spend visibility

Usage:
  or-cost models [options]            Compare model prices (no API key needed)
  or-cost spend [--ids a,b,c]         Show key usage + per-model breakdown
  or-cost estimate <in> <out> [opts]  Cost of a workload across models
  or-cost serve [--port 7777]         Local dashboard for both views

Options:
  --provider <slug>   Filter to one author/org (anthropic, openai, ...)
  --search <text>     Substring match on model id or name
  --sort <key>        blended | input | output | context | name   (default: blended)
  --desc              Reverse the sort
  --limit <n>         Cap rows (default: 30, 0 for all)
  --max-price <usd>   Drop models above this blended cost per 1M
  --free              Only $0 models
  --input-ratio <n>   Input:output weighting for blended cost (default: 3)
  --no-cache          Bypass the 1-hour catalog cache
  --json              Machine-readable output
  --port <n>          Port for serve (default: 7777)

Environment:
  OPENROUTER_API_KEY  Required for 'spend' only. Never written to disk.
```

### spend output shape

Not run here — it needs a live key. This is the shape the code emits, as an example:

```
Key:       production-gateway
Usage:     $412.8830
Limit:     $1000.00
Remaining: $587.12
Tier:      paid

MODEL                        CALLS  PROMPT  COMPLETION     COST
---------------------------  -----  ------  ----------  -------
anthropic/claude-sonnet-4.5      3   48.2K        6.1K  $0.2361
openai/gpt-4.1-mini              5   12.0K        2.4K  $0.0087

Total: $0.2448
```

With no `--ids`, the key summary prints and the breakdown is replaced by a hint showing the
`--ids` form.

## How blended cost works

Models publish two prices — input and output per token — which makes ranking awkward: a model can be
cheap to read and expensive to write. `or-cost` collapses them into one comparable number:

```
blended = (input × ratio + output) / (ratio + 1)
```

The default ratio is **3**, i.e. 3 input tokens per 1 output token, which is the rough shape of most
real traffic (long context and system prompts in, short answers out). The weights are normalized, so
a model that charges the same for input and output blends to exactly that price. Change the
assumption with `--input-ratio` — `--input-ratio 1` weights them equally, a high ratio models
retrieval-heavy workloads, `--input-ratio 0` ranks purely on output price.

**This is a ranking heuristic, not a billing figure.** It does not know your actual traffic mix, and
it ignores cached input, image, and request pricing. Models with no comparable per-token price —
OpenRouter publishes `-1` for variable pricing (`openrouter/auto` and friends), and models billed per
second or per image carry no prompt/completion rate — render as `n/a`, not `free`. They are excluded
from `--free` and from `--max-price`, and they sort last on any price sort, so an unknown cost is
never presented as $0. For a number tied to real usage, use
`estimate <in> <out>` with your own token counts, or `spend` with real generation ids.

## Rate limits and caching

The model catalog is fetched once and cached on disk for **1 hour**, in `or-cost/models.json` under
the OS temp directory. Every subsequent `models`, `estimate`, or `serve` run reads the cache, so
filtering and re-sorting the catalog costs zero API calls. Pass `--no-cache` to force a fresh fetch.

On `429` or any `5xx`, requests are attempted up to 4 times (3 retries, backing off 1s, 2s, 4s), honoring
the `Retry-After` header when the server sends one. Other 4xx responses fail immediately — retrying a
bad key just burns the limit faster.

A cost tool that hammers the API is the joke that writes itself. Being polite to the endpoint is part
of the product.

## Why this matters

Rolling an LLM gateway out across an organization turns model choice into a budget decision, and
budget decisions need a paper trail before finance or security signs off. The questions that stall a
rollout are always the same three: which team spent what, on which model, against whose budget.
Answering them after the invoice arrives is too late — by then the spend is already committed and the
conversation is a post-mortem instead of a control.

`or-cost` covers the front half of that. The catalog view makes the price delta between models legible
before anyone commits to one: swapping a mid-tier model for a frontier model on a high-volume path can
move a monthly bill by an order of magnitude, and that comparison should take seconds, not a
spreadsheet. `estimate` turns a proposed workload into a dollar figure per model, which is the number a
team lead can actually defend in a planning meeting. `spend` reports what a key has drawn against its
limit, which is the baseline any guardrail needs — you cannot set a threshold on a number nobody
measures.

This is written from both sides of that table: as the security reviewer asking a vendor where the spend
data lives and who can see it, and as the founder answering. Cost attribution is not a reporting
feature bolted on at the end. It is the thing that decides whether the rollout gets approved.

## Security

- The API key is read from `OPENROUTER_API_KEY` and nowhere else. There is no config file, no
  credential prompt, no key argument.
- The key is never written to disk and never logged. It is sent only as a `Bearer` header to
  `openrouter.ai`.
- The only thing cached on disk is the public model catalog — the same data anyone can fetch
  unauthenticated from `GET /api/v1/models`. No usage data, no key data, no request bodies.
- `serve` binds `127.0.0.1` (loopback) only — the spend view is never exposed to the LAN — and
  renders every dynamic value through HTML escaping.

## Development

```bash
npm test         # vitest
npm run typecheck
npm run build    # tsc -> dist/
```

TypeScript strict mode, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
`verbatimModuleSyntax`. ESM throughout, so relative imports carry the `.js` extension. Dev
dependencies are `typescript`, `vitest`, and `@types/node` — there are no runtime dependencies, and
adding one should be treated as a design failure.

## License

MIT.
