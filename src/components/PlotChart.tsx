import { useEffect, useRef } from 'react';
import { LiveChart } from '../engine/LiveChart';

interface PlotChartProps {
  loading: boolean;
}

export function PlotChart({ loading }: PlotChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = LiveChart.getInstance();
    chart.mount(containerRef.current);
    return () => chart.unmount();
  }, []);

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
