import { beforeAll, describe, expect, it } from "vitest";
import { escapeHtml } from "../src/server.js";

// src/cli.ts runs main() on import. Point argv at `help` and swallow stdout so the
// import is a no-op that touches no network and exits nothing.
type ParseArgs = (argv: readonly string[]) => {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
};
let parseArgs: ParseArgs;

beforeAll(async () => {
  process.argv = [process.argv[0] as string, "cli.ts", "help"];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    ({ parseArgs } = (await import("../src/cli.js")) as { parseArgs: ParseArgs });
  } finally {
    process.stdout.write = write;
  }
});

describe("parseArgs", () => {
  it("does not let a boolean flag swallow the next positional", () => {
    const a = parseArgs(["estimate", "--json", "100000", "20000"]);
    expect(a.positional).toEqual(["100000", "20000"]);
    expect(a.flags.get("json")).toBe(true);
  });

  it("still consumes a value for value-taking flags", () => {
    expect(parseArgs(["models", "--sort", "input"]).flags.get("sort")).toBe("input");
  });

  it("defaults to the models command with no args", () => {
    const a = parseArgs([]);
    expect(a.command).toBe("models");
    expect(a.positional).toEqual([]);
    expect(a.flags.size).toBe(0);
  });

  it("takes the first positional as the command", () => {
    expect(parseArgs(["spend"]).command).toBe("spend");
  });

  it("keeps remaining positionals in order", () => {
    const a = parseArgs(["estimate", "100000", "20000"]);
    expect(a.command).toBe("estimate");
    expect(a.positional).toEqual(["100000", "20000"]);
  });

  it("parses `--flag value`", () => {
    expect(parseArgs(["models", "--provider", "anthropic"]).flags.get("provider")).toBe("anthropic");
  });

  it("parses `--flag=value`, keeping '=' inside the value", () => {
    const f = parseArgs(["models", "--search=gpt-4o", "--ids=a=1,b"]).flags;
    expect(f.get("search")).toBe("gpt-4o");
    expect(f.get("ids")).toBe("a=1,b");
  });

  it("treats a flag followed by another flag as boolean true", () => {
    const f = parseArgs(["models", "--free", "--desc", "--limit", "5"]).flags;
    expect(f.get("free")).toBe(true);
    expect(f.get("desc")).toBe(true);
    expect(f.get("limit")).toBe("5");
  });

  it("treats a trailing flag as boolean true", () => {
    expect(parseArgs(["models", "--json"]).flags.get("json")).toBe(true);
  });

  it("consumes the value so it does not leak into positionals", () => {
    const a = parseArgs(["estimate", "1000", "--provider", "openai", "500"]);
    expect(a.positional).toEqual(["1000", "500"]);
    expect(a.flags.get("provider")).toBe("openai");
  });

  it("keeps the command when a bare boolean flag precedes it", () => {
    const a = parseArgs(["--json", "spend"]);
    expect(a.command).toBe("spend");
    expect(a.flags.get("json")).toBe(true);
    expect(parseArgs(["--json=1", "spend"]).command).toBe("spend");
  });

  it("lets a later occurrence of a flag win", () => {
    expect(parseArgs(["models", "--limit", "5", "--limit=10"]).flags.get("limit")).toBe("10");
  });

  it("accepts negative numbers as flag values", () => {
    expect(parseArgs(["models", "--max-price=-1"]).flags.get("max-price")).toBe("-1");
  });
});

describe("escapeHtml", () => {
  it("escapes all five entities", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes ampersands before they can double-escape", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("neutralizes a script payload smuggled through a model id", () => {
    expect(escapeHtml(`evil/<script>alert('x')</script>`)).toBe(
      "evil/&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;",
    );
  });

  it("escapes a quote that would break out of an attribute", () => {
    expect(escapeHtml(`x" onload="boom`)).toBe("x&quot; onload=&quot;boom");
  });

  it("leaves ordinary model ids untouched", () => {
    expect(escapeHtml("anthropic/claude-opus-5")).toBe("anthropic/claude-opus-5");
    expect(escapeHtml("")).toBe("");
  });
});
