import { Prisma } from "@prisma/client";
import { parseSymbol } from "@repo/types/symbol";
import { TradePayload } from "@repo/types/trade";
import { prisma } from "./prisma";
import { creditAvailable, debitReserved } from "./balance";

/**
 * Persists a trade and settles both sides' balances/order state in a single
 * transaction, so a trade can never exist in the DB without its balance and
 * order-status effects also having applied (and vice versa).
 *
 * The buyer reserved funds at their own order's limit price at placement
 * time (see order.ts#placeOrder), which for the taker in this trade may be
 * less favorable than the price the trade actually executed at (the resting
 * maker's price — `data.price`) — the difference is refunded back to
 * available. The seller always reserved the base asset 1:1 regardless of
 * price, so there is nothing to refund on that side.
 */
export async function settleTrade(data: TradePayload) {
  const { base, quote } = parseSymbol(data.symbol);
  const tradedQuantity = new Prisma.Decimal(data.quantity);
  const tradePrice = new Prisma.Decimal(data.price);

  return prisma.$transaction(async (tx) => {
    const trade = await tx.trade.create({
      data: {
        buyerOrderId: data.buyerOrderId,
        sellerOrderId: data.sellerOrderId,
        price: data.price,
        quantity: data.quantity,
        side: data.side,
        symbol: data.symbol,
        buyerId: data.buyerId,
        sellerId: data.sellerId,
      },
    });

    const [buyerOrder, sellerOrder] = await Promise.all([
      tx.order.findUnique({ where: { id: data.buyerOrderId } }),
      tx.order.findUnique({ where: { id: data.sellerOrderId } }),
    ]);
    if (!buyerOrder || !sellerOrder) {
      throw new Error(
        `Trade ${trade.id} references an unknown order (buyer=${data.buyerOrderId}, seller=${data.sellerOrderId})`
      );
    }

    const buyerReserved = tradedQuantity.mul(buyerOrder.price);
    const buyerCost = tradedQuantity.mul(tradePrice);
    const buyerRefund = buyerReserved.sub(buyerCost);

    await debitReserved(tx, buyerOrder.userId, quote, buyerReserved);
    if (buyerRefund.greaterThan(0)) {
      await creditAvailable(tx, buyerOrder.userId, quote, buyerRefund);
    }
    await creditAvailable(tx, buyerOrder.userId, base, tradedQuantity);

    await debitReserved(tx, sellerOrder.userId, base, tradedQuantity);
    await creditAvailable(tx, sellerOrder.userId, quote, buyerCost);

    const newBuyerFilled = buyerOrder.filled.add(tradedQuantity);
    const newSellerFilled = sellerOrder.filled.add(tradedQuantity);

    await tx.order.update({
      where: { id: buyerOrder.id },
      data: {
        filled: newBuyerFilled,
        status: newBuyerFilled.greaterThanOrEqualTo(buyerOrder.quantity)
          ? "FILLED"
          : "PENDING",
      },
    });
    await tx.order.update({
      where: { id: sellerOrder.id },
      data: {
        filled: newSellerFilled,
        status: newSellerFilled.greaterThanOrEqualTo(sellerOrder.quantity)
          ? "FILLED"
          : "PENDING",
      },
    });

    return trade;
  });
}
