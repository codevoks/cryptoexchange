# Cryptoexchange

A real-time crypto exchange backend centered on a price/time-priority matching engine and
transactional wallet settlement. Orders flow through a Redis work queue into a standalone matching
engine; every fill settles wallet balances inside a Postgres transaction (with fund reservation
up front and price-improvement refunds on fill); live orderbook and trade updates stream to
browsers over WebSockets fed by Redis pub/sub.

It does not implement KYC, real payment rails, or regulatory compliance — see
[Trade-offs & limitations](#trade-offs--limitations) for what's deliberately out of scope.

![Trading dashboard: live BTC/USDT chart, order book with a resting partially-filled limit order, and open orders](docs/assets/trading-dashboard.png)

## Architecture

```mermaid
flowchart LR
    Client["Browser"]

    subgraph Web["apps/web (Next.js)"]
        API["API routes\n/api/v1/*"]
    end

    subgraph Engine["apps/engine"]
        Matcher["Matching engine\n(in-memory orderbook per symbol)"]
    end

    WS["apps/ws-server"]

    DB[(PostgreSQL)]
    Redis[(Redis)]

    Client -- "REST: place/cancel order,\nbalances, login" --> API
    Client -- "WebSocket: live orderbook/trades" --> WS

    API -- "reserve funds + create Order\n(Prisma transaction)" --> DB
    API -- "LPUSH ORDER_queue / CANCEL_queue" --> Redis
    Redis -- "BRPOP" --> Matcher

    Matcher -- "LPUSH TRADES_queue" --> Redis
    Redis -- "BRPOP" --> Matcher
    Matcher -- "settle trade: Trade + Order status\n+ balances (Prisma transaction)" --> DB

    Matcher -- "PUBLISH orderbook:*/tradebook:*" --> Redis
    Redis -- "SUBSCRIBE" --> WS
    WS -- "push update" --> Client

    API -- "read latest snapshot\n(GET on initial load)" --> Redis
```

The web app and the engine never call each other directly — everything between them is decoupled
through Redis lists (work queues) and Redis pub/sub (fan-out).

## Key engineering highlights

- **Price/time-priority matching engine** — a standalone Node process consuming orders off a
  Redis queue, matching against an in-memory orderbook per symbol (see
  [apps/engine/src/matcher/matching.ts](apps/engine/src/matcher/matching.ts)).
- **Wallet reservation + transactional settlement** — funds are reserved atomically when an order
  is placed and settled atomically when it trades, including a price-improvement refund to the
  taker when the trade executes better than their limit — a trade can never exist without its
  balance effects, or vice versa.
- **Partial fills, multi-level matching, and slippage-bounded market orders.**
- **Engine-authoritative cancellation** — cancellation is resolved by the matching engine, not the
  API layer, so a cancel can never race an in-flight fill into double-releasing funds.
- **Real-time orderbook/trade streaming** over WebSockets, fed by Redis pub/sub from the engine.
- **JWT session auth** (httpOnly, `secure` in production) with ownership checks on every
  order/balance endpoint.
- **62 automated tests** (Vitest) — matching-engine correctness (price/time priority, partial
  fills), wallet reservation/settlement against a real Postgres instance, auth, and API validation.
- **CI** that runs lint, type-check, tests (against real Postgres + Redis service containers), and
  build on every push/PR — see [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
- **Prometheus metrics** exposed by the engine, WebSocket server, and web app.

## Demo

See [docs/DEMO.md](docs/DEMO.md) for a reproducible, ~2–3 minute walkthrough: two browser sessions,
a resting limit order, a crossing order with a partial fill, live orderbook/balance updates with no
page refresh, and a cancellation with fund release.

*(Video walkthrough: not yet recorded.)*

## How the exchange works

### Order lifecycle

1. **Submit** — `POST /api/v1/order` validates the request (Zod), authenticates the caller from
   their session cookie, and resolves a price: the order's own limit price for a LIMIT order, or a
   slippage-bounded ceiling computed from the current book for a MARKET order.
2. **Reserve** — in one Postgres transaction, the required funds (quote asset for a BUY, base asset
   for a SELL) are moved from `available` to `reserved` on the user's `Balance` row, and the `Order`
   row is created with `status: PENDING`. If funds are insufficient, nothing is created or reserved.
3. **Queue** — the order is pushed onto `ORDER_queue` in Redis.
4. **Match** — the engine's queue consumer pops the order and runs it through the matching loop for
   that symbol's in-memory orderbook (price priority, then time priority within a price level).
5. **Execute** — each fill produces a trade, which is pushed onto `TRADES_queue`.
6. **Settle** — a separate consumer pops the trade and, in one transaction, inserts the `Trade` row,
   updates both orders' `filled`/`status`, debits each side's reserved funds, and credits what each
   side received — refunding the buyer any difference between their reserved limit price and the
   actual (better) execution price.
7. **Publish** — after every book mutation, the engine publishes an updated orderbook/trade snapshot
   over Redis pub/sub (and caches it for late-joining clients), which `apps/ws-server` fans out to
   every WebSocket client subscribed to that symbol.
8. **Cancel** (optional) — `DELETE /api/v1/order/:id` checks ownership and that the order is still
   `PENDING`, then pushes a cancel request onto `CANCEL_queue`. The engine — not the API route —
   removes the order from the book and releases the reservation, because only the engine can know
   for certain whether the order is still resting or has already matched.

### Matching engine

- **Data structure**: one `OrderBook` per symbol, each holding two price→orders maps (bids/asks)
  plus two sorted price arrays. Best price is always index `0`; sibling orders at the same price
  are stored in insertion order, giving FIFO time priority for free.
- **Price priority**: the best bid/ask is always checked first; matching walks progressively worse
  price levels only if the incoming order's remaining quantity requires it.
- **Time priority**: within a price level, the oldest order (array index 0) always fills first.
- **Partial fills**: `Math.min(makerQty, takerQty)` per match step; whichever side has quantity left
  either keeps matching against the next price level or rests in the book.
- **MARKET orders**: priced once, by the API layer, as `bestOpposingPrice × (1 ± slippage)` — the
  same number becomes both the wallet reservation ceiling and the order's matching ceiling, so they
  can never disagree. If there's no opposing liquidity to price against, the order is rejected
  up front rather than resting in the book with an arbitrary price.
- **Complexity**: adding a new price level is `O(n log n)` (the price array is re-sorted); matching
  against an existing level is `O(1)` amortized per resting order touched. Simple and correct at
  this scale; a production book would use a tree/heap for the price index instead of re-sorting an
  array — see [Trade-offs](#trade-offs--limitations).
- **Tests**: [apps/engine/src/orderbook/orderbook.test.ts](apps/engine/src/orderbook/orderbook.test.ts)
  and [apps/engine/src/matcher/matching.test.ts](apps/engine/src/matcher/matching.test.ts) cover no
  match, exact fill, partial fill on each side, price priority across levels, time priority within a
  level, malformed-order rejection, and the no-liquidity MARKET-order case.

### Real-time architecture

Two Redis primitives, used deliberately for different jobs:

- **Lists (`LPUSH`/`BRPOP`)** as work queues for `ORDER_queue`, `TRADES_queue`, and `CANCEL_queue` —
  each message is delivered to exactly one consumer, which is what you want for "match this order
  once" or "settle this trade once."
- **Pub/Sub** (`orderbook:<symbol>`, `tradebook:<symbol>`) for fan-out — every connected WebSocket
  client watching a symbol gets every update, and a Redis `SET`-based snapshot cache lets a client
  that connects mid-session fetch current state immediately instead of waiting for the next event.

`apps/ws-server` subscribes to a symbol's Redis channels only once regardless of how many browser
clients are watching it (reference-counted by an in-memory `Map<symbol, Set<WebSocket>>`), and
unsubscribes once the last client for that symbol disconnects.

For the full data-flow diagram, wallet-settlement invariants, and failure semantics, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech stack

| Layer | Technology |
|---|---|
| Language | TypeScript everywhere |
| Web / API | Next.js 15, React 19 |
| Matching engine | Node.js, esbuild-bundled |
| Realtime | `ws`, Redis pub/sub |
| Database | PostgreSQL, Prisma ORM |
| Queues | Redis lists (`LPUSH`/`BRPOP`) |
| Auth | `jose` (JWT), `bcrypt` |
| Validation | Zod |
| Metrics | `prom-client` (Prometheus) |
| Testing | Vitest |
| Monorepo | Turborepo, npm workspaces |
| Containers | Docker, Docker Compose |

## Repository structure

```
apps/
  web/         Next.js app — pages, API routes, auth, order/balance/orderbook endpoints
  engine/      Matching engine — orderbook, matcher, trade settlement consumer
  ws-server/   WebSocket server — Redis pub/sub → browser fan-out
packages/
  db/          Prisma schema + client, order/balance/settlement transaction logic
  types/       Shared types, Zod schemas, symbol parsing, slippage math
  auth-utils/  JWT sign/verify, password hashing
  redis-utils/ Redis client, queue helpers, pub/sub, snapshot cache
  metrics-utils/ Shared Prometheus registry/counters
  eslint-config/, typescript-config/  Shared tooling config
docs/
  ARCHITECTURE.md  Deeper design doc with data-flow diagrams and known limitations
  DEMO.md          Exact, reproducible demo script
```

## Quick start

Requires Node 20+, npm, and Docker (for Postgres + Redis — no paid services needed).

```bash
git clone https://github.com/codevoks/Cryptoexchange.git
cd Cryptoexchange
npm install
```

Start Postgres and Redis using the services already defined in `docker-compose.yml`:

```bash
docker compose up -d postgres redis
```

Create your env file and apply migrations:

```bash
cp .env.example.local .env
# edit .env — at minimum set a real JWT_SECRET (openssl rand -base64 32)
npm run db:migrate
```

Start everything:

```bash
npm run dev
```

This starts the web app (`:3000`), the matching engine, and the WebSocket server (`:8080`) together
via Turborepo. Open `http://localhost:3000/register`, create an account — new accounts are seeded
with demo balances (USDT, USDC, BTC, ETH) — and you'll land on the dashboard with those balances
visible, ready to place an order immediately.

**Fully containerized alternative** (builds and runs all five services — web, engine, ws-server,
Postgres, Redis):

```bash
cp .env.example.docker .env.docker
docker compose up --build
```

## Running tests

```bash
npm test
```

Runs the full Vitest suite (62 tests) across every package via Turborepo. Matching-engine and
orderbook tests are pure unit tests (no external services needed) — 58 of the 62 run this way.
The remaining 4 (wallet reservation/settlement/cancellation in
`packages/db/src/lib/__tests__/settlement.integration.test.ts`, plus a Redis queue round-trip test)
run against real Postgres/Redis and skip automatically if `DATABASE_URL`/`REDIS_URL` aren't set:

```bash
DATABASE_URL="postgresql://postgres:mypassword@localhost:5432/mydatabase" \
REDIS_URL="redis://localhost:6379" \
npm test
```

## Reliability / correctness

- **Wallet consistency**: every balance mutation happens inside the same Postgres transaction as the
  order/trade row it corresponds to (`packages/db/src/lib/order.ts`, `settlement.ts`). Reservation
  uses a conditional `UPDATE ... WHERE available >= amount`, so Postgres's row lock on the matched
  row — not application-level locking — is what prevents two concurrent orders from overspending the
  same balance.
- **Cancel/fill race**: cancellation is resolved by the engine, not the API route, so a cancel can
  never race a fill into double-releasing or double-crediting funds — see step 8 above.
- **Idempotent cancellation**: `finalizeCancelledOrder` guards on `status: PENDING` in its `UPDATE`,
  so a redelivered cancel message is a no-op rather than a double release.
- **Input validation**: the order-placement endpoint validates type/side/symbol/quantity/price with
  Zod before anything touches the database or the queue.
- **Defense in depth in the engine**: the queue is treated as an untrusted boundary too — a
  malformed order is dropped and logged rather than corrupting the in-memory book or crashing the
  process.
- **WebSocket hardening**: a malformed Redis pub/sub payload is caught and dropped instead of
  throwing inside the redis client's event dispatch (which is not itself wrapped in try/catch, so an
  uncaught throw there would otherwise crash the whole ws-server process).

## Security

- Sessions are JWTs (HS256, 1h expiry, via `jose`) in an httpOnly cookie; `secure` is tied to
  `NODE_ENV`.
- Passwords are hashed with bcrypt; the salt round count is configurable via `SALT_ROUNDS`.
- The order-placement route derives `userId` from the verified session, never from the request
  body, so a client can't place an order as another user.
- Ownership is checked on every ID-addressed resource (cancelling someone else's order returns 404,
  not 403, to avoid confirming the ID exists).
- No secrets are committed — only `.env.example.*` templates are tracked; real env files are
  gitignored.

## Trade-offs & limitations

Documented honestly rather than hidden:

- **Single-instance engine**: the orderbook lives in one process's memory. Running multiple engine
  replicas against the same Redis queue would silently fragment the book — each replica would only
  see the orders it happened to pop, with no shared/replicated state. The architecture assumes
  exactly one engine process per deployment. A production version would need either a single
  active/passive engine with failover, or a sharded-by-symbol design with leader election.
- **No durable order-book snapshotting**: resting limit orders exist only in engine memory. If the
  engine process restarts, open orders are lost from the book (though the `Order` row and the
  reserved funds remain correctly in Postgres — they just never fill).
- **Cancel is asynchronous**: `DELETE /api/v1/order/:id` returns "cancellation requested," not
  "cancelled" — the actual removal happens when the engine processes the queued message. This is a
  deliberate trade-off (correctness over a synchronous cancel), not an oversight.
- **Price-level index is an array, not a heap/tree**: fine at this scale; a production book with
  thousands of price levels would want a structure with better-than-`O(n log n)` insertion.
- **In-memory quantities are IEEE-754 floats, not decimals**: the engine's `OrderBook`/matching loop
  does plain JS arithmetic on `quantity: number` (e.g. a resting `0.1` reduced by `0.04` can print as
  `0.06000000000000005` in a raw orderbook snapshot, though the UI rounds this on display). Postgres
  balances and order records use `Decimal(65,30)` and are exact; only the in-memory book's own
  bookkeeping is affected. A production engine would use a fixed-point/integer representation (e.g.
  smallest-unit integers) throughout the matching path.
- **No dead-letter queue for failed trade settlement**: if a trade's settlement transaction throws,
  the error is logged but the trade is lost from the durability path — it already happened in the
  in-memory book and was broadcast to clients, but never landed in Postgres.
- **No CORS policy or rate limiting**: acceptable for a same-origin Next.js app with no public API
  surface today, but would need to be added before exposing the API cross-origin or publicly.
- **`/api/v1/metrics` is unauthenticated**, consistent with how Prometheus scraping is normally set
  up on an internal network, but it shouldn't be exposed publicly as-is.
- **Frontend is functional, not polished**: the focus of this project is the backend/matching-engine
  architecture; a handful of pre-existing lint warnings (`any` types, `<img>` vs `next/image`) were
  left as known debt rather than a frontend rewrite.

## Future improvements

- Order-book snapshotting/replay so the engine can recover resting orders after a restart.
- A synchronous cancel path (or a client-side "pending cancel" UI state) to close the async-cancel UX gap.
- Deposit/withdrawal endpoints instead of demo-seeded balances.
- Rate limiting and CORS policy if the API is ever exposed beyond the bundled frontend.
