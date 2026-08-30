import { describe, expect, it } from "vitest";
import { OrderSide, OrderType } from "@prisma/client";
import { OrderBook } from "./orderbook";
import { CreateOrderInput } from "@repo/types/order";

let nextId = 0;
function makeOrder(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  nextId += 1;
  return {
    id: `order-${nextId}`,
    userId: "user-1",
    type: OrderType.LIMIT,
    side: OrderSide.BUY,
    symbol: "BTCUSDT",
    pricePerUnit: 100,
    quantity: 1,
    ...overrides,
  };
}

describe("OrderBook", () => {
  it("has no best price on an empty book", () => {
    const book = new OrderBook();
    expect(book.getBestPrice(OrderSide.BUY)).toBeUndefined();
    expect(book.getBestPrice(OrderSide.SELL)).toBeUndefined();
  });

  it("keeps bids sorted highest-first (price priority)", () => {
    const book = new OrderBook();
    book.addOrder(makeOrder({ side: OrderSide.BUY, pricePerUnit: 100 }));
    book.addOrder(makeOrder({ side: OrderSide.BUY, pricePerUnit: 105 }));
    book.addOrder(makeOrder({ side: OrderSide.BUY, pricePerUnit: 95 }));

    expect(book.getBidPrices()).toEqual([105, 100, 95]);
    expect(book.getBestPrice(OrderSide.BUY)).toBe(105);
  });

  it("keeps asks sorted lowest-first (price priority)", () => {
    const book = new OrderBook();
    book.addOrder(makeOrder({ side: OrderSide.SELL, pricePerUnit: 110 }));
    book.addOrder(makeOrder({ side: OrderSide.SELL, pricePerUnit: 105 }));
    book.addOrder(makeOrder({ side: OrderSide.SELL, pricePerUnit: 120 }));

    expect(book.getAskPrices()).toEqual([105, 110, 120]);
    expect(book.getBestPrice(OrderSide.SELL)).toBe(105);
  });

  it("preserves FIFO order within a single price level (time priority)", () => {
    const book = new OrderBook();
    const first = makeOrder({ side: OrderSide.BUY, pricePerUnit: 100 });
    const second = makeOrder({ side: OrderSide.BUY, pricePerUnit: 100 });
    book.addOrder(first);
    book.addOrder(second);

    const level = book.getOrdersAtPrice(100, OrderSide.BUY);
    expect(level.map((o) => o.id)).toEqual([first.id, second.id]);
  });

  it("removes a price level entirely once its last order is removed", () => {
    const book = new OrderBook();
    const order = makeOrder({ side: OrderSide.SELL, pricePerUnit: 100 });
    book.addOrder(order);
    book.removeOrder(order);

    expect(book.getAskPrices()).toEqual([]);
    expect(book.getOrdersAtPrice(100, OrderSide.SELL)).toEqual([]);
  });

  it("keeps sibling orders at a price level when one is removed", () => {
    const book = new OrderBook();
    const a = makeOrder({ side: OrderSide.BUY, pricePerUnit: 100 });
    const b = makeOrder({ side: OrderSide.BUY, pricePerUnit: 100 });
    book.addOrder(a);
    book.addOrder(b);
    book.removeOrder(a);

    expect(book.getOrdersAtPrice(100, OrderSide.BUY).map((o) => o.id)).toEqual([b.id]);
    expect(book.getBidPrices()).toEqual([100]);
  });

  it("reduceOrderQuantity removes the order once quantity hits zero", () => {
    const book = new OrderBook();
    const order = makeOrder({ side: OrderSide.BUY, pricePerUnit: 100, quantity: 2 });
    book.addOrder(order);

    book.reduceOrderQuantity(order, 1);
    expect(book.getOrdersAtPrice(100, OrderSide.BUY)).toHaveLength(1);
    expect(order.quantity).toBe(1);

    book.reduceOrderQuantity(order, 1);
    expect(book.getOrdersAtPrice(100, OrderSide.BUY)).toHaveLength(0);
    expect(book.getBidPrices()).toEqual([]);
  });

  it("removeOrderById returns false when the order is no longer resting", () => {
    const book = new OrderBook();
    expect(book.removeOrderById(OrderSide.BUY, 100, "nonexistent")).toBe(false);
  });

  it("removeOrderById removes a specific resting order and returns true", () => {
    const book = new OrderBook();
    const order = makeOrder({ side: OrderSide.SELL, pricePerUnit: 100 });
    book.addOrder(order);

    expect(book.removeOrderById(OrderSide.SELL, 100, order.id)).toBe(true);
    expect(book.getAskPrices()).toEqual([]);
  });

  it("computes cumulative quantity per level in a snapshot", () => {
    const book = new OrderBook();
    book.addOrder(makeOrder({ side: OrderSide.BUY, pricePerUnit: 100, quantity: 2 }));
    book.addOrder(makeOrder({ side: OrderSide.BUY, pricePerUnit: 100, quantity: 3 }));
    book.addOrder(makeOrder({ side: OrderSide.BUY, pricePerUnit: 95, quantity: 1 }));

    const snapshot = book.getOrderBookSnapshot();
    expect(snapshot.bids).toEqual([
      { price: 100, quantity: 5, cumulativeQuantity: 5 },
      { price: 95, quantity: 1, cumulativeQuantity: 6 },
    ]);
  });

  it("silently ignores an order with no price rather than corrupting the book", () => {
    const book = new OrderBook();
    book.addOrder(makeOrder({ pricePerUnit: undefined as unknown as number }));
    expect(book.getBidPrices()).toEqual([]);
  });
});
