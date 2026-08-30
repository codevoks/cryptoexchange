import { TradePayload } from "@repo/types/trade";
import { Trade } from "@prisma/client";
import { settleTrade } from "@repo/db/index";
import { prisma } from "@repo/db/lib/prisma";

export async function handleTradeInsert(data: TradePayload) {
  try {
    await settleTrade(data);
  } catch (error) {
    console.log("Error settling Trade " + error);
  }
}

export async function getTradesByUser(userId: string): Promise<Trade[]> {
  return prisma.trade.findMany({
    where: {
      OR: [{ buyerId: userId }, { sellerId: userId }],
    },
    orderBy: { timestamp: "desc" },
  });
}
