import { NextRequest, NextResponse } from "next/server";
import { getUpdate } from "@repo/redis-utils/snapshot";
import { MessageType } from "@repo/types/message";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbols = searchParams.get("symbol") || "BTCUSDT";
  const orderChannel = MessageType.ORDERBOOK + ":" + symbols;
  const tradeChannel = MessageType.TRADE + ":" + symbols;
  try {
    const orderbook = await getUpdate(orderChannel);
    const trades = await getUpdate(tradeChannel);
    return NextResponse.json({
      orderbook,
      trades,
    });
  } catch {
    console.log("Error while getting data for snapshot");
  }
}
