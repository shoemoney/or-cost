import { describe, expect, it } from "vitest";
import {
  blendedCost,
  estimateCost,
  normalizeModel,
  perMillion,
  providerOf,
  selectModels,
  summarizeSpend,
} from "../src/pricing.js";
import type { SortKey } from "../src/pricing.js";
import type { Model, RawModel } from "../src/types.js";

const model = (over: Partial<Model> & { id: string }): Model => ({
  name: over.id,
  provider: over.id.split("/")[0] as string,
  contextLength: 8_000,
  inputPerM: 1,
  outputPerM: 2,
  blendedPerM: 1.25,
  ...over,
});

describe("perMillion", () => {
  it("treats undefined pricing as unknown, not free", () => {
    expect(perMillion(undefined)).toBeNull();
  });

  it("keeps explicit zero at zero", () => {
    expect(perMillion("0")).toBe(0);
  });

  it("reports -1 (variable pricing) as unknown, not zero", () => {
    expect(perMillion("-1")).toBeNull();
  });

  it("reports non-numeric junk as unknown rather than NaN or zero", () => {
    expect(perMillion("free")).toBeNull();
    expect(perMillion("")).toBeNull();
  });

  it("converts USD-per-token strings to USD per 1M tokens", () => {
    expect(perMillion("0.00001")).toBeCloseTo(10, 10);
    expect(perMillion("0.000003")).toBeCloseTo(3, 10);
    expect(perMillion("0.00000015")).toBeCloseTo(0.15, 10);
  });
});

describe("providerOf", () => {
  it("takes the slug before the first slash", () => {
    expect(providerOf("anthropic/claude-opus-5")).toBe("anthropic");
  });

  it("only splits on the first slash", () => {
    expect(providerOf("openai/gpt-4o/2024")).toBe("openai");
  });

  it("returns the whole id when there is no slash", () => {
    expect(providerOf("gryphe-mythomax")).toBe("gryphe-mythomax");
  });
});

describe("blendedCost", () => {
  it("is normalized: equal input and output returns that same price at any ratio", () => {
    for (const r of [0, 1, 3, 7, 100]) {
      expect(blendedCost(4.2, 4.2, r)).toBeCloseTo(4.2, 10);
    }
  });

  it("weights input 3:1 by default", () => {
    // (3*3 + 15) / 4 = 6
    expect(blendedCost(3, 15, undefined)).toBeCloseTo(6, 10);
    expect(blendedCost(3, 15)).toBeCloseTo(6, 10);
  });

  it("honors an explicit ratio", () => {
    // ratio 1 is a plain average
    expect(blendedCost(3, 15, 1)).toBeCloseTo(9, 10);
    // ratio 0 ignores input entirely
    expect(blendedCost(3, 15, 0)).toBeCloseTo(15, 10);
  });

  it("falls back to 3 for negative or non-finite ratios", () => {
    expect(blendedCost(3, 15, -5)).toBeCloseTo(6, 10);
    expect(blendedCost(3, 15, Number.NaN)).toBeCloseTo(6, 10);
    expect(blendedCost(3, 15, Number.POSITIVE_INFINITY)).toBeCloseTo(6, 10);
  });
});

describe("normalizeModel", () => {
  const raw: RawModel = {
    id: "anthropic/claude-opus-5",
    name: "Claude Opus 5",
    context_length: 200_000,
    pricing: { prompt: "0.000015", completion: "0.000075" },
  };

  it("converts string prices to per-1M numbers and derives provider + blend", () => {
    const m = normalizeModel(raw);
    expect(m.id).toBe("anthropic/claude-opus-5");
    expect(m.name).toBe("Claude Opus 5");
    expect(m.provider).toBe("anthropic");
    expect(m.contextLength).toBe(200_000);
    expect(m.inputPerM).toBeCloseTo(15, 10);
    expect(m.outputPerM).toBeCloseTo(75, 10);
    expect(m.blendedPerM).toBeCloseTo((15 * 3 + 75) / 4, 10);
  });

  it("passes the input ratio through to the blend", () => {
    expect(normalizeModel(raw, 1).blendedPerM).toBeCloseTo(45, 10);
  });

  it("falls back to top_provider.context_length when context_length is null", () => {
    const m = normalizeModel({ ...raw, context_length: null, top_provider: { context_length: 128_000 } });
    expect(m.contextLength).toBe(128_000);
  });

  it("falls back to 0 when neither context length is available", () => {
    expect(normalizeModel({ ...raw, context_length: null }).contextLength).toBe(0);
    expect(
      normalizeModel({ ...raw, context_length: null, top_provider: { context_length: null } })
        .contextLength,
    ).toBe(0);
  });

  it("treats missing pricing fields as unknown, not free", () => {
    const m = normalizeModel({ ...raw, pricing: {} });
    expect(m.inputPerM).toBeNull();
    expect(m.outputPerM).toBeNull();
    expect(m.blendedPerM).toBeNull();
  });
});

