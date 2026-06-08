import { Candle, Tick } from './types';

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

const EPOCH = 1700000000;
const CANDLE_INTERVAL = 60;

export function symbolSeedOf(symbol: string): number {
  return symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

// One step of the shared momentum walk.
// Uses exactly 2 rand() calls — LivePriceFeed must match this exactly.
// Multipliers are sized for 2-5% per-candle movement in history.
// Weak mean-reversion toward 200 prevents prices drifting to extremes.
export function walkStep(
  rand: () => number,
  price: number,
  momentum: number
): [price: number, momentum: number] {
  const m = momentum * 0.88 + (rand() - 0.5) * 0.12;
  const meanRevert = (200 - price) * 0.0003;
  const p = Math.max(1, price * (1 + m * 0.025 + (rand() - 0.5) * 0.015) + meanRevert);
  return [p, m];
}

// Returns sequential connected candles: close(T) == open(T+1).
export function fetchHistoricalCandles(
  symbol: string,
  fromTs: number,
  toTs: number
): Candle[] {
  console.log('fetchHistoricalCandles', {symbol,fromTs, toTs })
  const start = Math.ceil(fromTs / CANDLE_INTERVAL) * CANDLE_INTERVAL;
  const end   = Math.floor(toTs  / CANDLE_INTERVAL) * CANDLE_INTERVAL;
  if (start >= end) return [];

  const symSeed = symbolSeedOf(symbol);
  const startStep = (start - EPOCH) / CANDLE_INTERVAL;

  // Walk once from EPOCH to the first candle, carrying momentum forward
  const rand = seededRandom(symSeed);
  let price = 100;
  let momentum = 0;
  for (let i = 0; i < startStep; i++) {
    [price, momentum] = walkStep(rand, price, momentum);
  }

  const candles: Candle[] = [];

  for (let t = start; t < end; t += CANDLE_INTERVAL) {
    const ohlcRand = seededRandom(symSeed * 31337 + t);
    const open = price;
    const vol  = open * 0.015; // wick headroom on top of the walk body

    // Advance one step: the resulting price becomes the close (= next open)
    [price, momentum] = walkStep(rand, price, momentum);
    const close = price;

    candles.push({
      time: t,
      open:   +open.toFixed(4),
      high:   +(Math.max(open, close) + ohlcRand() * vol).toFixed(4),
      low:    +(Math.min(open, close) - ohlcRand() * vol).toFixed(4),
      close:  +close.toFixed(4),
      volume: +(ohlcRand() * 1000).toFixed(2),
    });
  }

  return candles;
}

