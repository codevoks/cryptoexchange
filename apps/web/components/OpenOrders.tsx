"use client";
import { useCallback, useEffect, useState } from "react";

type Order = {
  id: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  pair: string;
  price: string;
  quantity: string;
  filled: string;
  status: "PENDING" | "FILLED" | "CANCELLED";
};

export default function OpenOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/order");
      if (!res.ok) return;
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch (err) {
      console.error("Failed to load orders:", err);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 5000);
    window.addEventListener("balances:refresh", fetchOrders);
    return () => {
      clearInterval(interval);
      window.removeEventListener("balances:refresh", fetchOrders);
    };
  }, [fetchOrders]);

  const cancelOrder = async (id: string) => {
    setCancellingId(id);
    try {
      const res = await fetch(`/api/v1/order/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // Cancellation was rejected (e.g. already filled) — let the user retry.
        setCancellingId(null);
        return;
      }
      window.dispatchEvent(new Event("balances:refresh"));
      // Cancellation is asynchronous — the engine, not this request, actually
      // removes the order. Leave the button showing "Cancelling…" until the
      // next poll drops this order out of `pending` below (its own row then
      // disappears along with it), rather than reverting the button the
      // moment this network request finishes.
    } catch (err) {
      console.error("Failed to cancel order:", err);
      setCancellingId(null);
    }
  };

  const pending = orders.filter((o) => o.status === "PENDING");

  return (
    <div className="bg-[#1E1E1E] border border-gray-700 rounded-xl text-white p-4 shadow-lg">
      <h3 className="font-semibold mb-2 text-gray-300">Open Orders</h3>
      {pending.length === 0 ? (
        <p className="text-sm text-gray-500">No open orders</p>
      ) : (
        <div className="space-y-[6px]">
          {pending.map((o) => {
            const remaining = Number(o.quantity) - Number(o.filled);
            const filled = Number(o.filled);
            const isBuy = o.side === "BUY";
            const sideColor = isBuy ? "#4fff8a" : "#ff6b6b";
            const rowBg = isBuy ? "#1a3e2a40" : "#3a1a1a40";
            const isCancelling = cancellingId === o.id;

            return (
              <div
                key={o.id}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm font-mono"
                style={{ backgroundColor: rowBg }}
              >
                <span className="font-semibold" style={{ color: sideColor }}>
                  {o.side} {o.type}
                </span>
                <span className="flex-1 text-right text-gray-300">
                  {remaining.toFixed(4)} @ {Number(o.price).toFixed(2)}
                  {filled > 0 && (
                    <span className="text-gray-500"> ({filled.toFixed(4)} filled)</span>
                  )}
                </span>
                <button
                  onClick={() => cancelOrder(o.id)}
                  disabled={isCancelling}
                  className={`shrink-0 rounded-md border border-[#ff6464]/50 bg-[#3a1a1a] px-2.5 py-1 text-xs font-semibold text-[#ff6464] transition-colors duration-150 hover:bg-[#5b2121] ${
                    isCancelling ? "opacity-60 cursor-not-allowed" : ""
                  }`}
                >
                  {isCancelling ? "Cancelling…" : "Cancel"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
