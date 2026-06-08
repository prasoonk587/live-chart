import { useState } from 'react';
import { useLiveChartInstance } from '../engine/LiveChartContext';
import { PREDEFINED_INDICATORS, IndicatorDef } from '../engine/Indicators';

export function IndicatorBar() {
  const chart = useLiveChartInstance();
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());

  const toggle = async (def: IndicatorDef) => {
    await chart.toggleIndicator(def);
    setActiveIds(prev => {
      const next = new Set(prev);
      if (next.has(def.id)) next.delete(def.id);
      else next.add(def.id);
      return next;
    });
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 20px', borderBottom: '1px solid #1f2937', flexShrink: 0,
    }}>
      <span style={{ color: '#4b5563', fontSize: 11, letterSpacing: '0.05em' }}>INDICATORS</span>
      {PREDEFINED_INDICATORS.map(def => {
        const on = activeIds.has(def.id);
        return (
          <button
            key={def.id}
            onClick={() => toggle(def)}
            style={{
              padding: '3px 10px', borderRadius: 4,
              border: `1px solid ${on ? '#6366f1' : '#374151'}`,
              background: on ? '#312e81' : 'transparent',
              color: on ? '#c7d2fe' : '#9ca3af',
              fontSize: 11, cursor: 'pointer',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {def.label}
          </button>
        );
      })}
    </div>
  );
}
