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
      await fetch(`/api/v1/order/${id}`, { method: "DELETE" });
      window.dispatchEvent(new Event("balances:refresh"));
    } finally {
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
        <div className="space-y-1">
          {pending.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between text-sm font-mono"
            >
              <span className={o.side === "BUY" ? "text-[#4fff8a]" : "text-[#ff6b6b]"}>
                {o.side} {o.type}
              </span>
              <span className="text-gray-300">
                {Number(o.quantity).toFixed(4)} @ {Number(o.price).toFixed(2)}
              </span>
              <button
                onClick={() => cancelOrder(o.id)}
                disabled={cancellingId === o.id}
                className="ml-2 text-xs text-gray-400 hover:text-red-400"
              >
                {cancellingId === o.id ? "..." : "Cancel"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