describe("selectModels", () => {
  const catalog: Model[] = [
    model({ id: "anthropic/claude-opus-5", name: "Claude Opus 5", inputPerM: 15, outputPerM: 75, blendedPerM: 30, contextLength: 200_000 }),
    model({ id: "openai/gpt-4o", name: "GPT-4o", inputPerM: 2.5, outputPerM: 10, blendedPerM: 4.375, contextLength: 128_000 }),
    model({ id: "meta-llama/llama-3-8b:free", name: "Llama 3 8B (free)", inputPerM: 0, outputPerM: 0, blendedPerM: 0, contextLength: 8_192 }),
    model({ id: "mistralai/mistral-small", name: "Mistral Small", inputPerM: 0.2, outputPerM: 0.6, blendedPerM: 0.3, contextLength: 32_000 }),
  ];
  const ids = (ms: readonly Model[]): string[] => ms.map((m) => m.id);

  it("defaults to blended ascending", () => {
    expect(ids(selectModels(catalog))).toEqual([
      "meta-llama/llama-3-8b:free",
      "mistralai/mistral-small",
      "openai/gpt-4o",
      "anthropic/claude-opus-5",
    ]);
  });

  it("filters by provider case-insensitively", () => {
    expect(ids(selectModels(catalog, { provider: "AnThRoPiC" }))).toEqual(["anthropic/claude-opus-5"]);
    expect(selectModels(catalog, { provider: "google" })).toEqual([]);
  });

  it("searches across id and name, case-insensitively", () => {
    expect(ids(selectModels(catalog, { search: "GPT" }))).toEqual(["openai/gpt-4o"]);
    expect(ids(selectModels(catalog, { search: "llama" }))).toEqual(["meta-llama/llama-3-8b:free"]);
    expect(ids(selectModels(catalog, { search: "small" }))).toEqual(["mistralai/mistral-small"]);
  });

  it("freeOnly keeps only zero-blend models", () => {
    expect(ids(selectModels(catalog, { freeOnly: true }))).toEqual(["meta-llama/llama-3-8b:free"]);
  });

  it("maxPrice is inclusive of the boundary", () => {
    expect(ids(selectModels(catalog, { maxPrice: 4.375 }))).toEqual([
      "meta-llama/llama-3-8b:free",
      "mistralai/mistral-small",
      "openai/gpt-4o",
    ]);
    expect(ids(selectModels(catalog, { maxPrice: 0 }))).toEqual(["meta-llama/llama-3-8b:free"]);
  });

  it("sorts by input price", () => {
    expect(ids(selectModels(catalog, { sort: "input" }))).toEqual([
      "meta-llama/llama-3-8b:free",
      "mistralai/mistral-small",
      "openai/gpt-4o",
      "anthropic/claude-opus-5",
    ]);
  });

  it("sorts by output price", () => {
    expect(ids(selectModels(catalog, { sort: "output" }))).toEqual([
      "meta-llama/llama-3-8b:free",
      "mistralai/mistral-small",
      "openai/gpt-4o",
      "anthropic/claude-opus-5",
    ]);
  });

  it("sorts context descending (biggest window first)", () => {
    expect(ids(selectModels(catalog, { sort: "context" }))).toEqual([
      "anthropic/claude-opus-5",
      "openai/gpt-4o",
      "mistralai/mistral-small",
      "meta-llama/llama-3-8b:free",
    ]);
  });

  it("sorts by name (id) alphabetically", () => {
    expect(ids(selectModels(catalog, { sort: "name" }))).toEqual([
      "anthropic/claude-opus-5",
      "meta-llama/llama-3-8b:free",
      "mistralai/mistral-small",
      "openai/gpt-4o",
    ]);
  });

  it("desc reverses the chosen sort", () => {
    expect(ids(selectModels(catalog, { sort: "name", desc: true }))).toEqual([
      "openai/gpt-4o",
      "mistralai/mistral-small",
      "meta-llama/llama-3-8b:free",
      "anthropic/claude-opus-5",
    ]);
  });

  it("limit caps rows after sorting, and limit 0 means no cap", () => {
    expect(ids(selectModels(catalog, { limit: 2 }))).toEqual([
      "meta-llama/llama-3-8b:free",
      "mistralai/mistral-small",
    ]);
    expect(selectModels(catalog, { limit: 0 })).toHaveLength(4);
  });

  it("applies limit after desc so it keeps the most expensive", () => {
    expect(ids(selectModels(catalog, { desc: true, limit: 1 }))).toEqual(["anthropic/claude-opus-5"]);
  });

  it("breaks ties by id, stably, regardless of input order", () => {
    const a = model({ id: "aa/one", blendedPerM: 5 });
    const b = model({ id: "bb/two", blendedPerM: 5 });
    const c = model({ id: "cc/three", blendedPerM: 5 });
    expect(ids(selectModels([c, a, b]))).toEqual(["aa/one", "bb/two", "cc/three"]);
    expect(ids(selectModels([b, c, a]))).toEqual(["aa/one", "bb/two", "cc/three"]);
    expect(ids(selectModels([a, b, c]))).toEqual(["aa/one", "bb/two", "cc/three"]);
  });

  it("does not mutate the input array", () => {
    const input = [...catalog];
    selectModels(input, { sort: "name" });
    expect(ids(input)).toEqual(ids(catalog));
  });

  it("combines filters", () => {
    expect(ids(selectModels(catalog, { search: "a", maxPrice: 1, limit: 5 }))).toEqual([
      "meta-llama/llama-3-8b:free",
      "mistralai/mistral-small",
    ]);
  });
});

