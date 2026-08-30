import { OrderSide } from "@prisma/client";
import { CancelOrderInput } from "@repo/types/balance";
import { MessageType } from "@repo/types/message";
import { finalizeCancelledOrder } from "@repo/db/index";
import { setUpdate } from "@repo/redis-utils/snapshot";
import { orderBookRegistry } from "../orderbook/orderbookRegistry";
import { publishBookUpdate } from "../publisher/publisher";

/**
 * The engine is the source of truth for whether a resting order still exists,
 * so cancellation is handled here rather than by the API route mutating the
 * DB directly — that would race a fill that's already in flight. If the
 * order is still resting we remove it and release its reservation; if it's
 * gone (already fully matched before this message arrived) we do nothing and
 * leave the FILLED settlement that already happened untouched.
 */
export async function cancelOrder(input: CancelOrderInput) {
  const orderbook = orderBookRegistry.getOrderBook(input.symbol);
  const removed = orderbook.removeOrderById(
    input.side as OrderSide,
    input.pricePerUnit,
    input.orderId
  );
  if (!removed) {
    return;
  }

  await finalizeCancelledOrder(input.orderId);

  const ORDERBOOK_CHANNEL =
    process.env.REDIS_CHANNEL_ORDERBOOK_PREFIX + ":" + input.symbol;
  const snapshot = orderbook.getOrderBookSnapshot();
  publishBookUpdate(ORDERBOOK_CHANNEL, MessageType.ORDERBOOK, snapshot);
  setUpdate(ORDERBOOK_CHANNEL, MessageType.ORDERBOOK, snapshot);
}
