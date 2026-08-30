import { OrderType, OrderSide, OrderStatus } from "@prisma/client";
import { z } from "zod";

export const DEFAULT_SLIPPAGE_PERCENT = 0.02;

/**
 * A MARKET order has no limit price of its own, so it needs a bounded price to
 * protect the taker from an unbounded fill in a thin book. This computes that
 * bound from the current best opposing price plus a slippage allowance.
 * Used identically by the API route (to size the wallet reservation) and by
 * the matching engine (as the order's actual matching ceiling), so the amount
 * reserved and the amount the order can actually execute at always agree.
 */
export function computeSlippagePrice(
  side: OrderSide,
  bestOppositePrice: number,
  slippagePercent: number
): number {
  return side === "BUY"
    ? bestOppositePrice * (1 + slippagePercent)
    : bestOppositePrice * (1 - slippagePercent);
}

const SYMBOL_REGEX = /^[A-Z0-9]{5,12}$/;

export const CreateOrderSchema = z
  .object({
    type: z.enum(["MARKET", "LIMIT"]),
    side: z.enum(["BUY", "SELL"]),
    symbol: z.string().regex(SYMBOL_REGEX, "symbol must look like BTCUSDT"),
    quantity: z.number().finite().positive(),
    pricePerUnit: z.number().finite().positive().optional(),
    slippagePercent: z.number().finite().min(0).max(0.5).optional(),
  })
  .refine((data) => data.type !== "LIMIT" || data.pricePerUnit !== undefined, {
    message: "pricePerUnit is required for LIMIT orders",
    path: ["pricePerUnit"],
  });

export type CreateOrderRequest = z.infer<typeof CreateOrderSchema>;

export interface CreateOrderInput {
  id: string;
  userId: string;
  type: OrderType;
  side: OrderSide;
  symbol: string;
  pricePerUnit: number;
  quantity: number;
  slippagePercent?: number;
}

export interface MatchOrderInput {
  id: string;
  userId: string;
  type: OrderType;
  side: OrderSide;
  pricePerUnit: number;
  quantity: number;
  slippagePercent?: number;
}

export interface OrderWithStatus extends CreateOrderInput {
  filled: string;
  status: OrderStatus;
  createdAt: Date;
}