#!/usr/bin/env node
import { fetchGenerations, fetchKeyInfo, fetchModels } from "./client.js";
import { estimateCost, isSortKey, SORT_KEYS, selectModels, summarizeSpend } from "./pricing.js";
import { formatUsd, modelTable, renderTable, spendTable } from "./table.js";
import { serve } from "./server.js";

const USAGE = `or-cost — OpenRouter model cost comparison + spend visibility

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
`;

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

/** Flags that never take a value, so they can't swallow the next positional. */
const BOOLEAN_FLAGS = new Set(["desc", "free", "json", "no-cache", "help"]);

export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (!BOOLEAN_FLAGS.has(name) && next !== undefined && !next.startsWith("--")) {
      flags.set(arg.slice(2), next);
      i++;
    } else {
      flags.set(arg.slice(2), true);
    }
  }
  return { command: positional.shift() ?? "models", positional, flags };
}

const str = (f: Args["flags"], k: string): string | undefined => {
  const v = f.get(k);
  return typeof v === "string" ? v : undefined;
};
const num = (f: Args["flags"], k: string): number | undefined => {
  const v = str(f, k);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`--${k} ${v}: expected a number`);
  return n;
};
const bool = (f: Args["flags"], k: string): boolean => f.get(k) === true || f.get(k) === "true";

function fail(message: string): never {
  process.stderr.write(`or-cost: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || bool(flags, "help")) {
    process.stdout.write(USAGE);
    return;
  }

  const json = bool(flags, "json");
  const catalogOpts = {
    ...(num(flags, "input-ratio") !== undefined ? { inputRatio: num(flags, "input-ratio") } : {}),
    noCache: bool(flags, "no-cache"),
  };
  const sortFlag = str(flags, "sort");
  if (sortFlag !== undefined && !isSortKey(sortFlag)) {
    fail(`unknown sort key '${sortFlag}'. Valid: ${SORT_KEYS.join(", ")}`);
  }
  const filters = {
    provider: str(flags, "provider"),
    search: str(flags, "search"),
    sort: sortFlag,
    desc: bool(flags, "desc"),
    maxPrice: num(flags, "max-price"),
    freeOnly: bool(flags, "free"),
    limit: num(flags, "limit") ?? 30,
  };

  switch (command) {
    case "models": {
      const models = selectModels(await fetchModels(catalogOpts), filters);
      process.stdout.write(json ? `${JSON.stringify(models, null, 2)}\n` : `${modelTable(models)}\n`);
      return;
    }

    case "estimate": {
      const promptTokens = Number(positional[0]);
      const completionTokens = Number(positional[1]);
      if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
        fail("estimate needs two token counts, e.g. `or-cost estimate 100000 20000`");
      }
      const models = selectModels(await fetchModels(catalogOpts), filters);
      const rows = models
        .map((m) => ({ model: m.id, cost: estimateCost(m, promptTokens, completionTokens) }))
        .sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity));
      if (json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        `${renderTable(
          ["MODEL", `COST (${promptTokens} in / ${completionTokens} out)`],
          rows.map((r) => [r.model, formatUsd(r.cost)]),
          ["left", "right"],
        )}\n`,
      );
      return;
    }

    case "spend": {
      const apiKey = process.env["OPENROUTER_API_KEY"];
      if (apiKey === undefined || apiKey === "") {
        fail("OPENROUTER_API_KEY is not set — see .env.example");
      }
      const key = await fetchKeyInfo(apiKey);
      const ids = (str(flags, "ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const rows = ids.length > 0 ? summarizeSpend(await fetchGenerations(apiKey, ids)) : [];

      if (json) {
        process.stdout.write(`${JSON.stringify({ key, breakdown: rows }, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        `Key:       ${key.label}\n` +
          `Usage:     $${key.usage.toFixed(4)}\n` +
          `Limit:     ${key.limit === null ? "unlimited" : `$${key.limit.toFixed(2)}`}\n` +
          `Remaining: ${key.limitRemaining === null ? "unlimited" : `$${key.limitRemaining.toFixed(2)}`}\n` +
          `Tier:      ${key.isFreeTier ? "free" : "paid"}\n`,
      );
      if (rows.length > 0) {
        const total = rows.reduce((sum, r) => sum + r.cost, 0);
        process.stdout.write(`\n${spendTable(rows)}\n\nTotal: $${total.toFixed(4)}\n`);
      } else {
        process.stdout.write(
          "\nPass generation ids for a per-model breakdown:\n" +
            "  or-cost spend --ids gen-abc,gen-def\n",
        );
      }
      return;
    }

    case "serve": {
      const port = num(flags, "port") ?? 7777;
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        fail(`--port ${port}: expected an integer between 0 and 65535`);
      }
      await serve(port, process.env["OPENROUTER_API_KEY"]);
      return;
    }

    default:
      fail(`unknown command '${command}'. Try: or-cost help`);
  }
}

main().catch((err: unknown) => fail((err as Error).message));
