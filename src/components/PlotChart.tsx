import { useEffect, useRef } from 'react';
import { useLiveChartInstance } from '../engine/LiveChartContext';
import { useLiveChart } from '../hooks/useLiveChart';

interface PlotChartProps {
  symbol: string;
}

export function PlotChart({ symbol }: PlotChartProps) {
  const chart = useLiveChartInstance();
  const containerRef = useRef<HTMLDivElement>(null);
  const { loading } = useLiveChart(symbol);

  useEffect(() => {
    if (!containerRef.current) return;
    chart.mount(containerRef.current);
    return () => chart.unmount();
  }, [chart]);

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: '#9ca3af', fontSize: 14, zIndex: 10,
          background: 'rgba(15,15,15,0.7)',
        }}>
          Loading history…
        </div>
      )}
      <div ref={containerRef} style={{ height: '100%' }} />
    </div>
  );
}
