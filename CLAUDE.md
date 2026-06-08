# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # dev server (localhost:3000)
npm test         # watch-mode tests
npm run build    # production build
npx tsc --noEmit # type-check without emitting
```

## What this project is

A live candlestick chart app. A left panel lists 20 stocks; clicking one loads its 120-minute OHLCV history and streams live 1-second ticks, rendered as 1-minute candlesticks on the right.

## Data flow

```
LivePriceFeed (singleton, setInterval 1 s)
    │ Tick { time, price, volume }
    ▼
StockPrices (one instance per symbol, held by LiveChart)
    │ buffers ticks while history loads, then ingests them
    │ maintains candleMap (closed candles) + openCandle
    │ emits via EventEmitter<{ update: PriceUpdateDetail }>
    ▼
LiveChart (singleton)
    │ subscribes to StockPrices.emitter on loadChart()
    │ owns the lightweight-charts IChartApi via mount(container)
    │ calls series.setData() + scrollToRealTime() on every update
    ▼
PlotChart (React component)
    │ renders a <div> container and passes it to LiveChart.mount()
    │ shows a loading overlay while useLiveChart loading=true
    ▼
App (React)
    └ useLiveChart(symbol) → { loading }
```

## Key classes

### `LivePriceFeed` (`src/engine/LivePriceFeed.ts`) — singleton
Manages one shared `setInterval(1000)` for all subscribed symbols. Each symbol's price state holds `currentMinute` and `currentPrice`. At minute boundaries it resets to `minuteBasePrice` (same seeded walk algorithm as `fetchHistoricalCandles`); each tick applies `±0.15%` noise. Exports `subscribe(symbol, handler) → unsubscribe`.

### `StockPrices` (`src/engine/StockPrices.ts`) — one per symbol
- `open()`: subscribes `LivePriceFeed` immediately, buffers ticks, fetches 120 min history (300 ms simulated latency), drains buffer, starts emitting.
- `close()`: unsubscribes feed, persists watermark to `PlotStore`.
- Key invariants:
  - **Tick buffering**: no ticks lost while history loads.
  - **Historical data is authoritative**: buffered ticks whose bucket is already in `candleMap` are discarded.
  - **Open candle**: current-minute ticks fold into `openCandle` (OHLCV); on minute rollover it is promoted to `candleMap`.
  - **Watermark cap**: `fetchFrom = max(watermark, now − 120 min)` prevents stale watermarks from loading excessive history.

### `EventEmitter` (`src/engine/EventEmitter.ts`)
Generic typed emitter `EventEmitter<Events extends Record<string, unknown>>`. `on(event, handler) → unsubscribe`, `emit(event, payload)`. Used by `StockPrices` to notify `LiveChart` without coupling to `window`.

### `LiveChart` (`src/engine/LiveChart.ts`) — singleton
- `mount(container: HTMLElement)`: creates the `lightweight-charts` chart, `CandlestickSeries`, and `ResizeObserver`. Renders existing data immediately if a symbol is already loaded.
- `unmount()`: removes chart and disconnects observer.
- `loadChart(symbol)`: creates a `StockPrices` instance if new, subscribes to its emitter, calls `emit()`.
- `subscribe(listener)`: React hook entry-point; used only to derive `loading` state.
- On every update: calls `series.setData()` then `timeScale().scrollToRealTime()`.

### `PlotStore` (`src/store/PlotStore.ts`)
Persists per-symbol watermark to `localStorage` (`plot:<symbol>:watermark`). On reopen, `StockPrices` starts the historical fetch from the watermark so only the gap is fetched.

## Mock price feed (`src/feeds/MockPriceFeed.ts`)

### `fetchHistoricalCandles(symbol, fromTs, toTs) → Candle[]`
Generates connected, deterministic candles. Uses a single seeded random walk (seed = `symbolSeedOf(symbol)`) with a **momentum** term (`m * 0.88 + noise * 0.12`, clamped) and **weak mean-reversion** toward 200. Walk starts from EPOCH, steps forward to `fromTs`, then generates one candle per minute:
- `open` = current walk price
- One `walkStep` advances price → `close` (so `open(T+1) == close(T)`, no gaps)
- `high`/`low` = `max/min(open, close) ± ohlcRand() * open * 0.015`

`walkStep` uses **exactly 2 rand() calls per step** — `LivePriceFeed.minuteBasePrice` must match this exactly for history/live continuity.

Wrapped in `setTimeout(300)` to simulate network latency.

### `walkStep(rand, price, momentum) → [price, momentum]`
Exported. Shared by `MockPriceFeed` and `LivePriceFeed` to guarantee the same price walk. Parameters: momentum decay `0.88`, momentum scale `0.025`, noise scale `0.015`, mean-reversion `(200 − price) * 0.0003`.

## Extending to a real price feed

Replace `fetchHistoricalCandles` (REST endpoint returning `Candle[]`) and `LivePriceFeed` (WebSocket emitting `Tick`) with real implementations. `StockPrices` and `LiveChart` are unchanged.

## Key types (`src/feeds/types.ts`)

```ts
Candle  { time: number (unix s), open, high, low, close, volume }
Tick    { time: number, price, volume }
```

## Active source files

```
src/
  App.tsx                        entry, stock selector, layout
  components/
    PlotChart.tsx                container div + loading overlay; calls LiveChart.mount/unmount
    StockList.tsx                left panel, 20 stock buttons
  engine/
    LiveChart.ts                 singleton; owns chart DOM + series + data pipeline
    StockPrices.ts               per-symbol candle store + tick ingestion + emitter
    LivePriceFeed.ts             singleton tick generator (setInterval 1 s)
    EventEmitter.ts              generic typed pub/sub
  feeds/
    MockPriceFeed.ts             deterministic history generator + walkStep
    types.ts                     Candle, Tick
  hooks/
    useLiveChart.ts              loading state bridge between LiveChart and React
  store/
    PlotStore.ts                 localStorage watermark persistence
```
