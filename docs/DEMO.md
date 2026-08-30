# Demo script (2–3 minutes)

Goal: show the matching engine actually matching, wallet balances actually changing, and updates
arriving over WebSocket without a page refresh — not just clicking around a UI.

## Preparation (before recording)

1. Start the stack:
   ```bash
   docker compose up --build
   # or, without Docker: start Postgres+Redis, then `npm run db:migrate && npm run dev`
   ```
2. Confirm all three services are up:
   ```bash
   docker ps   # crypto-web, crypto-ws, crypto-engine, crypto-postgres, crypto-redis all "Up"
   ```
3. Open two browser windows side by side (or one normal + one incognito, so they don't share the
   session cookie) at `http://localhost:3000`.
4. In **Window A**, register a new account (e.g. `alice@example.com` / `password123`) — this seeds
   demo balances (USDT, USDC, BTC, ETH).
5. In **Window B**, register a second account (e.g. `bob@example.com` / `password123`).
6. In both windows, go to **Markets → BTC/USDT** so both land on
   `http://localhost:3000/dashboard?symbol=BTCUSDT`.
7. Have a terminal ready, tailing the engine's logs:
   ```bash
   docker compose logs -f engine
   ```

## Script

**1. Architecture (10s)** — Show `docs/ARCHITECTURE.md`'s sequence diagram or just narrate: "Orders
go through a Redis queue to a standalone matching engine; fills settle wallet balances inside a
Postgres transaction; updates come back over Redis pub/sub to a WebSocket server."

**2. Show starting state (10s)** — In Window A, point out the **Balances** panel below the chart
(USDT/USDC/BTC/ETH from the demo seed) and the empty **Order Book**.

**3. Place a resting limit order (20s)** — In Window A (Alice), place a **SELL LIMIT**: price
`65000`, quantity `0.1`, symbol BTCUSDT. Click **SELL LIMIT**.
- *Expected*: success message; the order appears in the **Order Book** ask side; the order also
  appears in Alice's **Open Orders** panel with a **Cancel** button.
- *Expected in Window B*: the ask level appears in Bob's order book **without refreshing** — this
  is the WebSocket push from `apps/ws-server`.

**4. Place a crossing order — trigger a match (20s)** — In Window B (Bob), place a **BUY LIMIT**:
price `65000`, quantity `0.04` (a partial fill on purpose). Click **BUY LIMIT**.
- *Expected*: the engine log (terminal) shows the order being matched.
- *Expected in both windows*: the ask level's remaining quantity drops from `0.1` to `0.06`
  (partial fill on the maker side); a new entry appears in the **Trades** tab in both windows,
  live, with no refresh.

**5. Show balances changed (15s)** — In both windows, look at the **Balances** panel:
- Alice: BTC `available` decreased by `0.04` (from reserved), USDT `available` increased by
  `0.04 × 65000 = 2600`.
- Bob: USDT `available`/`reserved` decreased by `2600`, BTC `available` increased by `0.04`.
- Point out this update also arrived without a refresh (the balances panel polls + also refreshes
  immediately after you place an order in the same tab).

**6. Full fill (15s)** — In Window B, place a second **BUY LIMIT** at `65000` for quantity `0.06`
(the remaining resting quantity). *Expected*: the ask level disappears from the book entirely in
both windows (fully consumed), and Alice's **Open Orders** panel no longer lists that order
(status is now `FILLED`).

**7. Cancel an order (15s)** — In Window A, place a new resting order (e.g. BUY LIMIT `60000` /
`0.1`), then click **Cancel** on it in the **Open Orders** panel.
- *Expected*: the order disappears from Alice's open orders and from the order book in both windows
  within roughly a second (this is asynchronous — the API returns "cancellation requested," the
  actual removal happens when the engine processes the queued cancel message — see
  `docs/ARCHITECTURE.md`'s note on why cancellation is engine-authoritative).
- Check Alice's balance: the reserved USDT for that order is released back to `available`.

**8. Matching-engine code + tests (20s)** — Briefly show:
- `apps/engine/src/matcher/matching.ts` — the core matching loop.
- Run the test suite live:
  ```bash
  npm test
  ```
  Point out the matching-engine and wallet-settlement test files passing (price priority, time
  priority, partial fills, insufficient-balance rejection, idempotent cancellation).

**9. Close on architecture/reliability (15s)** — "Every balance mutation happens inside the same
Postgres transaction as the order or trade it belongs to, so the wallet and the order book can never
drift out of sync — even under concurrent requests, because the reservation is a single conditional
UPDATE that Postgres's own row lock makes atomic." Mention the documented trade-offs (single-engine
instance, async cancel) as a sign of deliberate scoping, not oversights.

## Fallback steps if something doesn't work live

- **WebSocket doesn't connect**: check the browser console for the `NEXT_PUBLIC_WS_URL` value it
  tried (`OrderBook.tsx` logs it); confirm `docker compose logs ws-server` shows it bound to
  `0.0.0.0:8080`; fall back to refreshing the page to pull the latest snapshot over REST
  (`GET /api/v1/orderbook`) while narrating that the live-push path is what normally avoids this.
- **Order doesn't match**: confirm both orders are for the *same* symbol and the buy price is
  `>=` the resting sell price; check `docker compose logs engine` for a "Dropping malformed order"
  or "no opposite-side liquidity" log line, which would indicate a data-entry mistake, not a bug.
- **Balances panel looks stale**: it polls every 5s and also refreshes immediately after a
  same-tab order; wait a few seconds or manually refresh once as a fallback.
- **Whole stack won't start**: run `docker compose logs` per-service to find which one failed
  first (usually Postgres not being healthy yet); `docker compose up --build` again after fixing.
