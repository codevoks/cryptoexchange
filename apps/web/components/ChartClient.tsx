"use client";

import { useEffect, useState } from "react";
import TradingChart from "@/components/TradingChart";
import CryptoLoader from "@/components/CryptoLoader";
import { UTCTimestamp, CandlestickData, Time } from "lightweight-charts";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import OrderBook from "./OrderBook";
import TradeTrigger from "./TradeTrigger";
import BalanceDisplay from "./BalanceDisplay";
import OpenOrders from "./OpenOrders";

// Types
type VolumeData = {
  time: Time;
  value: number;
  color?: string;
};

type SymbolData = {
  name: string;
  symbol: string;
  fullName: string;
  candles: CandlestickData<Time>[];
  volumes: VolumeData[];
  logo?: string;
};

// CoinGecko ID mapping for common assets
const COINGECKO_IDS: { [key: string]: string } = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  LINK: "chainlink",
};

// Fallback logo
const FALLBACK_LOGO = "https://via.placeholder.com/40?text=Crypto";

// Helpers
function transformBinanceCandle(candle: any): CandlestickData<Time> {
  return {
    time: Math.floor(candle[0] / 1000) as UTCTimestamp,
    open: parseFloat(candle[1]),
    high: parseFloat(candle[2]),
    low: parseFloat(candle[3]),
    close: parseFloat(candle[4]),
  };
}

function transformBinanceVolume(candle: any): VolumeData {
  return {
    time: Math.floor(candle[0] / 1000) as UTCTimestamp,
    value: parseFloat(candle[5]),
    color:
      parseFloat(candle[4]) >= parseFloat(candle[1]) ? "#26a69a" : "#ef5350",
  };
}

