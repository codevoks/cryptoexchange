'use client';

import { useEffect, useRef } from 'react';
import { ISeriesApi, HistogramSeries } from 'lightweight-charts';
import { VolumeSeriesProps } from '../../types/charts';

export default function VolumeSeriesComponent({ chart, volumes, onSeriesReady }: VolumeSeriesProps) {
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!chart || !volumes || !volumes.length) {
      onSeriesReady(null);
      return;
    }

    console.log('Creating volume series with volumes:', volumes); // Debug log
    try {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
        base: 0,
      }) as ISeriesApi<'Histogram'>;

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      volumeSeries.setData(volumes);
      volumeSeriesRef.current = volumeSeries;
      onSeriesReady(volumeSeries);
    } catch (error) {
      console.error('Error creating volume series:', error);
    }

    return () => {
      console.log('Disposing volume series'); // Debug log
      if (volumeSeriesRef.current && chart) {
        try {
          chart.removeSeries(volumeSeriesRef.current);
        } catch (error) {
          console.error('Error disposing volume series:', error);
        }
        volumeSeriesRef.current = null;
      }
    };
  }, [chart, volumes, onSeriesReady]);

  return null;
}