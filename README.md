# Cryptoexchange

A real-time crypto exchange backend built to demonstrate matching-engine design, order lifecycle
management, and wallet/order consistency — not a basic CRUD app. It runs a standalone matching
engine over a Redis work queue, settles trades and wallet balances inside Postgres transactions,
and streams live orderbook/trade updates to browsers over WebSockets fed by Redis pub/sub.

This is a portfolio/demo project. It intentionally does not implement KYC, real payment rails, or
regulatory compliance — see [Trade-offs & limitations](#trade-offs--limitations).

## Key engineering highlights

- **Price/time-priority matching engine** — a standalone Node process consuming orders off a
  Redis queue, matching against an in-memory orderbook per symbol (see
  [apps/engine/src/matcher/matching.ts](apps/engine/src/matcher/matching.ts)).
- **Wallet reservation + settlement, all inside DB transactions** — funds are reserved atomically
  when an order is placed and settled atomically when it trades, so a trade can never exist without
  its balance effects, or vice versa (see [Reliability / correctness](#reliability--correctness)).
- **Partial fills, multi-level matching, and slippage-bounded market orders.**
- **Async, queue-mediated order cancellation** with no race between a cancel and an in-flight fill.
- **Real-time orderbook/trade streaming** over WebSockets, fed by Redis pub/sub from the engine.
- **JWT session auth** (httpOnly, `secure` in production) with ownership checks on every
  order/balance endpoint.
- **59 automated tests** spanning matching-engine correctness, orderbook data-structure invariants,
  wallet reservation/settlement transactions (against a real Postgres), auth, and API validation.
- **CI** that runs lint, type-check, tests (against real Postgres + Redis service containers), and
  build on every push/PR — see [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
- **Prometheus metrics** exposed by the engine, WebSocket server, and web app.

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

Everything between the web app and the engine is decoupled through Redis lists (work queues) and
Redis pub/sub (fan-out) — the web app and the engine never call each other directly.

## Order lifecycle

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

## Matching engine

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
  against an existing level is `O(1)` amortized per resting order touched. For a portfolio-scale
  orderbook this is simple and correct; a production book would use a tree/heap for the price index
  instead of re-sorting an array — see [Trade-offs](#trade-offs--limitations).
- **Tests**: [apps/engine/src/orderbook/orderbook.test.ts](apps/engine/src/orderbook/orderbook.test.ts)
  and [apps/engine/src/matcher/matching.test.ts](apps/engine/src/matcher/matching.test.ts) cover no
  match, exact fill, partial fill on each side, price priority across levels, time priority within a
  level, malformed-order rejection, and the no-liquidity MARKET-order case.

## Real-time architecture

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
  Zod before anything touches the database or the queue — previously this endpoint had zero runtime
  validation despite handling the one financially-significant write path in the app.
- **Defense in depth in the engine**: the queue is treated as an untrusted boundary too — a
  malformed order is dropped and logged rather than corrupting the in-memory book or crashing the
  process.
- **WebSocket hardening**: a malformed Redis pub/sub payload is caught and dropped instead of
  throwing inside the redis client's event dispatch (which is not itself wrapped in try/catch, so an
  uncaught throw there would previously have crashed the whole ws-server process).

## Security

- Sessions are JWTs (HS256, 1h expiry, via `jose`) in an httpOnly cookie; `secure` is now tied to
  `NODE_ENV` rather than hardcoded off.
- Passwords are hashed with bcrypt; the salt round count is configurable via `SALT_ROUNDS`.
- The order-placement route derives `userId` from the verified session, never from the request
  body, so a client can't place an order as another user.
- Ownership is checked on every ID-addressed resource (cancelling someone else's order returns 404,
  not 403, to avoid confirming the ID exists).
- No secrets are committed. `.env.docker` (previously tracked with a real-looking `JWT_SECRET`) has
  been removed from git and added to `.gitignore`; only `.env.example.*` templates are tracked.

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

## Local setup

Requires Node 20+, npm, and Docker (for Postgres + Redis — no paid services needed).

```bash
git clone https://github.com/codevoks/Cryptoexchange.git
cd Cryptoexchange
npm install
```

Start Postgres and Redis (either your own, or via the provided compose file — see
`docker-compose.yml` for the `postgres`/`redis` services), then create your env file:

```bash
cp .env.example.local .env
# edit .env — at minimum set a real JWT_SECRET (openssl rand -base64 32)
```

Apply migrations and start everything:

```bash
npm run db:migrate
npm run dev
```

This starts the web app (`:3000`), the matching engine, and the WebSocket server (`:8080`) together
via Turborepo. Register an account at `http://localhost:3000/register` — new accounts are seeded
with demo balances (USDT, USDC, BTC, ETH) so you can trade immediately.

**Fully containerized alternative:**

```bash
cp .env.example.docker .env.docker
docker compose up --build
```

## Running tests

```bash
npm test
```

Runs the full Vitest suite across every package via Turborepo. Matching-engine and orderbook tests
are pure unit tests (no external services needed). Wallet/settlement tests
(`packages/db/src/lib/__tests__/settlement.integration.test.ts`) and the Redis queue test run
against real Postgres/Redis and skip automatically if `DATABASE_URL`/`REDIS_URL` aren't set:

```bash
DATABASE_URL="postgresql://postgres:mypassword@localhost:5432/mydatabase" \
REDIS_URL="redis://localhost:6379" \
npm test
```

## Demo

See [docs/DEMO.md](docs/DEMO.md) for an exact, reproducible 2–3 minute demo script (two browser
sessions, a resting limit order, a crossing order, live fill/balance updates, and a cancellation).

*(Video walkthrough: not yet recorded — see docs/DEMO.md for the script to record one.)*

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
- **Price-level index is an array, not a heap/tree**: fine at demo scale; a production book with
  thousands of price levels would want a structure with better-than-`O(n log n)` insertion.
- **In-memory quantities are IEEE-754 floats, not decimals**: the engine's `OrderBook`/matching loop
  does plain JS arithmetic on `quantity: number` (e.g. a resting `0.1` reduced by `0.04` prints as
  `0.06000000000000005` in an orderbook snapshot). Postgres balances and order records use
  `Decimal(65,30)` and are exact; only the in-memory book's *display* precision is affected. A
  production engine would use a fixed-point/integer representation (e.g. smallest-unit integers)
  throughout the matching path.
- **No CORS policy or rate limiting**: acceptable for a same-origin Next.js app with no public API
  surface today, but would need to be added before exposing the API cross-origin or publicly.
- **`/api/v1/metrics` is unauthenticated**, consistent with how Prometheus scraping is normally set
  up on an internal network, but it shouldn't be exposed publicly as-is.
- **Frontend is functional, not polished**: this project's focus is the backend/matching-engine
  architecture; a handful of pre-existing lint warnings (`any` types, `<img>` vs `next/image`) were
  left as known debt rather than a frontend rewrite.
- **Dependency versions**: Next.js is pinned to the latest 15.x (16 is a new major, deliberately not
  adopted mid-portfolio-pass); Prisma is pinned to the latest 6.x for the same reason. See the
  completion report / commit history for the full before/after version list.

## Future improvements

- Order-book snapshotting/replay so the engine can recover resting orders after a restart.
- A synchronous cancel path (or a client-side "pending cancel" UI state) to close the async-cancel UX gap.
- Deposit/withdrawal endpoints instead of demo-seeded balances.
- Rate limiting and CORS policy if the API is ever exposed beyond the bundled frontend.
