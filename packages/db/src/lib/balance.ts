import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type TxClient = Prisma.TransactionClient;
type Amount = Prisma.Decimal | number;

export class InsufficientBalanceError extends Error {
  constructor(public asset: string) {
    super(`Insufficient available balance of ${asset}`);
    this.name = "InsufficientBalanceError";
  }
}

export async function getBalances(userId: string) {
  return prisma.balance.findMany({ where: { userId }, orderBy: { asset: "asc" } });
}

// Demo-only: grants a new account starting funds so the exchange is usable
// immediately after registering, without a deposit flow.
const DEMO_SEED_BALANCES: Array<{ asset: string; available: number }> = [
  { asset: "USDT", available: 50000 },
  { asset: "USDC", available: 50000 },
  { asset: "BTC", available: 2 },
  { asset: "ETH", available: 25 },
];

export async function seedDemoBalances(userId: string) {
  await prisma.$transaction(
    DEMO_SEED_BALANCES.map((b) =>
      prisma.balance.upsert({
        where: { userId_asset: { userId, asset: b.asset } },
        update: {},
        create: { userId, asset: b.asset, available: b.available, reserved: 0 },
      })
    )
  );
}

/**
 * Atomically moves `amount` of `asset` from available to reserved for `userId`.
 * The conditional UPDATE (`available >= amount` in the WHERE clause) relies on
 * Postgres's row lock on the matched row to make check-and-decrement atomic —
 * two concurrent reservations against the same row serialize on that lock, so
 * at most one can succeed once funds run out. No optimistic-lock retry loop or
 * SERIALIZABLE isolation is needed for this single-row invariant.
 */
export async function reserveFunds(
  tx: TxClient,
  userId: string,
  asset: string,
  amount: Amount
) {
  const result = await tx.balance.updateMany({
    where: { userId, asset, available: { gte: amount } },
    data: { available: { decrement: amount }, reserved: { increment: amount } },
  });
  if (result.count === 0) {
    throw new InsufficientBalanceError(asset);
  }
}

export async function releaseFunds(
  tx: TxClient,
  userId: string,
  asset: string,
  amount: Amount
) {
  await tx.balance.update({
    where: { userId_asset: { userId, asset } },
    data: { reserved: { decrement: amount }, available: { increment: amount } },
  });
}

export async function debitReserved(
  tx: TxClient,
  userId: string,
  asset: string,
  amount: Amount
) {
  await tx.balance.update({
    where: { userId_asset: { userId, asset } },
    data: { reserved: { decrement: amount } },
  });
}

export async function creditAvailable(
  tx: TxClient,
  userId: string,
  asset: string,
  amount: Amount
) {
  await tx.balance.upsert({
    where: { userId_asset: { userId, asset } },
    update: { available: { increment: amount } },
    create: { userId, asset, available: amount, reserved: 0 },
  });
}
