'use client';

import { useEffect, useRef } from 'react';
import { CandlestickData, Time } from 'lightweight-charts';
import { TooltipProps } from '../../types/charts';

export default function Tooltip({ chart, candlestickSeries, volumeSeries }: TooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chart || !candlestickSeries || !tooltipRef.current) return;

    const tooltip = tooltipRef.current;
    tooltip.style.position = 'absolute';
    tooltip.style.background = 'rgba(0, 0, 0, 0.8)';
    tooltip.style.color = '#ffffff';
    tooltip.style.padding = '8px';
    tooltip.style.borderRadius = '4px';
    tooltip.style.display = 'none';
    tooltip.style.zIndex = '1000';

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !tooltipRef.current) return;

      const data = param.seriesData.get(candlestickSeries) as CandlestickData<Time>;
      const volumeData = volumeSeries ? (param.seriesData.get(volumeSeries) as { value: number }) : null;

      if (data) {
        tooltipRef.current.style.display = 'block';
        tooltipRef.current.style.left = `${param.point.x + 10}px`;
        tooltipRef.current.style.top = `${param.point.y + 10}px`;
        tooltipRef.current.innerHTML = `
          <div>Time: ${param.time}</div>
          <div>Open: ${data.open}</div>
          <div>High: ${data.high}</div>
          <div>Low: ${data.low}</div>
          <div>Close: ${data.close}</div>
          <div>Volume: ${volumeData?.value || 'N/A'}</div>
        `;
      } else {
        tooltipRef.current.style.display = 'none';
      }
    });

    return () => {
      if (tooltipRef.current) {
        tooltipRef.current.remove();
      }
    };
  }, [chart, candlestickSeries, volumeSeries]);

  return <div ref={tooltipRef} />;
}