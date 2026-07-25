import { createServer } from "node:http";
import { fetchKeyInfo, fetchModels } from "./client.js";
import { isSortKey, SORT_KEYS, selectModels } from "./pricing.js";
import { formatTokens, formatUsd } from "./table.js";
import type { KeyInfo, Model } from "./types.js";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

const STYLE = `
:root { color-scheme: light dark; --fg: #111; --muted: #666; --line: #ddd; --bg: #fff; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6e6e6; --muted: #999; --line: #333; --bg: #131313; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem 1.5rem; background: var(--bg); color: var(--fg);
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
main { max-width: 1000px; margin: 0 auto; }
h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
p.sub { color: var(--muted); margin: 0 0 1.5rem; }
nav a { margin-right: 1rem; color: inherit; }
form { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: 1rem; }
input, select, button { padding: .4rem .6rem; border: 1px solid var(--line);
  border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; }
.wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { padding: .5rem .75rem; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
.card { border: 1px solid var(--line); border-radius: 8px; padding: 1rem; }
.card .label { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
.card .value { font-size: 1.5rem; font-variant-numeric: tabular-nums; }
footer { color: var(--muted); font-size: .85rem; margin-top: 2rem; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — or-cost</title><style>${STYLE}</style></head>
<body><main>
<h1>or-cost</h1>
<p class="sub">OpenRouter model cost comparison + spend visibility</p>
<nav><a href="/">Catalog</a><a href="/spend">Spend</a></nav>
${body}
<footer>Catalog cached for 1 hour. Prices are USD per 1M tokens, as published by OpenRouter.</footer>
</main></body></html>`;
}

function catalogView(models: readonly Model[], q: URLSearchParams): string {
  const provider = q.get("provider") ?? "";
  const search = q.get("q") ?? "";
  const raw = q.get("sort") ?? "blended";
  const sort = isSortKey(raw) ? raw : "blended";
  const rows = selectModels(models, {
    provider: provider || undefined,
    search: search || undefined,
    sort,
    limit: 200,
  });
  const providers = [...new Set(models.map((m) => m.provider))].sort();

  const options = (sel: string, values: readonly string[], blank: string): string =>
    [`<option value="">${escapeHtml(blank)}</option>`,
      ...values.map(
        (v) => `<option value="${escapeHtml(v)}"${v === sel ? " selected" : ""}>${escapeHtml(v)}</option>`,
      )].join("");

  return `<form method="get">
<input name="q" placeholder="Search models" value="${escapeHtml(search)}">
<select name="provider">${options(provider, providers, "All providers")}</select>
<select name="sort">${options(sort, SORT_KEYS, "Sort: blended")}</select>
<button type="submit">Apply</button></form>
<div class="wrap"><table><thead><tr>
<th>Model</th><th>Provider</th><th class="num">In /1M</th><th class="num">Out /1M</th>
<th class="num">Blended</th><th class="num">Context</th></tr></thead><tbody>
${rows
  .map(
    (m) => `<tr><td>${escapeHtml(m.id)}</td><td>${escapeHtml(m.provider)}</td>
<td class="num">${formatUsd(m.inputPerM)}</td><td class="num">${formatUsd(m.outputPerM)}</td>
<td class="num">${formatUsd(m.blendedPerM)}</td><td class="num">${formatTokens(m.contextLength)}</td></tr>`,
  )
  .join("")}
</tbody></table></div>
<p class="sub">${rows.length} of ${models.length} models shown.</p>`;
}

function card(label: string, value: string): string {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

export function spendView(key: KeyInfo | null): string {
  if (key === null) {
    return `<p>Set <code>OPENROUTER_API_KEY</code> and restart to see spend for your key. No key is read from disk or sent anywhere but openrouter.ai.</p>`;
  }
  const remaining = key.limitRemaining === null ? "unlimited" : `$${key.limitRemaining.toFixed(2)}`;
  const limit = key.limit === null ? "unlimited" : `$${key.limit.toFixed(2)}`;
  return `<div class="cards">
${card("Key", key.label)}
${card("Usage", `$${key.usage.toFixed(4)}`)}
${card("Credit limit", limit)}
${card("Remaining", remaining)}
${card("Tier", key.isFreeTier ? "free" : "paid")}
</div>
<p class="sub">Per-generation breakdown is available from the CLI:
<code>or-cost spend --ids &lt;generation-id&gt;,&lt;generation-id&gt;</code></p>`;
}

export async function serve(port: number, apiKey: string | undefined): Promise<void> {
  const models = await fetchModels();

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        if (url.pathname === "/api/models") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(selectModels(models, { sort: "blended" })));
          return;
        }
        if (url.pathname === "/spend") {
          let body: string;
          try {
            body = spendView(apiKey === undefined ? null : await fetchKeyInfo(apiKey));
          } catch (err) {
            body = `<p>Could not read key info: ${escapeHtml((err as Error).message)}</p>`;
          }
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(page("Spend", body));
          return;
        }
        if (url.pathname === "/") {
          // Render before committing headers, so a throw can still become a 500.
          const html = page("Catalog", catalogView(models, url.searchParams));
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(html);
          return;
        }
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      } catch (err) {
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
        res.end(`error: ${(err as Error).message}`);
      }
    })();
  });

  // Loopback only: the spend view renders key label, usage, and remaining credit.
  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(`port ${port} is already in use — try --port <other>`)
          : err,
      );
    });
    server.listen(port, "127.0.0.1", resolve);
  });
  process.stdout.write(`or-cost dashboard on http://localhost:${port}\n`);
  if (apiKey === undefined) {
    process.stdout.write("  (no OPENROUTER_API_KEY — spend view will be empty)\n");
  }
}
