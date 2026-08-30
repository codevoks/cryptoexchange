export interface BalanceView {
  asset: string;
  available: string;
  reserved: string;
}

export interface CancelOrderInput {
  orderId: string;
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  pricePerUnit: number;
}
