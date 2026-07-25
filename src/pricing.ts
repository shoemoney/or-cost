import type { Model, RawModel, SpendRow } from "./types.js";

const PER_MILLION = 1_000_000;

/**
 * OpenRouter prices are USD-per-token strings. Missing, unparseable, and
 * negative (`-1` means "variable") values are *unknown*, not free — they come
 * back as `null` so nothing downstream can publish a $0 price it does not have.
 */
export function perMillion(price: string | undefined): number | null {
  if (price === undefined || price.trim() === "") return null;
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return null;
  return n * PER_MILLION;
}

/** Author/org slug: `anthropic/claude-opus-5` -> `anthropic`. */
export function providerOf(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

/**
 * A single comparable number per model. Real workloads read far more than they
 * write, so input is weighted heavier than output by default (3:1). Weights are
 * normalized, so blendedCost(x, x, r) === x for any ratio.
 */
export function blendedCost(
  inputPerM: number | null,
  outputPerM: number | null,
  inputRatio = 3,
): number | null {
  if (inputPerM === null || outputPerM === null) return null;
  const r = Number.isFinite(inputRatio) && inputRatio >= 0 ? inputRatio : 3;
  return (inputPerM * r + outputPerM) / (r + 1);
}

export function normalizeModel(raw: RawModel, inputRatio = 3): Model {
  const inputPerM = perMillion(raw.pricing.prompt);
  const outputPerM = perMillion(raw.pricing.completion);
  return {
    id: raw.id,
    name: raw.name,
    provider: providerOf(raw.id),
    contextLength: raw.context_length ?? raw.top_provider?.context_length ?? 0,
    inputPerM,
    outputPerM,
    blendedPerM: blendedCost(inputPerM, outputPerM, inputRatio),
  };
}

export type SortKey = "blended" | "input" | "output" | "context" | "name";

export interface FilterOptions {
  provider?: string | undefined;
  search?: string | undefined;
  maxPrice?: number | undefined;
  freeOnly?: boolean | undefined;
  sort?: SortKey | undefined;
  desc?: boolean | undefined;
  limit?: number | undefined;
}

/** Unknown price sorts as "most expensive" so it never masquerades as cheapest. */
const price = (n: number | null): number => (n === null ? Infinity : n);

export const SORT_KEYS = ["blended", "input", "output", "context", "name"] as const;

export function isSortKey(v: string): v is SortKey {
  return (SORT_KEYS as readonly string[]).includes(v);
}

const SORTERS: Record<SortKey, (a: Model, b: Model) => number> = {
  blended: (a, b) => price(a.blendedPerM) - price(b.blendedPerM),
  input: (a, b) => price(a.inputPerM) - price(b.inputPerM),
  output: (a, b) => price(a.outputPerM) - price(b.outputPerM),
  context: (a, b) => b.contextLength - a.contextLength,
  name: (a, b) => a.id.localeCompare(b.id),
};

export function selectModels(models: readonly Model[], opts: FilterOptions = {}): Model[] {
  const provider = opts.provider?.toLowerCase();
  const search = opts.search?.toLowerCase();

  let out = models.filter((m) => {
    if (provider !== undefined && m.provider.toLowerCase() !== provider) return false;
    if (search !== undefined && !`${m.id} ${m.name}`.toLowerCase().includes(search)) return false;
    if (opts.freeOnly === true && m.blendedPerM !== 0) return false;
    if (opts.maxPrice !== undefined && price(m.blendedPerM) > opts.maxPrice) return false;
    return true;
  });

  // Ties broken by id so output is stable across runs and machines.
  // Unknown keys (CLI flag, dashboard query string) fall back instead of throwing.
  const cmp = SORTERS[opts.sort ?? "blended"] ?? SORTERS.blended;
  out.sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
  if (opts.desc === true) out.reverse();

  if (opts.limit !== undefined && opts.limit > 0) out = out.slice(0, opts.limit);
  return out;
}

/** What N prompt tokens + M completion tokens cost on a given model. */
export function estimateCost(
  model: Model,
  promptTokens: number,
  completionTokens: number,
): number | null {
  if (model.inputPerM === null || model.outputPerM === null) return null;
  return (model.inputPerM * promptTokens + model.outputPerM * completionTokens) / PER_MILLION;
}

export interface Generation {
  model?: string;
  total_cost?: number;
  tokens_prompt?: number;
  tokens_completion?: number;
}

/** Collapse recent generations into a per-model spend breakdown, priciest first. */
export function summarizeSpend(generations: readonly Generation[]): SpendRow[] {
  const byModel = new Map<string, SpendRow>();
  for (const g of generations) {
    const model = g.model ?? "unknown";
    const row = byModel.get(model) ?? {
      model,
      generations: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
    };
    row.generations += 1;
    row.promptTokens += g.tokens_prompt ?? 0;
    row.completionTokens += g.tokens_completion ?? 0;
    row.cost += g.total_cost ?? 0;
    byModel.set(model, row);
  }
  return [...byModel.values()].sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model));
}
