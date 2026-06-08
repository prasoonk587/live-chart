import { Candle, Tick } from '../feeds/types';
import { fetchHistoricalCandles } from '../feeds/MockPriceFeed';
import { LivePriceFeed } from './LivePriceFeed';
import { EventEmitter } from './EventEmitter';

const CANDLE_INTERVAL = 60;
const HISTORY_WINDOW = 120 * 60;

export interface PriceUpdateDetail {
  tick: Tick;
  openCandle: Candle | null;
  candles: Candle[];
}

interface SymbolState {
  candleMap: Map<number, Candle>;
  openCandle: Candle | null;
  tickBuffer: Tick[];
  historicalDone: boolean;
  paused: boolean;
  watermark: number | null;
  unsubscribeFeed?: () => void;
}

// Manages history + live data for all symbols.
// Fires a separate event per symbol: emitter.on('AAPL', handler)
export class StockPrices {
  readonly emitter = new EventEmitter<Record<string, PriceUpdateDetail>>();

  private symbols: Map<string, SymbolState> = new Map();

  async load(symbol: string): Promise<void> {
    const existing = this.symbols.get(symbol);
    if (existing) {
      if (!existing.paused) return;
      await this.resume(symbol);
      return;
    }

    const state: SymbolState = {
      candleMap: new Map(),
      openCandle: null,
      tickBuffer: [],
      historicalDone: false,
      paused: false,
      watermark: null,
    };
    this.symbols.set(symbol, state);

    const now = Math.floor(Date.now() / 1000);
    const fetchFrom = now - HISTORY_WINDOW;

    state.unsubscribeFeed = LivePriceFeed.getInstance().subscribe(
      symbol,
      (tick) => this.onTick(symbol, tick)
    );

    const historical = await new Promise<Candle[]>((resolve) => {
      setTimeout(() => resolve(fetchHistoricalCandles(symbol, fetchFrom, now)), 300);
    });

    for (const c of historical) state.candleMap.set(c.time, c);

    state.historicalDone = true;
    for (const tick of state.tickBuffer) this.ingestTick(symbol, tick);
    state.tickBuffer = [];
  }

  // Stop the feed but keep candles in memory so a revisit only needs a gap fetch.
  pause(symbol: string): void {
    const state = this.symbols.get(symbol);
    if (!state || state.paused) return;
    state.unsubscribeFeed?.();
    state.unsubscribeFeed = undefined;
    const sorted = this.getSortedCandles(symbol);
    if (sorted.length > 0) state.watermark = sorted[sorted.length - 1].time;
    state.paused = true;
  }

  unload(symbol: string): void {
    const state = this.symbols.get(symbol);
    if (!state) return;
    state.unsubscribeFeed?.();
    this.symbols.delete(symbol);
  }

  getSortedCandles(symbol: string): Candle[] {
    const state = this.symbols.get(symbol);
    if (!state) return [];
    return Array.from(state.candleMap.values()).sort((a, b) => a.time - b.time);
  }

  getOpenCandle(symbol: string): Candle | null {
    return this.symbols.get(symbol)?.openCandle ?? null;
  }

  private async resume(symbol: string): Promise<void> {
    const state = this.symbols.get(symbol)!;
    const now = Math.floor(Date.now() / 1000);
    const fetchFrom = state.watermark
      ? Math.max(state.watermark, now - HISTORY_WINDOW)
      : now - HISTORY_WINDOW;

    state.openCandle = null;
    state.tickBuffer = [];
    state.historicalDone = false;
    state.paused = false;

    state.unsubscribeFeed = LivePriceFeed.getInstance().subscribe(
      symbol,
      (tick) => this.onTick(symbol, tick)
    );

    const gap = await new Promise<Candle[]>((resolve) => {
      setTimeout(() => resolve(fetchHistoricalCandles(symbol, fetchFrom, now)), 300);
    });

    for (const c of gap) state.candleMap.set(c.time, c);
    state.historicalDone = true;
    for (const tick of state.tickBuffer) this.ingestTick(symbol, tick);
    state.tickBuffer = [];
  }

  private onTick(symbol: string, tick: Tick): void {
    const state = this.symbols.get(symbol);
    if (!state) return;

    if (!state.historicalDone) {
      state.tickBuffer.push(tick);
      return;
    }

    this.ingestTick(symbol, tick);
    this.emitter.emit(symbol, {
      tick,
      openCandle: state.openCandle,
      candles: this.getSortedCandles(symbol),
    });
  }

  private ingestTick(symbol: string, tick: Tick): void {
    const state = this.symbols.get(symbol)!;
    const bucketTs = Math.floor(tick.time / CANDLE_INTERVAL) * CANDLE_INTERVAL;

    if (state.candleMap.has(bucketTs)) return;

    if (!state.openCandle || state.openCandle.time !== bucketTs) {
      if (state.openCandle) state.candleMap.set(state.openCandle.time, { ...state.openCandle });
      state.openCandle = {
        time: bucketTs,
        open: tick.price, high: tick.price, low: tick.price, close: tick.price,
        volume: tick.volume,
      };
    } else {
      state.openCandle = {
        ...state.openCandle,
        high: Math.max(state.openCandle.high, tick.price),
        low:  Math.min(state.openCandle.low,  tick.price),
        close: tick.price,
        volume: state.openCandle.volume + tick.volume,
      };
    }
  }
}
