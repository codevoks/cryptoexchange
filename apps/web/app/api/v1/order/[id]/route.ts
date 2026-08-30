import { NextResponse } from "next/server";
import { QUEUE_NAMES } from "@repo/redis-utils/constants";
import { pushToQueue } from "@repo/redis-utils/queue";
import { getOrderById } from "@repo/db/index";
import { requireUser } from "@/lib/auth/session";

/**
 * Cancellation is a two-step, asynchronous process: this route only verifies
 * ownership and that the order is still cancellable, then hands off to the
 * matching engine via a queue message. The engine — not this route — is what
 * actually removes the order from the book and releases the wallet
 * reservation (apps/engine/src/matcher/cancel.ts), because only the engine
 * can know for certain whether the order is still resting or has already
 * been matched. A 202 here means "cancellation requested", not "cancelled".
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const order = await getOrderById(id);
  if (!order || order.userId !== user.userId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "PENDING") {
    return NextResponse.json(
      { error: `Order is already ${order.status.toLowerCase()}` },
      { status: 409 }
    );
  }

  await pushToQueue(QUEUE_NAMES.CANCELS, {
    orderId: order.id,
    userId: order.userId,
    symbol: order.pair,
    side: order.side,
    pricePerUnit: Number(order.price),
  });

  return NextResponse.json({ message: "Cancellation requested" }, { status: 202 });
}
