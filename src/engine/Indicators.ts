import { Candle } from '../feeds/types';

// sources['primary'] = the current chart symbol's candles.
// sources[sym]       = any additional symbol declared in IndicatorDef.sources.
export type IndicatorFn = (sources: Record<string, Candle[]>) => number[];

export interface IndicatorLine {
  id: string;
  color: string;
  fn: IndicatorFn;
  /** If set, the line is drawn on an isolated price scale (e.g. 'rsi') */
  priceScaleId?: string;
}

export interface IndicatorDef {
  id: string;
  label: string;
  lines: IndicatorLine[];
  /** Extra symbols that must be loaded before this indicator can run. */
  sources?: string[];
}

// ─── Calculation helpers ───────────────────────────────────────────────────

function calcSMA(candles: Candle[], period: number): number[] {
  return candles.map((_, i) => {
    if (i < period - 1) return NaN;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    return sum / period;
  });
}

function calcBollinger(candles: Candle[], period = 20, mult = 2) {
  const middle = calcSMA(candles, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue; }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (candles[j].close - middle[i]) ** 2;
    }
    const std = Math.sqrt(variance / period);
    upper.push(middle[i] + mult * std);
    lower.push(middle[i] - mult * std);
  }
  return { upper, middle, lower };
}

function calcRSI(candles: Candle[], period = 14): number[] {
  const result = new Array<number>(candles.length).fill(NaN);
  if (candles.length < period + 1) return result;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// ─── Spread factory ────────────────────────────────────────────────────────

/**
 * Returns an IndicatorDef that plots (primary.close − symbolB.close) aligned
 * by timestamp. Works for any current chart symbol; NaN where timestamps don't
 * overlap.  Call toggleIndicator(makeSpread('MSFT')) to activate.
 */
export function makeSpread(symbolB: string): IndicatorDef {
  return {
    id: `spread:${symbolB}`,
    label: `vs ${symbolB}`,
    sources: [symbolB],
    lines: [{
      id: `spread:${symbolB}`,
      color: '#fb923c',
      fn: ({ primary, [symbolB]: b }) => {
        const bMap = new Map((b ?? []).map(c => [c.time, c.close]));
        return (primary ?? []).map(c => {
          const bClose = bMap.get(c.time);
          return bClose !== undefined ? c.close - bClose : NaN;
        });
      },
    }],
  };
}

// ─── Predefined indicators ─────────────────────────────────────────────────

export const PREDEFINED_INDICATORS: IndicatorDef[] = [
  {
    id: 'price60',
    label: 'Price 60m',
    lines: [{
      id: 'price60',
      color: '#34d399',
      // Close price for the last 60 candles; NaN before that so no line is drawn.
      // The full 60 minutes are available immediately because fetchHistoricalCandles
      // pre-fetches HISTORY_WINDOW = 120 min of data before any live ticks arrive.
      fn: ({ primary }) => {
        const values = new Array<number>(primary.length).fill(NaN);
        const from = Math.max(0, primary.length - 60);
        for (let i = from; i < primary.length; i++) values[i] = primary[i].close;
        return values;
      },
    }],
  },
  {
    id: 'sma20',
    label: 'SMA 20',
    lines: [{ id: 'sma20', color: '#f59e0b', fn: ({ primary }) => calcSMA(primary, 20) }],
  },
  {
    id: 'bollinger',
    label: 'Bollinger',
    lines: [
      { id: 'bb-upper',  color: '#60a5fa', fn: ({ primary }) => calcBollinger(primary).upper },
      { id: 'bb-middle', color: '#94a3b8', fn: ({ primary }) => calcBollinger(primary).middle },
      { id: 'bb-lower',  color: '#60a5fa', fn: ({ primary }) => calcBollinger(primary).lower },
    ],
  },
  {
    id: 'rsi14',
    label: 'RSI 14',
    lines: [{
      id: 'rsi14',
      color: '#a78bfa',
      fn: ({ primary }) => calcRSI(primary, 14),
      priceScaleId: 'rsi',
    }],
  },
  // Cross-symbol spread: pre-loads GOOGL and plots (current − GOOGL) per minute.
  makeSpread('GOOGL'),
];
