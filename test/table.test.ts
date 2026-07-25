import { describe, expect, it } from "vitest";
import { formatTokens, formatUsd, modelTable, renderTable, spendTable } from "../src/table.js";
import type { Model, SpendRow } from "../src/types.js";

describe("formatUsd", () => {
  it("calls exactly zero 'free'", () => {
    expect(formatUsd(0)).toBe("free");
  });

  it("uses 4 decimals below a cent", () => {
    expect(formatUsd(0.0001)).toBe("$0.0001");
    expect(formatUsd(0.00016)).toBe("$0.0002");
    expect(formatUsd(0.009)).toBe("$0.0090");
  });

  it("uses 3 decimals below a dollar", () => {
    expect(formatUsd(0.01)).toBe("$0.010");
    expect(formatUsd(0.375)).toBe("$0.375");
    expect(formatUsd(0.9999)).toBe("$1.000");
  });

  it("uses 2 decimals at a dollar and above", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(4.375)).toBe("$4.38");
    expect(formatUsd(120)).toBe("$120.00");
  });
});

describe("formatTokens", () => {
  it("leaves small counts alone", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("abbreviates thousands, dropping .0 on round values", () => {
    expect(formatTokens(1_000)).toBe("1K");
    expect(formatTokens(1_500)).toBe("1.5K");
    expect(formatTokens(8_192)).toBe("8.2K");
    expect(formatTokens(200_000)).toBe("200K");
  });

  it("abbreviates millions", () => {
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(2_000_000)).toBe("2M");
  });
});

describe("renderTable", () => {
  it("sizes each column to its widest cell and separates with two spaces", () => {
    const out = renderTable(["A", "BB"], [["long-value", "x"]]);
    expect(out.split("\n")).toEqual([
      "A           BB",
      "----------  --",
      "long-value  x",
    ]);
  });

  it("sizes to the header when the header is widest", () => {
    const out = renderTable(["PROVIDER"], [["ai"]]);
    expect(out.split("\n")).toEqual(["PROVIDER", "--------", "ai"]);
  });

  it("right-aligns the columns it is told to", () => {
    const out = renderTable(["N", "COST"], [["1", "$1.00"], ["2", "$12.50"]], ["left", "right"]);
    expect(out.split("\n")).toEqual([
      "N    COST",
      "-  ------",
      "1   $1.00",
      "2  $12.50",
    ]);
  });

  it("does not throw on ragged or short rows, filling with blanks", () => {
    const out = renderTable(["A", "B", "C"], [["1"], ["1", "2"], ["1", "2", "3"]]);
    expect(out.split("\n")).toEqual([
      "A  B  C",
      "-  -  -",
      "1",
      "1  2",
      "1  2  3",
    ]);
  });

  it("ignores extra cells beyond the headers", () => {
    expect(renderTable(["A"], [["1", "ignored"]]).split("\n")).toEqual(["A", "-", "1"]);
  });

  it("handles zero rows", () => {
    expect(renderTable(["A", "B"], []).split("\n")).toEqual(["A  B", "-  -"]);
  });
});

const model: Model = {
  id: "anthropic/claude-opus-5",
  name: "Claude Opus 5",
  provider: "anthropic",
  contextLength: 200_000,
  inputPerM: 15,
  outputPerM: 75,
  blendedPerM: 30,
};

describe("modelTable", () => {
  it("renders headers plus one formatted row", () => {
    const lines = modelTable([model]).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("MODEL                    PROVIDER   IN /1M  OUT /1M  BLENDED  CONTEXT");
    expect(lines[2]).toBe("anthropic/claude-opus-5  anthropic  $15.00   $75.00   $30.00     200K");
  });

  it("shows unpriced (variable) models as 'n/a', never 'free'", () => {
    const unpriced: Model = { ...model, id: "openrouter/auto", inputPerM: null, outputPerM: null, blendedPerM: null };
    const row = modelTable([unpriced]).split("\n")[2] as string;
    expect(row).toContain("n/a");
    expect(row).not.toContain("free");
  });

  it("shows free models as 'free'", () => {
    const free: Model = { ...model, id: "x/free", provider: "x", inputPerM: 0, outputPerM: 0, blendedPerM: 0 };
    expect(modelTable([free]).split("\n")[2]).toContain("free");
  });
});

describe("spendTable", () => {
  it("renders cost at fixed 4 decimals", () => {
    const rows: SpendRow[] = [
      { model: "openai/gpt-4o", generations: 2, promptTokens: 1500, completionTokens: 300, cost: 0.03 },
    ];
    const lines = spendTable(rows).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("MODEL          CALLS  PROMPT  COMPLETION     COST");
    expect(lines[2]).toBe("openai/gpt-4o      2    1.5K         300  $0.0300");
  });
});
