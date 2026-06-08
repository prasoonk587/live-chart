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

### Key design decisions

- **Tick buffering** — the live feed subscribes before history loads; ticks are buffered and drained after history arrives so no ticks are lost.
- **Historical data is authoritative** — buffered ticks whose minute bucket already exists in `candleMap` are silently discarded.
- **Pause / resume** — switching symbols pauses the old feed (retains candles) and only fetches the gap on revisit, not the full 120-min window.
- **`seriesInitialized` flag** — avoids rebuilding the full series on every tick; `series.update()` appends the last bar in O(1).
- **Singleton pattern** — `LivePriceFeed` are singletons so the chart DOM and shared interval survive React re-renders.

---

## Design Q&A

### Indicator implementations

**1. Price over the last 60 minutes — where does the visible hour come from the instant the plot opens?**

`StockPrices.load()` fetches 120 minutes of history on every plot open (`HISTORY_WINDOW = 120 * 60` seconds). That fetch completes before any live ticks are emitted to the chart. The Price 60m indicator receives a 120-candle array and marks the first 60 entries as `NaN`, leaving only the most recent 60 visible. No second fetch, no special case — the data is already there.

**2. SMA 20 — at the very first live tick, where do the other 19 points come from?**

Same answer: the 120-candle history prefetch. By the time the first live tick fires, `sortedCandles` already has 120 closed candles. `calcSMA` returns `NaN` for positions `i < 19` and a valid average for every position after that. The first live tick extends the array to 121 entries; the SMA at that position is computed immediately.

**3. Bollinger Bands — two extra series and a rolling window**

`calcBollinger(candles, 20, 2)` runs one `calcSMA` pass for the middle band, then a second pass computing rolling standard deviation over the same 20-candle window. Three `LineSeries` are registered under a single `IndicatorDef` (upper, middle, lower). The engine has no Bollinger-specific code — it calls the generic `IndicatorFn` signature `(sources) => number[]` and routes the output to whichever series the line is mapped to.

**4. RSI 14 — an indicator the engine has never seen**

RSI was added as a predefined `IndicatorDef` with `priceScaleId: 'rsi'` so it renders in a separate pane. The engine has no RSI-specific code; it calls the same generic `IndicatorFn` and routes the output. Any new indicator — MACD, VWAP, custom formula — works the same way: define a function `(sources) => number[]`, wrap it in an `IndicatorDef`, and pass it to `toggleIndicator`. The engine handles the rest.

**5. Spread between two feeds — can the data model take more than one source?**

Yet to implement

---

### Architecture questions

**Where does the visible history come from when a plot first opens?**

`StockPrices.load(symbol)` fires `fetchHistoricalCandles(symbol, now − 120min, now)` wrapped in a 300 ms `setTimeout` (simulating network latency). The live feed subscribes *before* this fetch, so no ticks are lost — they accumulate in `tickBuffer` and are drained into `candleMap` after the history lands. The chart receives its first render only after both steps complete.

**A user opens a plot, closes it, and reopens it three hours later. What happens?**

On close, `StockPrices.pause(symbol)` stops the feed and saves `watermark = sortedCandles.at(-1).time` in memory (no localStorage). All candles remain in `candleMap`.

On reopen, `resume(symbol)` computes:

```
fetchFrom = max(watermark, now − 120min)
```

If three hours have passed, `now − 120min` is more recent than the watermark, so the gap fetch covers only the most recent 2-hour window. The **1-hour window** between the watermark and `now − 120min` is never fetched — those candles are absent and a visible gap appears in the chart.

The chart does **not** look identical to never having been closed. Old candles from before the pause are still present; new candles from the last 2 hours are filled in; the middle hour is gone.

**A 20-period moving average at the very first live tick — how is it computed?**

The 120-candle history prefetch ensures there are at least 120 closed candles available before the first tick renders. `calcSMA` runs over the full array and returns a valid value for every position `i ≥ 19`. There is no cold-start problem.

**On each new price, do you recompute the series or extend it incrementally? What happens if ticks are dropped?**

Currently `updateIndicators` calls `series.setData(fullArray)` on every tick — full recomputation every second. For a 120-candle window this takes well under 1 ms. The architecture supports incremental stateful closures (`makeSMAFn`, `makeRSIFn`) that maintain a sliding window and emit only the new value, using `series.update(lastBar)` instead of `setData`. The candlestick series already uses this pattern via the `seriesInitialized` flag.

Dropped ticks (`setInterval` stalls from a backgrounded tab or blocked JS thread) cause the open candle to accumulate fewer samples, so its high/low range may be compressed. The minute-boundary rollover is driven by the tick's `time` field, not a count, so the next tick in a new minute correctly promotes the open candle regardless of how many ticks were missed. No intra-minute gap-fill is performed.

**What do you fetch from the backend, and exactly when?**

| What | When |
|---|---|
| 120-min OHLCV history | Once per symbol, on plot open |
| Gap history (watermark → now) | On revisit of a previously paused symbol |
| Secondary symbol history (spread indicator) | Once per symbol, on `toggleIndicator` |
| Live ticks | Continuously via `setInterval(1000)` while symbol is active |

Nothing is fetched on app load. Nothing is fetched on every tick.

**Where is the seam between historical and realtime data, and how is the line kept continuous?**

`fetchHistoricalCandles` generates candles by walking a seeded random sequence from `EPOCH` forward, consuming **exactly 2 `rand()` calls per minute step**. `LivePriceFeed.minuteBasePrice` runs the identical walk from `EPOCH` to the current minute using the same seed and the same exported `walkStep` function.

The result: `historical.close(lastMinute) === live.minuteBasePrice(currentMinute)`. The open price of the first live candle equals the close of the last historical candle — no price jump, no visible seam. The shared `walkStep` export from `MockPriceFeed.ts` is the contract that enforces this invariant.
