interface StockListProps {
  stocks: string[];
  selected: string;
  onSelect: (symbol: string) => void;
}

export function StockList({ stocks, selected, onSelect }: StockListProps) {
  return (
    <div style={{
      width: 200,
      flexShrink: 0,
      background: '#111827',
      borderRight: '1px solid #1f2937',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 16px',
        fontSize: 11,
        fontWeight: 600,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        borderBottom: '1px solid #1f2937',
        flexShrink: 0,
      }}>
        Markets
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {stocks.map((s) => (
          <div
            key={s}
            onClick={() => onSelect(s)}
            style={{
              padding: '10px 16px',
              cursor: 'pointer',
              background: s === selected ? '#1e1b4b' : 'transparent',
              borderLeft: `3px solid ${s === selected ? '#6366f1' : 'transparent'}`,
              color: s === selected ? '#e0e7ff' : '#9ca3af',
              fontSize: 13,
              fontFamily: 'ui-monospace, monospace',
              userSelect: 'none',
              transition: 'background 0.1s',
            }}
          >
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}
