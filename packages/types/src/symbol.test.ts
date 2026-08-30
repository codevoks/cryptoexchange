import { describe, expect, it } from "vitest";
import { parseSymbol, UnsupportedSymbolError } from "./symbol";

describe("parseSymbol", () => {
  it("splits a pair on a known quote asset", () => {
    expect(parseSymbol("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(parseSymbol("ETHUSDC")).toEqual({ base: "ETH", quote: "USDC" });
  });

  it("is case-insensitive and normalizes to uppercase", () => {
    expect(parseSymbol("btcusdt")).toEqual({ base: "BTC", quote: "USDT" });
  });

  it("prefers the longest matching quote suffix", () => {
    // "ETHBTC" could ambiguously match a bare "T"-like suffix if the
    // matcher weren't sorted longest-first; base should come out as "ETH".
    expect(parseSymbol("ETHBTC")).toEqual({ base: "ETH", quote: "BTC" });
  });

  it("throws UnsupportedSymbolError for an unknown quote asset", () => {
    expect(() => parseSymbol("BTCXYZ")).toThrow(UnsupportedSymbolError);
  });

  it("throws when the pair is only a quote asset with no base", () => {
    expect(() => parseSymbol("USDT")).toThrow(UnsupportedSymbolError);
  });
});
