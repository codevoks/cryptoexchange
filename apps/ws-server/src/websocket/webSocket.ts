import WebSocket, { WebSocketServer } from "ws";
import { createServer } from "http";
import { redisSubscribe, redisUnsubscribe } from "@repo/redis-utils/pubsub";
import { IncomingMessage } from "http";
import { parseRequestedSymbols, safeParseMessage } from "./symbols";

const WS_PORT = process.env.WS_PORT;

const server = createServer();
const wss = new WebSocketServer({ server });

const clients = new Map<string, Set<WebSocket>>(); // symbol → clients
const subscribedSymbols = new Set<string>(); // symbols we've subscribed on Redis

function broadcast(symbol: string, message: string) {
  const conns = clients.get(symbol);
  if (!conns) return;

  const parsedMessage = safeParseMessage(message);
  if (parsedMessage === undefined) {
    console.error(`Ignoring malformed Redis message on channel for ${symbol}`);
    return;
  }

  for (const ws of conns) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ symbol, data: parsedMessage }));
    }
  }
}

// Subscribe to Redis channels for a symbol on demand
async function handleRedisSubscription(symbol: string) {
  if (subscribedSymbols.has(symbol)) return; // already subscribed
  subscribedSymbols.add(symbol);

  const ORDERBOOK_CHANNEL =
    process.env.REDIS_CHANNEL_ORDERBOOK_PREFIX + ":" + symbol;
  const TRADE_CHANNEL = process.env.REDIS_CHANNEL_TRADE_PREFIX + ":" + symbol;

  await redisSubscribe(ORDERBOOK_CHANNEL, (message: string) =>
    broadcast(symbol, message)
  );
  await redisSubscribe(TRADE_CHANNEL, (message: string) =>
    broadcast(symbol, message)
  );
}

// Unsubscribe when no clients are listening anymore
async function handleRedisUnsubscription(symbol: string) {
  const conns = clients.get(symbol);
  if (conns && conns.size > 0) return;

  const ORDERBOOK_CHANNEL =
    process.env.REDIS_CHANNEL_ORDERBOOK_PREFIX + ":" + symbol;
  const TRADE_CHANNEL = process.env.REDIS_CHANNEL_TRADE_PREFIX + ":" + symbol;
  await redisUnsubscribe(ORDERBOOK_CHANNEL);
  await redisUnsubscribe(TRADE_CHANNEL);
  subscribedSymbols.delete(symbol);
}

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const symbols = parseRequestedSymbols(req.url ?? "");
  if (symbols.length === 0) {
    ws.close(1008, "No valid symbols requested");
    return;
  }

  for (const symbol of symbols) {
    if (!clients.has(symbol)) {
      clients.set(symbol, new Set());
    }
    clients.get(symbol)!.add(ws);
    handleRedisSubscription(symbol).catch((error) =>
      console.error(`Failed to subscribe to Redis for ${symbol}:`, error)
    );
  }

  ws.on("error", (error) => {
    console.error("WebSocket client error:", error);
  });

  ws.on("close", () => {
    for (const symbol of symbols) {
      const conns = clients.get(symbol);
      if (!conns) continue;

      conns.delete(ws);
      if (conns.size === 0) {
        clients.delete(symbol);
        handleRedisUnsubscription(symbol).catch((error) =>
          console.error(`Failed to unsubscribe from Redis for ${symbol}:`, error)
        );
      }
    }
  });
});

// Bind to 0.0.0.0 so the port mapping reaches this server from outside the container
server.listen(Number(WS_PORT) || 8080, "0.0.0.0", () => {
  console.log(`WebSocket server running at ws://0.0.0.0:${WS_PORT || 8080}`);
});
