import { describe, expect, it } from "vitest";
import { CreateOrderSchema, computeSlippagePrice } from "./order";

describe("CreateOrderSchema", () => {
  it("accepts a valid LIMIT order", () => {
    const result = CreateOrderSchema.safeParse({
      type: "LIMIT",
      side: "BUY",
      symbol: "BTCUSDT",
      quantity: 0.5,
      pricePerUnit: 65000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid MARKET order without a price", () => {
    const result = CreateOrderSchema.safeParse({
      type: "MARKET",
      side: "SELL",
      symbol: "BTCUSDT",
      quantity: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a LIMIT order missing pricePerUnit", () => {
    const result = CreateOrderSchema.safeParse({
      type: "LIMIT",
      side: "BUY",
      symbol: "BTCUSDT",
      quantity: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it.each([0, -1, -0.0001, NaN, Infinity])(
    "rejects a non-positive-finite quantity: %s",
    (quantity) => {
      const result = CreateOrderSchema.safeParse({
        type: "MARKET",
        side: "BUY",
        symbol: "BTCUSDT",
        quantity,
      });
      expect(result.success).toBe(false);
    }
  );

  it.each([0, -100])("rejects a non-positive LIMIT price: %s", (pricePerUnit) => {
    const result = CreateOrderSchema.safeParse({
      type: "LIMIT",
      side: "BUY",
      symbol: "BTCUSDT",
      quantity: 1,
      pricePerUnit,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed symbol", () => {
    const result = CreateOrderSchema.safeParse({
      type: "MARKET",
      side: "BUY",
      symbol: "btc/usdt", // lowercase + slash not allowed
      quantity: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown side or type", () => {
    expect(
      CreateOrderSchema.safeParse({
        type: "LIMIT",
        side: "HOLD",
        symbol: "BTCUSDT",
        quantity: 1,
        pricePerUnit: 1,
      }).success
    ).toBe(false);
  });
});

describe("computeSlippagePrice", () => {
  it("adds slippage above the best ask for a BUY", () => {
    expect(computeSlippagePrice("BUY", 100, 0.02)).toBeCloseTo(102);
  });

  it("subtracts slippage below the best bid for a SELL", () => {
    expect(computeSlippagePrice("SELL", 100, 0.02)).toBeCloseTo(98);
  });

  it("is a no-op at zero slippage", () => {
    expect(computeSlippagePrice("BUY", 100, 0)).toBe(100);
    expect(computeSlippagePrice("SELL", 100, 0)).toBe(100);
  });
});
