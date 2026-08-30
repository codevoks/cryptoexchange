// Trading pairs in this codebase are plain concatenated strings (e.g. "BTCUSDT"),
// not "BASE/QUOTE" pairs, so splitting one into its base/quote assets for wallet
// bookkeeping requires knowing which quote assets exist. This is a deliberately
// small, explicit list rather than a general currency-symbol parser.
const KNOWN_QUOTE_ASSETS = ["USDT", "USDC", "BUSD", "DAI", "ETH", "BTC"] as const;

export interface ParsedSymbol {
  base: string;
  quote: string;
}

export class UnsupportedSymbolError extends Error {
  constructor(pair: string) {
    super(
      `Unsupported trading pair "${pair}": no known quote asset (${KNOWN_QUOTE_ASSETS.join(", ")}) found as a suffix`
    );
    this.name = "UnsupportedSymbolError";
  }
}

/**
 * Splits a pair like "BTCUSDT" into { base: "BTC", quote: "USDT" }.
 * Tries known quote suffixes longest-first so e.g. "ETHUSDT" doesn't
 * mistakenly match a shorter "T" suffix.
 */
export function parseSymbol(pair: string): ParsedSymbol {
  const upper = pair.toUpperCase();
  const quote = [...KNOWN_QUOTE_ASSETS]
    .sort((a, b) => b.length - a.length)
    .find((q) => upper.endsWith(q) && upper.length > q.length);

  if (!quote) {
    throw new UnsupportedSymbolError(pair);
  }

  return { base: upper.slice(0, upper.length - quote.length), quote };
}
