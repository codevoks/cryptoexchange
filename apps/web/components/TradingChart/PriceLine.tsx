'use client';

import { useEffect, useRef } from 'react';
import { IPriceLine } from 'lightweight-charts';
import { PriceLineProps } from '../../types/charts';

export default function PriceLine({ candlestickSeries, candles }: PriceLineProps) {
  const priceLineRef = useRef<IPriceLine | null>(null);

  useEffect(() => {
    if (!candlestickSeries || !candles.length) return;

    const lastCandle = candles[candles.length - 1];
    if (lastCandle) {
      if (priceLineRef.current) {
        candlestickSeries.removePriceLine(priceLineRef.current);
      }
      priceLineRef.current = candlestickSeries.createPriceLine({
        price: lastCandle.close,
        color: '#ffffff',
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'Live Price',
        lineVisible: true,
        axisLabelColor: '#ffffff',
        axisLabelTextColor: '#000000',
      });
    }

    return () => {
      if (priceLineRef.current && candlestickSeries) {
        candlestickSeries.removePriceLine(priceLineRef.current);
      }
    };
  }, [candlestickSeries, candles]);

  return null;
}