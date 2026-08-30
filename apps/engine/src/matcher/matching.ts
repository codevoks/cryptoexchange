import { OrderBook } from "../orderbook/orderbook";
import { orderBookRegistry } from "../orderbook/orderbookRegistry";
import { OrderSide } from "@prisma/client";
import { CreateOrderInput } from "@repo/types/order";
import { DEFAULT_SLIPPAGE_PERCENT, computeSlippagePrice } from "@repo/types/order";
import { executeOrder } from "./execute";
import { publishBookUpdate } from "../publisher/publisher";
import { setUpdate } from "@repo/redis-utils/snapshot";
import { MessageType } from "@repo/types/message";
import { tradeBookRegistry } from "../tradebook/tradebookRegistry";

/**
 * Defense-in-depth: the API route already validates and reserves funds
 * before an order ever reaches this queue, but the engine treats the queue
 * as an untrusted boundary too (a malformed message shouldn't be able to
 * corrupt the in-memory book or crash the process).
 */
function isValidOrder(order: CreateOrderInput): boolean {
  if (!order || !order.id || !order.userId || !order.symbol) return false;
  if (order.side !== OrderSide.BUY && order.side !== OrderSide.SELL) return false;
  if (!Number.isFinite(order.quantity) || order.quantity <= 0) return false;
  if (
    order.type === "LIMIT" &&
    (!Number.isFinite(order.pricePerUnit) || order.pricePerUnit! <= 0)
  ) {
    return false;
  }
  return true;
}

export async function match(order: CreateOrderInput) {
  if (!isValidOrder(order)) {
    console.error("Dropping malformed order from queue:", order);
    return;
  }

  const symbol = order.symbol;
  const orderbook = orderBookRegistry.getOrderBook(symbol);
  const tradeBook = tradeBookRegistry.getTradeBook(symbol);
  const targetSide: OrderSide = getTargetSide(order);

  if (!resolveMarketOrderPrice(order, targetSide, orderbook)) {
    console.warn(
      `Dropping MARKET order ${order.id}: no opposite-side liquidity to price against`
    );
    return;
  }

  const ORDERBOOK_CHANNEL =
    process.env.REDIS_CHANNEL_ORDERBOOK_PREFIX + ":" + symbol;
  const TRADEBOOK_CHANNEL =
    process.env.REDIS_CHANNEL_TRADE_PREFIX + ":" + symbol;
  while (order.quantity > 0) {
    const bestPrice = orderbook.getBestPrice(targetSide);
    if (
      !bestPrice ||
      (targetSide === OrderSide.BUY
        ? bestPrice < order.pricePerUnit!
        : bestPrice > order.pricePerUnit!)
    ) {
      // either there is no order at all in the list or the best price is not good enough
      orderbook.addOrder(order);
      const orderbookSnapshot = orderbook.getOrderBookSnapshot();
      publishBookUpdate(
        ORDERBOOK_CHANNEL,
        MessageType.ORDERBOOK,
        orderbookSnapshot
      ); //broadcasting orderbook
      setUpdate(ORDERBOOK_CHANNEL, MessageType.ORDERBOOK, orderbookSnapshot); //setting the updated orderbook for client
      break;
    } else {
      await executeOrder(order, orderbook, tradeBook, bestPrice, targetSide);
      const orderbookSnapshot = orderbook.getOrderBookSnapshot();
      const tradebookSnapshot = tradeBook.getTradeBookSnapshot();
      publishBookUpdate(
        ORDERBOOK_CHANNEL,
        MessageType.ORDERBOOK,
        orderbookSnapshot
      );
      publishBookUpdate(
        TRADEBOOK_CHANNEL,
        MessageType.TRADE,
        tradebookSnapshot
      ); //broadcasting tradebook
      setUpdate(ORDERBOOK_CHANNEL, MessageType.ORDERBOOK, orderbookSnapshot);
      setUpdate(TRADEBOOK_CHANNEL, MessageType.TRADE, tradebookSnapshot); //setting the updated tradebook for client
    }
  }
}

function getTargetSide(order: CreateOrderInput): OrderSide {
  return order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
}

/**
 * MARKET orders arrive from the API route with `pricePerUnit` already set to
 * a slippage-bounded ceiling computed from the live book at submission time —
 * the same ceiling the wallet reservation was sized against, so what a
 * market order can execute at here never exceeds what was actually reserved
 * for it. This is a fallback for the (unusual) case of a MARKET order
 * reaching the queue without a pre-resolved price; it re-derives the same
 * ceiling from the engine's own current book. Returns false when there's no
 * opposite-side liquidity to price against at all, meaning the order cannot
 * be safely matched or rested and should be dropped rather than sit in the
 * book with an arbitrary price.
 */
function resolveMarketOrderPrice(
  order: CreateOrderInput,
  targetSide: OrderSide,
  orderbook: OrderBook
): boolean {
  if (order.type !== "MARKET" || order.pricePerUnit != null) {
    return true;
  }
  const bestOppositePrice = orderbook.getBestPrice(targetSide);
  if (!bestOppositePrice) {
    return false;
  }
  const slippage = order.slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT;
  order.pricePerUnit = computeSlippagePrice(order.side, bestOppositePrice, slippage);
  return true;
}
