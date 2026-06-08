import { Candle } from '../feeds/types';

export type IndicatorFn = (sources: Record<string, Candle[]>) => number[];

export interface IndicatorLine {
  id: string;
  color: string;
  fn: IndicatorFn;
  priceScaleId?: string;
  referenceLines?: { price: number; color: string }[];
}

export interface IndicatorDef {
  id: string;
  label: string;
  lines: IndicatorLine[];
  sources?: string[];
}

// ─── Incremental SMA ──────────────────────────────────────────────────────
//
// Closed candles are cached; only the open (last) candle is recomputed each
// tick using SMA[i] = SMA[i-1] + (newClose − droppedClose) / period  →  O(1).
// Symbol changes are detected via the compound key time+open (all symbols share
// the same 120-min window start time, so timestamp alone would collide).

export function makeSMAFn(period: number): IndicatorFn {
  let out: number[] = [];
  let closedLen = 0;
  let key = '';

  return ({ primary }) => {
    if (!primary.length) return [];
    const newKey = `${primary[0].time},${primary[0].open}`;
    if (newKey !== key) { out = []; closedLen = 0; key = newKey; }

    // Extend cache for newly-closed candles (at most 1 per call in normal operation)
    for (let i = closedLen; i < primary.length - 1; i++) {
      if (i < period - 1) { out[i] = NaN; }
      else if (i === period - 1) {
        let s = 0; for (let j = 0; j < period; j++) s += primary[j].close;
        out[i] = s / period;
      } else {
        out[i] = out[i - 1] + (primary[i].close - primary[i - period].close) / period;
      }
    }
    closedLen = primary.length - 1;

    // Open candle: O(1) sliding-window step
    const last = primary.length - 1;
    if (last < period - 1) out[last] = NaN;
    else if (last === period - 1) {
      let s = 0; for (let j = 0; j < period; j++) s += primary[j].close;
      out[last] = s / period;
    } else {
      out[last] = out[last - 1] + (primary[last].close - primary[last - period].close) / period;
    }
    out.length = primary.length;
    return out;
  };
}

// ─── Incremental RSI ──────────────────────────────────────────────────────
//
// Stores avgGain/avgLoss at the last closed candle boundary.
// Open candle uses a temporary Wilder step without mutating stored state,
// so the next tick starts from the correct base  →  O(1) per tick.

export function makeRSIFn(period: number): IndicatorFn {
  let out: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  let closedLen = 0;
  let key = '';

  return ({ primary }) => {
    if (!primary.length) return [];
    const newKey = `${primary[0].time},${primary[0].open}`;
    if (newKey !== key) { out = []; avgGain = 0; avgLoss = 0; closedLen = 0; key = newKey; }

    const closedCount = primary.length - 1;
    for (let i = closedLen; i < closedCount; i++) {
      if (i < period) {
        out[i] = NaN;
      } else if (i === period) {
        let ag = 0, al = 0;
        for (let j = 1; j <= period; j++) {
          const d = primary[j].close - primary[j - 1].close;
          if (d > 0) ag += d; else al -= d;
        }
        avgGain = ag / period; avgLoss = al / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      } else {
        const d = primary[i].close - primary[i - 1].close;
        avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    }
    closedLen = closedCount;

    // Open candle: temp Wilder step — stored state is NOT mutated
    const last = primary.length - 1;
    if (last <= period || closedLen < period + 1) {
      out[last] = NaN;
    } else {
      const d = primary[last].close - primary[last - 1].close;
      const ag = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
      const al = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
      out[last] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    out.length = primary.length;
    return out;
  };
}

// ─── Incremental Bollinger Bands ──────────────────────────────────────────
//
// std dev requires the full period window  →  O(period) per open-candle tick,
// but closed candles are cached. The array-reference guard ensures sync() runs
// exactly once per updateIndicators() call across all three band fns.

export function makeBollingerFns(period = 20, mult = 2) {
  let uOut: number[] = [], mOut: number[] = [], lOut: number[] = [];
  let closedLen = 0;
  let lastRef: Candle[] | null = null;
  let key = '';

  function computeAt(primary: Candle[], i: number) {
    if (i < period - 1) { uOut[i] = mOut[i] = lOut[i] = NaN; return; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += primary[j].close;
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (primary[j].close - mean) ** 2;
    const std = Math.sqrt(variance / period);
    uOut[i] = mean + mult * std; mOut[i] = mean; lOut[i] = mean - mult * std;
  }

  function sync(primary: Candle[]) {
    if (primary === lastRef) return;
    lastRef = primary;
    if (!primary.length) return;
    const newKey = `${primary[0].time},${primary[0].open}`;
    if (newKey !== key) { uOut = []; mOut = []; lOut = []; closedLen = 0; key = newKey; }
    const closedCount = primary.length - 1;
    for (let i = closedLen; i < closedCount; i++) computeAt(primary, i);
    closedLen = closedCount;
    computeAt(primary, closedCount); // open candle
    uOut.length = mOut.length = lOut.length = primary.length;
  }

  return {
    upper:  ({ primary }: Record<string, Candle[]>): number[] => { sync(primary); return uOut; },
    middle: ({ primary }: Record<string, Candle[]>): number[] => { sync(primary); return mOut; },
    lower:  ({ primary }: Record<string, Candle[]>): number[] => { sync(primary); return lOut; },
  };
}

// ─── Spread factory ────────────────────────────────────────────────────────

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

const bb = makeBollingerFns(20, 2);

export const PREDEFINED_INDICATORS: IndicatorDef[] = [
  {
    id: 'price60',
    label: 'Price 60m',
    lines: [{
      id: 'price60',
      color: '#34d399',
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
    lines: [{ id: 'sma20', color: '#f59e0b', fn: makeSMAFn(20) }],
  },
  {
    id: 'bollinger',
    label: 'Bollinger',
    lines: [
      { id: 'bb-upper',  color: '#60a5fa', fn: bb.upper  },
      { id: 'bb-middle', color: '#94a3b8', fn: bb.middle },
      { id: 'bb-lower',  color: '#60a5fa', fn: bb.lower  },
    ],
  },
  {
    id: 'rsi14',
    label: 'RSI 14',
    lines: [{
      id: 'rsi14',
      color: '#a78bfa',
      fn: makeRSIFn(14),
      priceScaleId: 'rsi',
    }],
  },
];
