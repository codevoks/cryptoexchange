// Populates the order book with resting orders for local demoing/testing.
// Buy prices stay below sell prices on purpose so nothing crosses/matches —
// this is meant to build up book depth, not generate trades.
//
// Usage:
//   AUTH_COOKIE="token=<jwt from your browser's cookies after logging in>" node scripts/floodOrders.js
//
// Requires Node 18+ (uses the built-in fetch).

const API_URL = process.env.API_URL ?? "http://localhost:3000/api/v1/order";
const AUTH_COOKIE = process.env.AUTH_COOKIE;

if (!AUTH_COOKIE) {
  console.error(
    "Missing AUTH_COOKIE env var. Log in via the web app, copy the `token` cookie value, and run:\n" +
      '  AUTH_COOKIE="token=<value>" node scripts/floodOrders.js'
  );
  process.exit(1);
}

const buyPrices = [
  65000, 64950, 64900, 64850, 64800, 64750, 64700, 64650, 64600, 64550,
];
const sellPrices = [
  66000, 66050, 66100, 66150, 66200, 66250, 66300, 66350, 66400, 66450,
];

const ORDERS = [
  ...buyPrices.map((price) => ({
    type: "LIMIT",
    side: "BUY",
    symbol: "BTCUSDT",
    pricePerUnit: price,
    quantity: 0.5,
  })),
  ...sellPrices.map((price) => ({
    type: "LIMIT",
    side: "SELL",
    symbol: "BTCUSDT",
    pricePerUnit: price,
    quantity: 0.5,
  })),
];

async function floodOrders() {
  for (const order of ORDERS) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: AUTH_COOKIE,
        },
        body: JSON.stringify(order),
      });

      if (!res.ok) {
        console.error(`Failed for ${order.side} @ ${order.pricePerUnit}:`, await res.text());
      } else {
        console.log(`Added ${order.side} order @ ${order.pricePerUnit}`);
      }

      await new Promise((r) => setTimeout(r, 150)); // small delay to avoid overload
    } catch (err) {
      console.error(`Error for ${order.side} @ ${order.pricePerUnit}:`, err.message);
    }
  }
}

floodOrders();
