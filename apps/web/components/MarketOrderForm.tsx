"use client";

import { useState } from "react";

interface MarketOrderFormProps {
  side: "BUY" | "SELL";
  symbol?: string;
}

export default function MarketOrderForm({
  side,
  symbol,
}: MarketOrderFormProps) {
  const [quantity, setQuantity] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const isBuy = side === "BUY";

  const baseColor = isBuy ? "#1a3e2a" : "#3a1a1a";
  const textColor = isBuy ? "#4fff8a" : "#ff6464";
  const hoverBg = isBuy ? "#215b3a" : "#5b2121";
  const focusRing = isBuy ? "#4fff8a" : "#ff6464";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quantity) return alert("Please enter quantity");
    setMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "MARKET",
          side,
          symbol,
          quantity: Number(quantity),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Failed to place order");
      }

      setMessage(`${side} MARKET order placed successfully!`);
      window.dispatchEvent(new Event("balances:refresh"));
      setQuantity("");
    } catch (err: any) {
      console.error("Error placing market order:", err);
      setMessage(err.message ?? "Failed to place order");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-4">
      <div>
        <label className="text-sm text-gray-400">Quantity</label>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value ? +e.target.value : "")}
          className="w-full bg-[#262626] rounded-md p-2 text-white focus:outline-none"
          style={{
            border: `1px solid transparent`,
            boxShadow: `0 0 0 0 ${focusRing}20`,
          }}
          onFocus={(e) =>
            (e.currentTarget.style.border = `1px solid ${focusRing}`)
          }
          onBlur={(e) =>
            (e.currentTarget.style.border = `1px solid transparent`)
          }
          placeholder="Enter quantity"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className={`mt-2 w-full py-2 rounded-md font-semibold transition-all duration-200 ${
          loading ? "opacity-70 cursor-not-allowed" : ""
        }`}
        style={{
          backgroundColor: baseColor,
          color: textColor,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hoverBg)}
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor = baseColor)
        }
      >
        {loading ? "Placing..." : `${side} MARKET`}
      </button>

      {message && <p className="text-sm text-center mt-1 text-white">{message}</p>}
    </form>
  );
}
