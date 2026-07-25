/** Subset of the OpenRouter /api/v1/models payload that or-cost relies on. */
export interface RawModel {
  id: string;
  name: string;
  context_length: number | null;
  pricing: {
    prompt?: string;
    completion?: string;
    request?: string;
    image?: string;
  };
  top_provider?: {
    context_length?: number | null;
    max_completion_tokens?: number | null;
    is_moderated?: boolean;
  };
}

/** A model with pricing normalized to USD per 1M tokens. */
export interface Model {
  id: string;
  name: string;
  /** Author/org slug from the model id, e.g. `anthropic` in `anthropic/claude-opus-5`. */
  provider: string;
  contextLength: number;
  /** USD per 1M prompt tokens. `null` = unpriced/variable, not free. */
  inputPerM: number | null;
  /** USD per 1M completion tokens. `null` = unpriced/variable, not free. */
  outputPerM: number | null;
  /** Weighted input/output cost per 1M tokens — see blendedCost(). `null` if either side is. */
  blendedPerM: number | null;
}

export interface KeyInfo {
  label: string;
  usage: number;
  limit: number | null;
  limitRemaining: number | null;
  isFreeTier: boolean;
}

/** One row of the per-model spend breakdown. */
export interface SpendRow {
  model: string;
  generations: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
}
