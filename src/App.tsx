import { useState } from 'react';
import { PlotChart } from './components/PlotChart';
import { StockList } from './components/StockList';
import { IndicatorBar } from './components/IndicatorBar';
import { useLiveChart } from './hooks/useLiveChart';

const STOCKS = [
  'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'META',
  'TSLA', 'NVDA', 'NFLX', 'AMD',  'INTC',
  'ORCL', 'IBM',  'CRM',  'ADBE', 'PYPL',
  'UBER', 'LYFT', 'SNAP', 'PINS', 'SPOT',
];

export default function App() {
  const [selectedStock, setSelectedStock] = useState(STOCKS[0]);
  const { loading } = useLiveChart(selectedStock);

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: '#0f0f0f',
      color: '#f9fafb',
      fontFamily: 'ui-monospace, monospace',
      overflow: 'hidden',
    }}>
      <StockList stocks={STOCKS} selected={selectedStock} onSelect={setSelectedStock} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid #1f2937',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{selectedStock}</span>
        </div>

        <IndicatorBar />

        <div style={{ flex: 1, minHeight: 0 }}>
          <PlotChart loading={loading} />
        </div>
      </div>
    </div>
  );
}
