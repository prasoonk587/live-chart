import { useEffect, useState } from 'react';
import { LiveChart } from '../engine/LiveChart';

export function useLiveChart(symbol: string): { loading: boolean } {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    const chart = LiveChart.getInstance();
    const unsub = chart.subscribe((pts) => {
      if (pts.length > 0) setLoading(false);
    });

    chart.loadChart(symbol);

    return unsub;
  }, [symbol]);

  return { loading };
}
