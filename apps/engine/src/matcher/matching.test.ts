import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OrderSide, OrderType } from "@prisma/client";
import { match } from "./matching";
import { orderBookRegistry } from "../orderbook/orderbookRegistry";
import { CreateOrderInput } from "@repo/types/order";

// These are unit tests for the in-memory matching logic only. REDIS_URL is
// force-unset (regardless of what's in the ambient environment) so every
// redis-utils function short-circuits to a no-op (see
// packages/redis-utils/src/redis.ts) instead of pushing real queue/pub-sub
// traffic — this test file must never depend on a real Redis being
// reachable, or on it NOT being reachable by accident.
beforeAll(() => {
  vi.stubEnv("REDIS_URL", "");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

let symbolCounter = 0;
function freshSymbol() {
  symbolCounter += 1;
  return `TESTPAIR${symbolCounter}USDT`;
}

let orderCounter = 0;
function makeOrder(symbol: string, overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  orderCounter += 1;
  return {
    id: `order-${orderCounter}`,
    userId: `user-${orderCounter}`,
    type: OrderType.LIMIT,
    side: OrderSide.BUY,
    symbol,
    pricePerUnit: 100,
    quantity: 1,
    ...overrides,
  };
}

describe("match", () => {
  it("rests a BUY order when there is no opposing liquidity", async () => {
    const symbol = freshSymbol();
    const order = makeOrder(symbol, { side: OrderSide.BUY, pricePerUnit: 100, quantity: 1 });

    await match(order);

    const book = orderBookRegistry.getOrderBook(symbol);
    expect(book.getBidPrices()).toEqual([100]);
    expect(book.getOrdersAtPrice(100, OrderSide.BUY)).toHaveLength(1);
  });

  it("does not cross when the best ask is more expensive than the buyer's limit", async () => {
    const symbol = freshSymbol();
    await match(makeOrder(symbol, { side: OrderSide.SELL, pricePerUnit: 105, quantity: 1 }));
    await match(makeOrder(symbol, { side: OrderSide.BUY, pricePerUnit: 100, quantity: 1 }));

    const book = orderBookRegistry.getOrderBook(symbol);
    // Both orders should be resting — no trade occurred.
    expect(book.getAskPrices()).toEqual([105]);
    expect(book.getBidPrices()).toEqual([100]);
  });

  it("produces an exact full fill on both sides at the maker's price", async () => {
    const symbol = freshSymbol();
    await match(makeOrder(symbol, { side: OrderSide.SELL, pricePerUnit: 100, quantity: 1 }));
    await match(makeOrder(symbol, { side: OrderSide.BUY, pricePerUnit: 100, quantity: 1 }));

    const book = orderBookRegistry.getOrderBook(symbol);
    expect(book.getAskPrices()).toEqual([]);
    expect(book.getBidPrices()).toEqual([]);
  });

  it("fills the taker fully and leaves the maker resting with reduced quantity (partial fill)", async () => {
    const symbol = freshSymbol();
    await match(makeOrder(symbol, { side: OrderSide.SELL, pricePerUnit: 100, quantity: 5 }));
    await match(makeOrder(symbol, { side: OrderSide.BUY, pricePerUnit: 100, quantity: 2 }));

    const book = orderBookRegistry.getOrderBook(symbol);
    expect(book.getBidPrices()).toEqual([]); // taker fully filled, nothing rests
    const resting = book.getOrdersAtPrice(100, OrderSide.SELL);
    expect(resting).toHaveLength(1);
    expect(resting[0]!.quantity).toBe(3); // 5 - 2
  });

  it("fills the maker fully and lets the taker keep matching / rest with its remainder", async () => {
    const symbol = freshSymbol();
    await match(makeOrder(symbol, { side: OrderSide.SELL, pricePerUnit: 100, quantity: 1 }));
    await match(makeOrder(symbol, { side: OrderSide.BUY, pricePerUnit: 100, quantity: 3 }));

    const book = orderBookRegistry.getOrderBook(symbol);
    expect(book.getAskPrices()).toEqual([]); // maker fully consumed
    const resting = book.getOrdersAtPrice(100, OrderSide.BUY);
    expect(resting).toHaveLength(1);
    expect(resting[0]!.quantity).toBe(2); // 3 - 1 rests as a new bid
  });

  it("respects price priority across multiple resting price levels", async () => {
    const symbol = freshSymbol();
    await match(makeOrder(symbol, { side: OrderSide.SELL, pricePerUnit: 102, quantity: 1 }));
    await match(makeOrder(symbol, { side: OrderSide.SELL, pricePerUnit: 100, quantity: 1 }));
    await match(makeOrder(symbol, { side: OrderSide.SELL, pricePerUnit: 101, quantity: 1 }));

    // A marketable buy that can afford all three should clear the cheapest first.
    await match(makeOrder(symbol, { side: OrderSide.BUY, pricePerUnit: 101, quantity: 1 }));

    const book = orderBookRegistry.getOrderBook(symbol);
    // The 100 level should be gone (matched first); 101 and 102 remain.
    expect(book.getAskPrices()).toEqual([101, 102]);
  });

  it("respects time priority (FIFO) among resting orders at the same price", async () => {
    const symbol = freshSymbol();
    const firstMaker = makeOrder(symbol, { side: OrderSide.SELL, pricePerUnit: 100, quantity: 1 });
    const secondMaker = makeOrder(symbol, { side: OrderSide.SELL, pricePerUnit: 100, quantity: 1 });
    await match(firstMaker);
    await match(secondMaker);

    await match(makeOrder(symbol, { side: OrderSide.BUY, pricePerUnit: 100, quantity: 1 }));

    const book = orderBookRegistry.getOrderBook(symbol);
    const remaining = book.getOrdersAtPrice(100, OrderSide.SELL);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(secondMaker.id); // the first-in maker was matched away
  });

  it("drops a malformed order (non-positive quantity) instead of corrupting the book", async () => {
    const symbol = freshSymbol();
    await match(makeOrder(symbol, { quantity: -5 }));

    const book = orderBookRegistry.getOrderBook(symbol);
    expect(book.getBidPrices()).toEqual([]);
    expect(book.getAskPrices()).toEqual([]);
  });

  it("drops a malformed LIMIT order with a non-positive price", async () => {
    const symbol = freshSymbol();
    await match(makeOrder(symbol, { type: OrderType.LIMIT, pricePerUnit: 0 }));

    const book = orderBookRegistry.getOrderBook(symbol);
    expect(book.getBidPrices()).toEqual([]);
  });

  it("drops a MARKET order when there is no opposite-side liquidity to price it against", async () => {
    const symbol = freshSymbol();
    await match(
      makeOrder(symbol, {
        type: OrderType.MARKET,
        side: OrderSide.BUY,
        pricePerUnit: undefined,
        quantity: 1,
      })
    );

    const book = orderBookRegistry.getOrderBook(symbol);
    // A MARKET order that can't be priced must never sit in the book with an
    // arbitrary/undefined price.
    expect(book.getBidPrices()).toEqual([]);
    expect(book.getAskPrices()).toEqual([]);
  });

  it("matches a MARKET order against the best resting price when liquidity exists", async () => {
    const symbol = freshSymbol();
    await match(makeOrder(symbol, { side: OrderSide.SELL, pricePerUnit: 100, quantity: 1 }));
    await match(
      makeOrder(symbol, {
        type: OrderType.MARKET,
        side: OrderSide.BUY,
        pricePerUnit: undefined,
        quantity: 1,
      })
    );

    const book = orderBookRegistry.getOrderBook(symbol);
    expect(book.getAskPrices()).toEqual([]);
  });
});
