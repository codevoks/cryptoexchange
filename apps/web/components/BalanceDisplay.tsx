"use client";
import { useCallback, useEffect, useState } from "react";

type Balance = { asset: string; available: string; reserved: string };

export default function BalanceDisplay() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBalances = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/balances");
      if (!res.ok) return;
      const data = await res.json();
      setBalances(data.balances ?? []);
    } catch (err) {
      console.error("Failed to load balances:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 5000);
    window.addEventListener("balances:refresh", fetchBalances);
    return () => {
      clearInterval(interval);
      window.removeEventListener("balances:refresh", fetchBalances);
    };
  }, [fetchBalances]);

  return (
    <div className="bg-[#1E1E1E] border border-gray-700 rounded-xl text-white p-4 shadow-lg">
      <h3 className="font-semibold mb-2 text-gray-300">Balances</h3>
      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : balances.length === 0 ? (
        <p className="text-sm text-gray-500">No balances yet</p>
      ) : (
        <div className="space-y-1">
          {balances.map((b) => (
            <div key={b.asset} className="flex justify-between text-sm font-mono">
              <span className="text-gray-400">{b.asset}</span>
              <span>
                {Number(b.available).toFixed(4)}
                {Number(b.reserved) > 0 && (
                  <span className="text-gray-500">
                    {" "}
                    (+{Number(b.reserved).toFixed(4)} reserved)
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
