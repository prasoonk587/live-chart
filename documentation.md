# live-chart

Live candlestick chart app. A left panel lists 20 stocks; clicking one loads its 120-minute OHLCV history and streams live 1-second ticks, rendered as 1-minute candlesticks on the right.

## Run

```bash
npm start
```

Opens at [http://localhost:3000](http://localhost:3000).

---

## Architecture

### Data flow

```
LivePriceFeed (singleton, setInterval 1 s)
    │  Tick { time, price, volume }
    ▼
StockPrices (one instance, holds all symbols)
    │  buffers ticks while history loads, then ingests them
    │  maintains candleMap (closed candles) + openCandle per symbol
    │  emits via EventEmitter<symbol → PriceUpdateDetail>
    ▼
LiveChart (singleton)
    │  subscribes to StockPrices.emitter on loadChart()
    │  owns the lightweight-charts IChartApi via mount(container)
    │  calls series.update() on every tick; series.setData() only on init
    │  runs active indicators and updates their line series
    ▼
PlotChart (React component)
    │  renders a <div> container and passes it to LiveChart.mount()
    │  shows a loading overlay while useLiveChart loading=true
    ▼
App (React)
    └  <StockList> + <IndicatorBar> + <PlotChart symbol={selectedStock}>
```

---

### Key classes

#### `LivePriceFeed` — `src/engine/LivePriceFeed.ts` (singleton)
One shared `setInterval(1000)` for all subscribed symbols. Each symbol has independent price-walk state with a minute-boundary anchor (`minuteBasePrice`) that uses the same `walkStep` algorithm as `MockPriceFeed`, ensuring no gap between history and live prices. Per-second ticks apply ±0.15% noise. `subscribe(symbol, handler)` returns an unsubscribe function; the interval stops automatically when the last subscriber leaves.

#### `StockPrices` — `src/engine/StockPrices.ts`
Manages history + live data for every symbol in a single instance. Each symbol has a `SymbolState` holding `candleMap`, `sortedCandles`, and `openCandle`.

- `load(symbol)` — subscribes the feed immediately (buffering ticks), fetches 120 min of history (300 ms simulated latency), drains the buffer, then starts emitting.
- `pause(symbol)` — stops the feed but keeps candles in memory; saves a watermark so a revisit only fetches the gap.
- `resume(symbol)` — gap-fetches `[watermark → now]`, merges into existing candles, re-subscribes the feed.
- `getSortedCandles(symbol)` — O(1); returns the pre-maintained `sortedCandles` array directly.

`sortedCandles` is rebuilt with `Array.from(candleMap.values())` after bulk history fetches and appended with `push()` (O(1)) on minute rollover — no sort ever runs in the hot path.

`candleMap` (keyed by bucket timestamp) is kept alongside `sortedCandles` for the O(1) duplicate-tick guard in `ingestTick`.

#### `LiveChart` — `src/engine/LiveChart.ts` (singleton)
Owns the `lightweight-charts` DOM and all series. Coordinates between `StockPrices` and React.

- `mount(container)` — creates chart, candlestick series, and `ResizeObserver`. Renders existing data immediately if a symbol is already loaded.
- `unmount()` — removes chart and disconnects observer.
- `loadChart(symbol)` — pauses the previous symbol, resets `seriesInitialized`, loads the new symbol via `StockPrices`, subscribes to its emitter.
- `toggleIndicator(def)` — adds or removes an `IndicatorDef`; creates/destroys `LineSeries` for each line.
- `updateSeries(points)` — calls `series.setData()` on first render (`seriesInitialized = false`), then `series.update(lastBar)` on every subsequent tick.
- `updateIndicators(candles)` — runs each active `IndicatorFn` over the current candles and updates the corresponding line series.

#### `EventEmitter` — `src/engine/EventEmitter.ts`
Generic typed pub/sub: `EventEmitter<Events extends Record<string, unknown>>`. `on(event, handler)` returns an unsubscribe function. No DOM dependency.

#### `Indicators` — `src/engine/Indicators.ts`
Stateless calculation helpers (`calcSMA`, `calcBollinger`, `calcRSI`) and the `IndicatorDef` / `IndicatorFn` types.

```ts
type IndicatorFn = (sources: Record<string, Candle[]>) => number[]
```

`sources['primary']` is always the current chart symbol. Additional symbols listed in `IndicatorDef.sources` are loaded by `LiveChart` and passed in as extra keys — used by the spread indicator.

Predefined indicators: SMA 20, Bollinger Bands (20, 2σ), RSI 14, Price 60m, Spread vs GOOGL.

#### `MockPriceFeed` — `src/feeds/MockPriceFeed.ts`
Generates deterministic, connected candles seeded by symbol. Exports `walkStep(rand, price, momentum)` shared by `LivePriceFeed` so `close(T) == open(T+1)` with no gaps at the history/live boundary.

#### `PlotChart` — `src/components/PlotChart.tsx`
Mounts/unmounts `LiveChart` on a `<div>` ref. Calls `useLiveChart(symbol)` internally for the loading state.

#### `useLiveChart` — `src/hooks/useLiveChart.ts`
Subscribes to `LiveChart` and calls `loadChart(symbol)` on symbol changes. Returns `{ loading }`.

#### `IndicatorBar` — `src/components/IndicatorBar.tsx`
Renders toggle buttons for `PREDEFINED_INDICATORS`. Calls `LiveChart.toggleIndicator(def)` on click.

---

### Key design decisions

- **Tick buffering** — the live feed subscribes before history loads; ticks are buffered and drained after history arrives so no ticks are lost.
- **Historical data is authoritative** — buffered ticks whose minute bucket already exists in `candleMap` are silently discarded.
- **Pause / resume** — switching symbols pauses the old feed (retains candles) and only fetches the gap on revisit, not the full 120-min window.
- **`seriesInitialized` flag** — avoids rebuilding the full series on every tick; `series.update()` appends the last bar in O(1).
- **Singleton pattern** — `LivePriceFeed` are singletons so the chart DOM and shared interval survive React re-renders.
