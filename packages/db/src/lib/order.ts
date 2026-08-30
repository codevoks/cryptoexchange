import { Prisma, OrderSide, OrderType } from "@prisma/client";
import { parseSymbol } from "@repo/types/symbol";
import { prisma } from "./prisma";
import { reserveFunds, releaseFunds } from "./balance";

export interface PlaceOrderInput {
  id: string;
  userId: string;
  type: OrderType;
  side: OrderSide;
  symbol: string;
  quantity: number;
  /**
   * The order's limit price. Required for LIMIT orders. For MARKET orders the
   * caller (the order API route) must have already resolved this to a
   * slippage-bounded ceiling via computeSlippagePrice using the live book —
   * that same number is both what gets reserved here and what the matching
   * engine treats as the order's matching ceiling, so reservation and
   * execution can never disagree.
   */
  pricePerUnit: number;
}

/**
 * Reserves the required funds and creates the Order row in one transaction:
 * an order is never visible to the matching engine without funds already
 * held against it, and funds are never held without a corresponding order.
 * Throws InsufficientBalanceError if the user doesn't have enough available
 * balance of the required asset.
 */
export async function placeOrder(input: PlaceOrderInput) {
  const { base, quote } = parseSymbol(input.symbol);
  const requiredAsset = input.side === "BUY" ? quote : base;
  const requiredAmount =
    input.side === "BUY"
      ? new Prisma.Decimal(input.quantity).mul(input.pricePerUnit)
      : new Prisma.Decimal(input.quantity);

  return prisma.$transaction(async (tx) => {
    await reserveFunds(tx, input.userId, requiredAsset, requiredAmount);
    return tx.order.create({
      data: {
        id: input.id,
        userId: input.userId,
        type: input.type,
        side: input.side,
        pair: input.symbol,
        price: input.pricePerUnit,
        quantity: input.quantity,
      },
    });
  });
}

export async function getUserOrders(userId: string) {
  return prisma.order.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function getOrderById(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId } });
}

/**
 * Marks a still-open order CANCELLED and releases whatever quantity is still
 * unfilled back to the owner's available balance. Called by the matching
 * engine once it has actually removed the order from the in-memory book (see
 * apps/engine/src/matcher/cancel.ts) — never by the API route directly —
 * so a cancel can't race a fill: if the order already finished filling before
 * the cancel reached the engine, the engine finds nothing to remove and this
 * is never called, leaving the FILLED status settlement already produced
 * intact.
 *
 * Idempotent: the `status: "PENDING"` guard means a duplicate cancel message
 * (e.g. redelivered after a crash) is a no-op the second time.
 */
export async function finalizeCancelledOrder(orderId: string) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      return null;
    }

    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const remaining = order.quantity.sub(order.filled);
    if (remaining.gt(0)) {
      const { base, quote } = parseSymbol(order.pair);
      const asset = order.side === "BUY" ? quote : base;
      const amount = order.side === "BUY" ? remaining.mul(order.price) : remaining;
      await releaseFunds(tx, order.userId, asset, amount);
    }
    return order;
  });
}
