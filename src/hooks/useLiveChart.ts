import { useEffect, useState } from 'react';
import { useLiveChartInstance } from '../engine/LiveChartContext';

export function useLiveChart(symbol: string): { loading: boolean } {
  const chart = useLiveChartInstance();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    const unsub = chart.subscribe((pts) => {
      if (pts.length > 0) setLoading(false);
    });

    chart.loadChart(symbol);

    return unsub;
  }, [chart, symbol]);

  return { loading };
}