export default function ChartClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const symbol = searchParams.get("symbol")?.toUpperCase() || "BTCUSDT";
  const baseAsset = symbol.slice(0, -4);
  const quoteAsset = symbol.slice(-4);

  const [symbolData, setSymbolData] = useState<SymbolData>({
    name: `${baseAsset}/${quoteAsset}`,
    symbol,
    fullName: baseAsset,
    candles: [],
    volumes: [],
    logo: FALLBACK_LOGO,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ New states for price tracking
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);
  const [marketPrice, setMarketPrice] = useState<number | null>(null);

  useEffect(() => {
    async function fetchCoinInfo() {
      try {
        const coinId = COINGECKO_IDS[baseAsset] || baseAsset.toLowerCase();
        const res = await fetch(
          `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinId}`
        );
        if (!res.ok)
          throw new Error(`Failed to fetch CoinGecko data for ${coinId}`);
        const data = await res.json();
        if (data[0]?.image && data[0]?.name) {
          setSymbolData((prev) => ({
            ...prev,
            logo: data[0].image,
            fullName: data[0].name,
          }));
        } else {
          setSymbolData((prev) => ({ ...prev, logo: FALLBACK_LOGO }));
        }
      } catch {
        setSymbolData((prev) => ({ ...prev, logo: FALLBACK_LOGO }));
      }
    }

    async function fetchHistoricalCandles() {
      try {
        setLoading(true);
        setError(null);
        const endTime = Date.now();
        const startTime = endTime - 24 * 60 * 60 * 1000;
        const res = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=1000&startTime=${startTime}&endTime=${endTime}`
        );
        if (!res.ok)
          throw new Error(`Failed to fetch Binance data for ${symbol}`);
        const rawData = await res.json();
        const candles = rawData.map(transformBinanceCandle);
        const volumes = rawData.map(transformBinanceVolume);
        setSymbolData((prev) => ({ ...prev, candles, volumes }));

        // Initialize last price
        if (candles.length > 0) {
          const lastCandle = candles[candles.length - 1];
          setLastPrice(lastCandle.close);
          setMarketPrice(lastCandle.close);
        }
      } catch (err) {
        console.error(err);
        setError(`Failed to load chart data for ${symbol}.`);
      } finally {
        setLoading(false);
      }
    }

    fetchCoinInfo();
    fetchHistoricalCandles();

    // ✅ WebSocket for live price updates
    const ws = new WebSocket(
      `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1m`
    );
    ws.onmessage = (event) => {
      const { k } = JSON.parse(event.data);
      const newCandle = transformBinanceCandle([k.t, k.o, k.h, k.l, k.c]);
      const newVolume = transformBinanceVolume([k.t, k.o, k.h, k.l, k.c, k.v]);

      const currentPrice = parseFloat(k.c);
      setPrevPrice((prev) => lastPrice ?? prev ?? currentPrice);
      setLastPrice(currentPrice);
      setMarketPrice(currentPrice);

      setSymbolData((prev) => {
        const last = prev.candles[prev.candles.length - 1];
        const candles =
          last?.time === newCandle.time
            ? [...prev.candles.slice(0, -1), newCandle]
            : [...prev.candles, newCandle].slice(-1000);
        const volumes =
          last?.time === newCandle.time
            ? [...prev.volumes.slice(0, -1), newVolume]
            : [...prev.volumes, newVolume].slice(-1000);
        return { ...prev, candles, volumes };
      });
    };

    return () => ws.close();
  }, [symbol]);

  const handleRefresh = () => {
    router.refresh();
  };

  return (
    <div className="min-h-screen px-8 py-6 font-sans text-white bg-black">
      {loading && <CryptoLoader logo={symbolData.logo} loading={loading} />}
      {error && <div className="mb-4 text-center text-red-500">{error}</div>}
      {!loading && !error && (
        <>
          {/* ===== HEADER ===== */}
          <div className="flex flex-col items-start justify-between pb-4 mb-6 border-b md:flex-row md:items-center border-accent">
            <div className="flex items-center space-x-6">
              <Link href="/markets">
                <button className="px-5 py-2 font-medium text-black transition border rounded-lg shadow-lg cursor-pointer bg-accent hover:bg-accent-hover border-accent">
                  Back to Markets
                </button>
              </Link>

              {/* ✅ Price Info */}
              <div className="flex items-center space-x-6">
                {/* Last Traded */}
                <div>
                  <span className="text-gray-400 text-sm block">
                    Last Traded
                  </span>
                  <span
                    className="text-lg font-semibold transition-colors duration-300"
                    style={{
                      color:
                        lastPrice && prevPrice
                          ? lastPrice > prevPrice
                            ? "#4fff8a"
                            : lastPrice < prevPrice
                              ? "#ff6464"
                              : "#ffffff"
                          : "#ffffff",
                    }}
                  >
                    {lastPrice?.toFixed(2) ?? "--"}
                  </span>
                </div>

                {/* Market Price */}
                <div>
                  <span className="text-gray-400 text-sm block">Market</span>
                  <span
                    className="text-lg font-semibold transition-colors duration-300"
                    style={{
                      color:
                        marketPrice && lastPrice
                          ? marketPrice > lastPrice
                            ? "#4fff8a"
                            : marketPrice < lastPrice
                              ? "#ff6464"
                              : "#ffffff"
                          : "#ffffff",
                    }}
                  >
                    {marketPrice?.toFixed(2) ?? "--"}
                  </span>
                </div>
              </div>
            </div>

            {/* Symbol Info */}
            <div className="flex items-center space-x-3 mt-4 md:mt-0">
              <img
                src={symbolData.logo}
                alt={`${symbolData.fullName} logo`}
                className="w-10 h-10 rounded-full"
                onError={(e) => (e.currentTarget.src = FALLBACK_LOGO)}
              />
              <div>
                <h2 className="text-3xl font-bold tracking-wide text-accent">
                  {symbolData.fullName} ({symbolData.name})
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Powered by Binance WebSocket
                </p>
              </div>
              <button
                onClick={handleRefresh}
                className="px-5 py-2 ml-4 font-medium text-black transition border rounded-lg shadow-lg cursor-pointer bg-accent hover:bg-accent-hover border-accent"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* ===== CHART + PANELS ===== */}
          <div className="rounded-2xl bg-[#121212] shadow-2xl p-4 border border-gray-800">
            <div className="flex gap-4">
              <div className="w-[60%]">
                <TradingChart symbols={[symbolData]} />
              </div>
              <OrderBook symbol={symbol} />
              <TradeTrigger symbol={symbol} />
            </div>
            <div className="grid grid-cols-1 gap-4 mt-4 md:grid-cols-2">
              <BalanceDisplay />
              <OpenOrders />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
