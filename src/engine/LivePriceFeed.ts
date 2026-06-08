import { Tick } from '../feeds/types';
import { symbolSeedOf, walkStep } from '../feeds/MockPriceFeed';

const EPOCH = 1700000000;
const MINUTE = 60;

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// Must use the same walk algorithm as fetchHistoricalCandles (2 rand calls/step).
function minuteBasePrice(symSeed: number, minuteTs: number): number {
  const rand = seededRandom(symSeed);
  let price = 100;
  let momentum = 0;
  const steps = (minuteTs - EPOCH) / MINUTE;
  for (let i = 0; i < steps; i++) {
    [price, momentum] = walkStep(rand, price, momentum);
  }
  return price;
}

interface SymbolState {
  currentMinute: number;
  currentPrice: number;
}

export class LivePriceFeed {
  private static instance: LivePriceFeed;

  private handlers: Map<string, Set<(tick: Tick) => void>> = new Map();
  private priceState: Map<string, SymbolState> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;

  private constructor() {}

  static getInstance(): LivePriceFeed {
    if (!LivePriceFeed.instance) {
      LivePriceFeed.instance = new LivePriceFeed();
    }
    return LivePriceFeed.instance;
  }

  subscribe(symbol: string, handler: (tick: Tick) => void): () => void {
    if (!this.handlers.has(symbol)) {
      this.handlers.set(symbol, new Set());
    }
    this.handlers.get(symbol)!.add(handler);

    if (!this.priceState.has(symbol)) {
      const now = Math.floor(Date.now() / 1000);
      const minuteTs = Math.floor(now / MINUTE) * MINUTE;
      this.priceState.set(symbol, {
        currentMinute: minuteTs,
        currentPrice: minuteBasePrice(symbolSeedOf(symbol), minuteTs),
      });
    }

    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), 1000);
    }

    return () => {
      const set = this.handlers.get(symbol);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.handlers.delete(symbol);
          this.priceState.delete(symbol);
        }
      }
      if (this.handlers.size === 0 && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  private tick(): void {
    const tickTime = Math.floor(Date.now() / 1000);
    const minute = Math.floor(tickTime / MINUTE) * MINUTE;

    for (const [symbol, handlerSet] of this.handlers) {
      const state = this.priceState.get(symbol)!;

      if (minute !== state.currentMinute) {
        state.currentMinute = minute;
        state.currentPrice = minuteBasePrice(symbolSeedOf(symbol), minute);
      }

      // ±0.15% per tick → live candle accumulates only a small range
      state.currentPrice += (Math.random() - 0.5) * state.currentPrice * 0.003;
      state.currentPrice = Math.max(state.currentPrice, 1);

      const tick: Tick = {
        time: tickTime,
        price: +state.currentPrice.toFixed(4),
        volume: +(Math.random() * 10).toFixed(2),
      };

      for (const handler of handlerSet) {
        handler(tick);
      }
    }
  }
}
