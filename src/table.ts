import type { Model, SpendRow } from "./types.js";

/**
 * Prices span five orders of magnitude ($0.00 to $120/M), so precision is
 * chosen per magnitude — $0.02 and $0.0001 both need to stay readable. `null`
 * means OpenRouter publishes no per-token price (variable `-1`, or billed per
 * second/image) and renders as "n/a" — never as free.
 */
export function formatUsd(n: number | null): string {
  if (n === null) return "n/a";
  if (n === 0) return "free";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export type Align = "left" | "right";

export function renderTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  align: readonly Align[] = [],
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const pad = (cell: string, i: number): string => {
    const w = widths[i] ?? cell.length;
    return align[i] === "right" ? cell.padStart(w) : cell.padEnd(w);
  };
  const line = (cells: readonly string[]): string =>
    cells.map((c, i) => pad(c, i)).join("  ").trimEnd();

  return [
    line(headers),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.map((r) => line(headers.map((_, i) => r[i] ?? ""))),
  ].join("\n");
}

export function modelTable(models: readonly Model[]): string {
  return renderTable(
    ["MODEL", "PROVIDER", "IN /1M", "OUT /1M", "BLENDED", "CONTEXT"],
    models.map((m) => [
      m.id,
      m.provider,
      formatUsd(m.inputPerM),
      formatUsd(m.outputPerM),
      formatUsd(m.blendedPerM),
      formatTokens(m.contextLength),
    ]),
    ["left", "left", "right", "right", "right", "right"],
  );
}

export function spendTable(rows: readonly SpendRow[]): string {
  return renderTable(
    ["MODEL", "CALLS", "PROMPT", "COMPLETION", "COST"],
    rows.map((r) => [
      r.model,
      String(r.generations),
      formatTokens(r.promptTokens),
      formatTokens(r.completionTokens),
      `$${r.cost.toFixed(4)}`,
    ]),
    ["left", "right", "right", "right", "right"],
  );
}
