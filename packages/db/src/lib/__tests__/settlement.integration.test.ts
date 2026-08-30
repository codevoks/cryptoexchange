// Integration tests against a real Postgres instance (the reservation and
// settlement logic relies on Postgres row-locking semantics that an
// in-memory/mocked Prisma client can't faithfully reproduce). Skipped
// automatically when DATABASE_URL isn't set, e.g. in environments without a
// database available.
//
//   DATABASE_URL="postgresql://postgres:mypassword@localhost:5432/mydatabase" npx vitest run
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../prisma";
import { placeOrder, finalizeCancelledOrder } from "../order";
import { settleTrade } from "../settlement";
import { InsufficientBalanceError } from "../balance";

const hasDb = Boolean(process.env.DATABASE_URL);
const SYMBOL = "BTCUSDT";

async function createTestUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: "Test User",
      email: `test-${randomUUID()}@example.com`,
      hashedPassword: "not-a-real-hash",
    },
  });
  return user.id;
}

async function grant(userId: string, asset: string, available: number) {
  await prisma.balance.create({ data: { userId, asset, available, reserved: 0 } });
}

const createdUserIds: string[] = [];

async function cleanupUser(userId: string) {
  await prisma.trade.deleteMany({ where: { OR: [{ buyerId: userId }, { sellerId: userId }] } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.balance.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe.skipIf(!hasDb)("wallet reservation + trade settlement (integration)", () => {
  afterAll(async () => {
    for (const id of createdUserIds) {
      await cleanupUser(id).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("reserves quote funds on a BUY order and rejects when insufficient", async () => {
    const buyerId = await createTestUser();
    createdUserIds.push(buyerId);
    await grant(buyerId, "USDT", 1000);

    // Costs 100 * 5 = 500 USDT — affordable.
    const order = await placeOrder({
      id: randomUUID(),
      userId: buyerId,
      type: "LIMIT",
      side: "BUY",
      symbol: SYMBOL,
      quantity: 5,
      pricePerUnit: 100,
    });
    expect(order.status).toBe("PENDING");

    const balance = await prisma.balance.findUniqueOrThrow({
      where: { userId_asset: { userId: buyerId, asset: "USDT" } },
    });
    expect(balance.available.toNumber()).toBe(500);
    expect(balance.reserved.toNumber()).toBe(500);

    // A second order that would need more than the remaining 500 available
    // must be rejected, and must not partially reserve anything.
    await expect(
      placeOrder({
        id: randomUUID(),
        userId: buyerId,
        type: "LIMIT",
        side: "BUY",
        symbol: SYMBOL,
        quantity: 100,
        pricePerUnit: 100,
      })
    ).rejects.toBeInstanceOf(InsufficientBalanceError);

    const unchanged = await prisma.balance.findUniqueOrThrow({
      where: { userId_asset: { userId: buyerId, asset: "USDT" } },
    });
    expect(unchanged.available.toNumber()).toBe(500);
    expect(unchanged.reserved.toNumber()).toBe(500);
  });

  it("settles a trade: debits reserved funds, credits both sides, refunds the buyer's price improvement", async () => {
    const buyerId = await createTestUser();
    const sellerId = await createTestUser();
    createdUserIds.push(buyerId, sellerId);
    await grant(buyerId, "USDT", 1000);
    await grant(sellerId, "BTC", 10);

    // Buyer is willing to pay up to 110, but the resting seller's order (the
    // maker) is priced at 100 — the trade executes at 100, so the buyer
    // should be refunded the 10-per-unit difference.
    const buyOrder = await placeOrder({
      id: randomUUID(),
      userId: buyerId,
      type: "LIMIT",
      side: "BUY",
      symbol: SYMBOL,
      quantity: 2,
      pricePerUnit: 110,
    });
    const sellOrder = await placeOrder({
      id: randomUUID(),
      userId: sellerId,
      type: "LIMIT",
      side: "SELL",
      symbol: SYMBOL,
      quantity: 2,
      pricePerUnit: 100,
    });

    await settleTrade({
      buyerOrderId: buyOrder.id,
      sellerOrderId: sellOrder.id,
      price: 100,
      quantity: 2,
      side: "BUY",
      symbol: SYMBOL,
      buyerId,
      sellerId,
    });

    const [buyerUsdt, buyerBtc, sellerUsdt, sellerBtc, updatedBuyOrder, updatedSellOrder] =
      await Promise.all([
        prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId: buyerId, asset: "USDT" } } }),
        prisma.balance.findUnique({ where: { userId_asset: { userId: buyerId, asset: "BTC" } } }),
        prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId: sellerId, asset: "USDT" } } }),
        prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId: sellerId, asset: "BTC" } } }),
        prisma.order.findUniqueOrThrow({ where: { id: buyOrder.id } }),
        prisma.order.findUniqueOrThrow({ where: { id: sellOrder.id } }),
      ]);

    // Buyer: reserved 220 (2*110), trade cost 200 (2*100) -> 20 refunded to available.
    expect(buyerUsdt.reserved.toNumber()).toBe(0);
    expect(buyerUsdt.available.toNumber()).toBe(1000 - 220 + 20);
    expect(buyerBtc?.available.toNumber()).toBe(2);

    // Seller: reserved 2 BTC, fully debited; credited 200 USDT (2*100).
    expect(sellerBtc.reserved.toNumber()).toBe(0);
    expect(sellerBtc.available.toNumber()).toBe(8);
    expect(sellerUsdt.available.toNumber()).toBe(200);

    expect(updatedBuyOrder.status).toBe("FILLED");
    expect(updatedBuyOrder.filled.toNumber()).toBe(2);
    expect(updatedSellOrder.status).toBe("FILLED");
    expect(updatedSellOrder.filled.toNumber()).toBe(2);
  });

  it("finalizeCancelledOrder releases the unfilled remainder and is idempotent", async () => {
    const userId = await createTestUser();
    createdUserIds.push(userId);
    await grant(userId, "USDT", 1000);

    const order = await placeOrder({
      id: randomUUID(),
      userId,
      type: "LIMIT",
      side: "BUY",
      symbol: SYMBOL,
      quantity: 4,
      pricePerUnit: 100,
    });

    const cancelled = await finalizeCancelledOrder(order.id);
    expect(cancelled?.status).toBe("CANCELLED");

    const balance = await prisma.balance.findUniqueOrThrow({
      where: { userId_asset: { userId, asset: "USDT" } },
    });
    expect(balance.available.toNumber()).toBe(1000);
    expect(balance.reserved.toNumber()).toBe(0);

    // Redelivering the same cancel message must be a no-op, not a double release.
    const secondAttempt = await finalizeCancelledOrder(order.id);
    expect(secondAttempt).toBeNull();

    const balanceAfterSecondAttempt = await prisma.balance.findUniqueOrThrow({
      where: { userId_asset: { userId, asset: "USDT" } },
    });
    expect(balanceAfterSecondAttempt.available.toNumber()).toBe(1000);
  });
});
