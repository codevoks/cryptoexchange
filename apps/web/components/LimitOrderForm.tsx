"use client";
import { useState } from "react";

interface LimitOrderFormProps {
  side: "BUY" | "SELL";
  symbol?: string; // optional prop for which symbol this order is for
}

export default function LimitOrderForm({ side, symbol }: LimitOrderFormProps) {
  const isBuy = side === "BUY";
  const baseColor = isBuy ? "#1a3e2a" : "#3a1a1a";
  const textColor = isBuy ? "#4fff8a" : "#ff6464";
  const hoverBg = isBuy ? "#215b3a" : "#5b2121";
  const focusRing = isBuy ? "#4fff8a" : "#ff6464";

  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          type: "LIMIT",
          side,
          pricePerUnit: Number(price),
          quantity: Number(quantity),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Failed to place order");
      }

      setMessage(`${side} LIMIT order placed successfully!`);
      window.dispatchEvent(new Event("balances:refresh"));

      setPrice("");
      setQuantity("");
    } catch (err: any) {
      console.error("Error placing order:", err);
      setMessage(err.message ?? "Failed to place order");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="flex flex-col gap-3 mt-4" onSubmit={handleSubmit}>
      {/* PRICE */}
      <div>
        <label className="text-sm text-gray-400">Price Per Unit</label>
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
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
          placeholder="Enter price per unit"
          required
        />
      </div>

      {/* QUANTITY */}
      <div>
        <label className="text-sm text-gray-400">Quantity</label>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
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
          required
        />
      </div>

      {/* SUBMIT */}
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
        {loading ? "Placing..." : `${side} LIMIT`}
      </button>

      {/* MESSAGE */}
      {message && <p className="text-sm text-center mt-1 text-white">{message}</p>}
    </form>
  );
}
