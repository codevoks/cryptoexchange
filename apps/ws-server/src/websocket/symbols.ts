const SYMBOL_REGEX = /^[A-Z0-9]{5,12}$/;

/**
 * Parses and validates the `?symbols=` query param from a connection URL.
 * Split out from the WebSocketServer wiring (which binds a real port as a
 * side effect of being imported) so it can be unit tested directly.
 */
export function parseRequestedSymbols(url: string): string[] {
  const parsed = new URL(url, "http://placeholder");
  const symbolsParam = parsed.searchParams.get("symbols"); // e.g., ?symbols=BTCUSDT,ETHUSDT
  const requested = symbolsParam?.split(",").map((s) => s.trim().toUpperCase()) ?? [];
  return requested.filter((s) => SYMBOL_REGEX.test(s));
}

/**
 * Safely parses a Redis pub/sub message payload. Returns undefined instead
 * of throwing on malformed JSON — this runs inside the redis client's event
 * dispatch, which does not catch exceptions from listener callbacks, so an
 * uncaught throw here would crash the whole process.
 */
export function safeParseMessage(message: string): unknown | undefined {
  try {
    return JSON.parse(message);
  } catch {
    return undefined;
  }
}
