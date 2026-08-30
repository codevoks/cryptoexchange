'use client';

import { useEffect, useRef } from 'react';
import { ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { CandlestickSeriesProps } from '../../types/charts';

export default function CandlestickSeriesComponent({ chart, candles, onSeriesReady }: CandlestickSeriesProps) {
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!chart || !candles.length) return;

    console.log('Creating candlestick series with candles:', candles); // Debug log
    try {
      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        priceScaleId: 'right',
        priceLineVisible: true,
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      }) as ISeriesApi<'Candlestick'>;

      candlestickSeries.setData(candles);
      candlestickSeriesRef.current = candlestickSeries;
      onSeriesReady(candlestickSeries);
    } catch (error) {
      console.error('Error creating candlestick series:', error);
    }

    return () => {
      console.log('Disposing candlestick series'); // Debug log
      if (candlestickSeriesRef.current && chart) {
        try {
          chart.removeSeries(candlestickSeriesRef.current);
        } catch (error) {
          console.error('Error disposing candlestick series:', error);
        }
        candlestickSeriesRef.current = null;
      }
    };
  }, [chart, candles, onSeriesReady]);

  return null;
}