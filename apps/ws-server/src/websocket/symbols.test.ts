import { describe, expect, it } from "vitest";
import { parseRequestedSymbols, safeParseMessage } from "./symbols";

describe("parseRequestedSymbols", () => {
  it("parses a comma-separated list and uppercases it", () => {
    expect(parseRequestedSymbols("/?symbols=btcusdt,ethusdt")).toEqual([
      "BTCUSDT",
      "ETHUSDT",
    ]);
  });

  it("trims whitespace around symbols", () => {
    expect(parseRequestedSymbols("/?symbols=BTCUSDT, ETHUSDT")).toEqual([
      "BTCUSDT",
      "ETHUSDT",
    ]);
  });

  it("drops entries that don't look like a trading pair", () => {
    expect(parseRequestedSymbols("/?symbols=BTCUSDT,;drop table,,AB")).toEqual([
      "BTCUSDT",
    ]);
  });

  it("returns an empty list when no symbols param is present", () => {
    expect(parseRequestedSymbols("/")).toEqual([]);
  });

  it("returns an empty list for an empty symbols param", () => {
    expect(parseRequestedSymbols("/?symbols=")).toEqual([]);
  });
});

describe("safeParseMessage", () => {
  it("parses valid JSON", () => {
    expect(safeParseMessage('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns undefined instead of throwing on malformed JSON", () => {
    expect(safeParseMessage("not json")).toBeUndefined();
  });
});
