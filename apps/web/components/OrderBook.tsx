"use client";
import { MessageType } from "@repo/types/message";
import { useEffect, useState } from "react";

// Get WebSocket URL - must be set at build time via NEXT_PUBLIC_WS_URL
// This is a TEMPORARY fallback - the proper fix is to rebuild the Docker image with the build arg
const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined"
    ? `ws://${window.location.hostname}:8080`
    : undefined);

type Order = {
  price: number;
  quantity: number;
  cumulativeQuantity: number;
};

type Trade = {
  price: number;
  quantity: number;
  side: "BUY" | "SELL";
  timestamp: number;
};

export default function OrderBook({ symbol }: { symbol: string }) {
  const [activeTab, setActiveTab] = useState<"orderbook" | "trades">(
    "orderbook"
  );
  const [bids, setBids] = useState<Order[]>([]);
  const [asks, setAsks] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    const fetchSnapshot = async () => {
      try {
        const res = await fetch(`/api/v1/orderbook?symbol=${symbol}`);
        const result = await res.json();
        const { orderbook, trades } = result;
        console.log("RES is ", result);
        console.log("FETCH orderbook is ", orderbook);
        console.log("FETCH trades is ", trades);

        if (!orderbook?.payload) {
          console.warn("⚠️ Orderbook payload missing!", orderbook);
        }
        if (!trades?.payload?.trade) {
          console.warn("⚠️ Trades payload malformed!", trades);
        }

        if (orderbook?.payload) {
          setBids(
            [...orderbook.payload.bids].sort((a, b) => b.price - a.price)
          );
          setAsks(
            [...orderbook.payload.asks].sort((a, b) => a.price - b.price)
          );
        }

        if (trades?.payload?.trade) {
          setTrades([...trades.payload.trade].reverse().slice(0, 20));
        }
      } catch (err) {
        console.error("Error fetching snapshot:", err);
      }
    };
    fetchSnapshot();
  }, [symbol]);

  useEffect(() => {
    if (!WS_URL) {
      console.error("⚠️ NEXT_PUBLIC_WS_URL is not defined!");
      console.error(
        "⚠️ This means the Docker image was built without the build arg!"
      );
      console.error(
        "⚠️ The WebSocket URL must be set at BUILD TIME, not runtime."
      );
      return;
    }

    const wsUrl = WS_URL + "?symbols=" + symbol;
    console.log("🔌 Connecting to WebSocket:", wsUrl);
    console.log("🔍 WS_URL value:", WS_URL);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("✅ WebSocket connected for symbol:", symbol);
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error for symbol:", symbol, error);
    };

    ws.onclose = (event) => {
      console.log(
        "🔌 WebSocket closed for symbol:",
        symbol,
        "Code:",
        event.code,
        "Reason:",
        event.reason
      );
    };

    ws.onmessage = (event) => {
      console.log("WEBSOCKET MESSAGE");
      const message = JSON.parse(event.data);
      const { messageType, payload } = message.data;
      console.log("MESSAGE TYPE=> " + messageType);
      console.log("PAYLOAD=> " + JSON.stringify(payload));

      if (messageType === MessageType.ORDERBOOK) {
        if (payload?.bids && payload?.asks) {
          setBids([...payload.bids].sort((a, b) => b.price - a.price));
          setAsks([...payload.asks].sort((a, b) => a.price - b.price));
        }
      }

      // if (messageType === MessageType.TRADE) {
      //   if (payload?.trade) {
      //     setTrades((prev) => [payload.trade, ...prev.slice(0, 19)]);
      //   }
      // }
      if (messageType === MessageType.TRADE) {
        if (Array.isArray(payload?.trade)) {
          // Payload is already a complete snapshot
          setTrades(payload.trade.slice(0, 20));
        }
      }
    };
    return () => {
      console.log("🧹 Cleaning up WebSocket for symbol:", symbol);
      ws.close();
    };
  }, [symbol]);

  const renderBars = (orders: Order[], side: "BUY" | "SELL") => {
    const maxCumulative = Math.max(
      ...orders.map((o) => o.cumulativeQuantity),
      1
    );

    return orders.map((order, idx) => {
      const barWidth = (order.cumulativeQuantity / maxCumulative) * 100;
      const overlayColor = side === "BUY" ? "#0f5d30" : "#681a1a";

      return (
        <div
          key={`${side}-${idx}`}
          className="relative flex justify-between text-sm rounded-md overflow-hidden mb-[2px] font-mono"
          style={{
            backgroundColor: `${overlayColor}40`,
          }}
        >
          <div
            className={`absolute top-0 h-full opacity-30 transition-all duration-300 ${
              side === "BUY" ? "left-0" : "right-0"
            }`}
            style={{
              width: `${barWidth}%`,
              backgroundColor: overlayColor,
            }}
          />
          <div className="relative z-10 flex justify-between w-full px-2 py-1">
            <span
              className={side === "BUY" ? "text-[#4fff8a]" : "text-[#ff6b6b]"}
            >
              {side === "BUY" ? "B" : "S"}
            </span>
            <span className="text-gray-300">
              {order.quantity.toFixed(4)} @ ${order.price.toFixed(2)}
            </span>
          </div>
        </div>
      );
    });
  };

  const renderTrades = (trades: Trade[]) => {
    return trades.map((trade, idx) => {
      if (trade?.side) {
        const isBuy = trade.side === "BUY";
        const color = isBuy ? "#4fff8a" : "#ff6b6b";
        return (
          <div
            key={`trade-${idx}`}
            className="flex justify-between text-sm font-mono py-1 px-2 rounded-md mb-[2px]"
            style={{
              backgroundColor: isBuy ? "#1a3e2a40" : "#3a1a1a40",
            }}
          >
            {/* <span className="text-gray-400">
              {new Date(trade.timestamp * 1000).toLocaleTimeString()}
            </span> */}
            <span className="font-semibold" style={{ color }}>
              {trade.side === "BUY" ? "B" : "S"}
            </span>
            <span>
              {trade.quantity.toFixed(4)} @ {trade.price.toFixed(2)}
            </span>
          </div>
        );
      }
    });
  };
  return (
    <div className="w-[20%] h-[500px] bg-[#1E1E1E] border border-gray-700 rounded-xl text-white p-4 flex flex-col shadow-lg">
      {/* Tabs */}
      <div className="flex w-full mb-4">
        <button
          onClick={() => setActiveTab("orderbook")}
          className={`flex-1 py-2 text-center font-semibold rounded-t-md transition-all duration-200 ${
            activeTab === "orderbook"
              ? "bg-[#ff6600] text-white"
              : "bg-transparent text-gray-400 hover:text-white border-b border-[#ff6600]"
          }`}
        >
          Order Book
        </button>
        <button
          onClick={() => setActiveTab("trades")}
          className={`flex-1 py-2 text-center font-semibold rounded-t-md transition-all duration-200 ${
            activeTab === "trades"
              ? "bg-[#ff6600] text-white"
              : "bg-transparent text-gray-400 hover:text-white border-b border-[#ff6600]"
          }`}
          style={{ flex: "0.8" }}
        >
          Trades
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-1 overflow-y-auto custom-scrollbar">
        {activeTab === "orderbook" ? (
          <>
            {renderBars(asks, "SELL")}
            <div className="my-2 border-t border-gray-700"></div>
            {renderBars(bids, "BUY")}
          </>
        ) : (
          renderTrades(trades)
        )}
      </div>

      {/* Orange Scrollbar Styling */}
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #262626;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #ff6600;
          border-radius: 10px;
          border: 2px solid #262626;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: #ff8533;
        }
        /* Firefox */
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: #ff6600 #262626;
        }
      `}</style>
    </div>
  );
}
