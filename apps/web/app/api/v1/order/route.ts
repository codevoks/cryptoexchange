import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { QUEUE_NAMES } from "@repo/redis-utils/constants";
import { pushToQueue } from "@repo/redis-utils/queue";
import { getUpdate } from "@repo/redis-utils/snapshot";
import {
  CreateOrderSchema,
  computeSlippagePrice,
  DEFAULT_SLIPPAGE_PERCENT,
} from "@repo/types/order";
import { UnsupportedSymbolError } from "@repo/types/symbol";
import { placeOrder, InsufficientBalanceError, getUserOrders } from "@repo/db/index";
import { requireUser } from "@/lib/auth/session";

type OrderBookSnapshotPayload = {
  bids?: { price: number }[];
  asks?: { price: number }[];
};

/**
 * Resolves a MARKET order's price ceiling from the current orderbook
 * snapshot, using the exact same slippage formula the matching engine uses.
 * This price becomes both the wallet reservation amount and the order's
 * matching ceiling, so the two can never disagree (see
 * apps/engine/src/matcher/matching.ts for the engine side of this contract).
 * Returns null if there's no opposite-side liquidity to price against.
 */
async function resolveMarketOrderPrice(
  symbol: string,
  side: "BUY" | "SELL",
  slippagePercent?: number
): Promise<number | null> {
  const channel = `${process.env.REDIS_CHANNEL_ORDERBOOK_PREFIX}:${symbol}`;
  const snapshot = await getUpdate(channel);
  const book = snapshot?.payload as OrderBookSnapshotPayload | undefined;
  const bestOpposite = side === "BUY" ? book?.asks?.[0]?.price : book?.bids?.[0]?.price;
  if (!bestOpposite) return null;
  return computeSlippagePrice(side, bestOpposite, slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT);
}

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orders = await getUserOrders(user.userId);
  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  let pricePerUnit = input.pricePerUnit;
  if (input.type === "MARKET") {
    pricePerUnit = (await resolveMarketOrderPrice(
      input.symbol,
      input.side,
      input.slippagePercent
    )) ?? undefined;
    if (pricePerUnit === undefined) {
      return NextResponse.json(
        { error: "No liquidity available to price this market order" },
        { status: 422 }
      );
    }
  }

  const id = randomUUID();
  try {
    const order = await placeOrder({
      id,
      userId: user.userId,
      type: input.type,
      side: input.side,
      symbol: input.symbol,
      quantity: input.quantity,
      pricePerUnit: pricePerUnit!,
    });

    await pushToQueue(QUEUE_NAMES.ORDERS, {
      id,
      userId: user.userId,
      type: input.type,
      side: input.side,
      symbol: input.symbol,
      quantity: input.quantity,
      pricePerUnit,
      slippagePercent: input.slippagePercent,
    });

    return NextResponse.json({ message: "Order placed", order }, { status: 201 });
  } catch (err) {
    if (err instanceof InsufficientBalanceError || err instanceof UnsupportedSymbolError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Failed to place order:", err);
    return NextResponse.json({ error: "Failed to place order" }, { status: 500 });
  }
}