describe("estimateCost", () => {
  const m = model({ id: "openai/gpt-4o", inputPerM: 2.5, outputPerM: 10 });

  it("computes an exact dollar figure", () => {
    // 100k in @ $2.50/M = $0.25 ; 20k out @ $10/M = $0.20
    expect(estimateCost(m, 100_000, 20_000)).toBeCloseTo(0.45, 10);
  });

  it("is zero for zero tokens", () => {
    expect(estimateCost(m, 0, 0)).toBe(0);
  });

  it("is zero for a free model no matter the volume", () => {
    expect(estimateCost(model({ id: "x/free", inputPerM: 0, outputPerM: 0 }), 5_000_000, 5_000_000)).toBe(0);
  });

  it("scales linearly", () => {
    expect(estimateCost(m, 1_000_000, 0)).toBeCloseTo(2.5, 10);
    expect(estimateCost(m, 0, 1_000_000)).toBeCloseTo(10, 10);
  });
});

describe("summarizeSpend", () => {
  it("returns nothing for no generations", () => {
    expect(summarizeSpend([])).toEqual([]);
  });

  it("groups by model, sums tokens and cost, and sorts by cost desc", () => {
    const rows = summarizeSpend([
      { model: "openai/gpt-4o", total_cost: 0.01, tokens_prompt: 1000, tokens_completion: 200 },
      { model: "anthropic/claude-opus-5", total_cost: 0.5, tokens_prompt: 3000, tokens_completion: 900 },
      { model: "openai/gpt-4o", total_cost: 0.02, tokens_prompt: 500, tokens_completion: 100 },
    ]);
    expect(rows).toEqual([
      { model: "anthropic/claude-opus-5", generations: 1, promptTokens: 3000, completionTokens: 900, cost: 0.5 },
      { model: "openai/gpt-4o", generations: 2, promptTokens: 1500, completionTokens: 300, cost: 0.01 + 0.02 },
    ]);
  });

  it("treats missing fields as zero and a missing model as 'unknown'", () => {
    expect(summarizeSpend([{}, { total_cost: 0.25 }])).toEqual([
      { model: "unknown", generations: 2, promptTokens: 0, completionTokens: 0, cost: 0.25 },
    ]);
  });

  it("breaks equal-cost ties by model name", () => {
    const rows = summarizeSpend([
      { model: "zeta/z", total_cost: 1 },
      { model: "alpha/a", total_cost: 1 },
    ]);
    expect(rows.map((r) => r.model)).toEqual(["alpha/a", "zeta/z"]);
  });

  it("does not mutate the caller's generation objects", () => {
    const gens = [{ model: "a/b", total_cost: 1, tokens_prompt: 10, tokens_completion: 5 }];
    summarizeSpend(gens);
    expect(gens[0]).toEqual({ model: "a/b", total_cost: 1, tokens_prompt: 10, tokens_completion: 5 });
  });
});

describe("unknown (variable) pricing", () => {
  const variable = model({ id: "openrouter/auto", inputPerM: null, outputPerM: null, blendedPerM: null });
  const free = model({ id: "meta/free", inputPerM: 0, outputPerM: 0, blendedPerM: 0 });
  const paid = model({ id: "openai/gpt-4o", inputPerM: 2.5, outputPerM: 10, blendedPerM: 4.375 });

  it("does not pass --free", () => {
    expect(selectModels([variable, free], { freeOnly: true }).map((m) => m.id)).toEqual(["meta/free"]);
  });

  it("sorts last, not first, on cheapest-first", () => {
    expect(selectModels([variable, paid, free], { sort: "blended" }).map((m) => m.id)).toEqual([
      "meta/free",
      "openai/gpt-4o",
      "openrouter/auto",
    ]);
  });

  it("is dropped by --max-price rather than passing as $0", () => {
    expect(selectModels([variable, paid], { maxPrice: 100 }).map((m) => m.id)).toEqual(["openai/gpt-4o"]);
  });

  it("estimates to null instead of $0.00", () => {
    expect(estimateCost(variable, 100_000, 20_000)).toBeNull();
  });
});

describe("selectModels sort validation", () => {
  const a = model({ id: "aa/one", blendedPerM: 1 });
  const b = model({ id: "bb/two", blendedPerM: 2 });

  it("falls back to blended for an unknown sort key instead of throwing", () => {
    expect(
      selectModels([b, a], { sort: "bogus" as unknown as SortKey }).map((m) => m.id),
    ).toEqual(["aa/one", "bb/two"]);
  });
});
