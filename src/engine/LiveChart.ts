import { createChart, IChartApi, ISeriesApi, CandlestickSeries, LineSeries, TickMarkType } from 'lightweight-charts';
import { Candle } from '../feeds/types';
import { StockPrices } from './StockPrices';
import { IndicatorDef, IndicatorFn } from './Indicators';

export interface PlotPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type PlotListener = (points: PlotPoint[]) => void;

interface ActiveLine {
  series: ISeriesApi<'Line'>;
  fn: IndicatorFn;
}

export class LiveChart {
  private static instance: LiveChart;

  private stockPrices = new StockPrices();
  private listeners: Set<PlotListener> = new Set();
  private currentSymbol = '';
  private unsubUpdate: (() => void) | null = null;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private seriesInitialized = false;

  // Indicator state survives mount/unmount cycles
  private activeIndicators: Map<string, IndicatorDef> = new Map();
  private activeLines: Map<string, ActiveLine> = new Map();

  private constructor() {}

  static getInstance(): LiveChart {
    if (!LiveChart.instance) LiveChart.instance = new LiveChart();
    return LiveChart.instance;
  }

  // ─── Chart lifecycle ───────────────────────────────────────────────────

  mount(container: HTMLElement): void {
    this.chart = createChart(container, {
      layout: { background: { color: '#0f0f0f' }, textColor: '#d1d5db' },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      width: container.clientWidth,
      height: container.clientHeight || 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number, type: TickMarkType) => {
          const d = new Date(time * 1000);
          if (type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          }
          return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        },
      },
      localization: {
        timeFormatter: (time: number) =>
          new Date(time * 1000).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', hour12: false,
          }),
      },
    });

    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.chart?.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight || 400,
      });
    });
    this.resizeObserver.observe(container);

    // Re-attach indicator lines that were active before unmount
    for (const def of this.activeIndicators.values()) this.addIndicatorLines(def);

    if (this.currentSymbol) {
      const candles = this.getCandles(this.currentSymbol);
      this.updateSeries(this.candlesToPoints(candles));
      this.updateIndicators(candles);
    }
  }

  unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.chart?.remove();
    this.chart = null;
    this.series = null;
    this.seriesInitialized = false;
    // Series handles are invalidated; mount() will recreate them
    this.activeLines.clear();
  }

  // ─── Data loading ──────────────────────────────────────────────────────

  async loadChart(symbol: string): Promise<void> {
    this.unsubUpdate?.();

    // Pause outgoing symbol: stops its feed, retains candles for a fast gap-fill on revisit.
    if (this.currentSymbol && this.currentSymbol !== symbol) {
      this.stockPrices.pause(this.currentSymbol);
    }

    this.currentSymbol = symbol;
    this.seriesInitialized = false;

    await this.stockPrices.load(symbol);

    this.unsubUpdate = this.stockPrices.emitter.on(symbol, () => this.emit());
    this.emit();
  }

  subscribe(listener: PlotListener): () => void {
    this.listeners.add(listener);
    if (this.currentSymbol) listener(this.candlesToPoints(this.getCandles(this.currentSymbol)));
    return () => this.listeners.delete(listener);
  }

  // ─── Indicator management ──────────────────────────────────────────────

  /** Toggle an indicator on/off. Returns true if now active. */
  async toggleIndicator(def: IndicatorDef): Promise<boolean> {
    if (this.activeIndicators.has(def.id)) {
      this.activeIndicators.delete(def.id);
      for (const line of def.lines) {
        const active = this.activeLines.get(line.id);
        if (active && this.chart) this.chart.removeSeries(active.series);
        this.activeLines.delete(line.id);
      }
      return false;
    }

    // Pre-load any extra symbols this indicator needs
    for (const sym of def.sources ?? []) {
      await this.stockPrices.load(sym);
    }

    this.activeIndicators.set(def.id, def);
    if (this.chart) {
      this.addIndicatorLines(def);
      if (this.currentSymbol) this.updateIndicators(this.getCandles(this.currentSymbol));
    }
    return true;
  }

  isIndicatorActive(id: string): boolean {
    return this.activeIndicators.has(id);
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  private addIndicatorLines(def: IndicatorDef): void {
    for (const line of def.lines) {
      const series = this.chart!.addSeries(LineSeries, {
        color: line.color,
        lineWidth: 1,
        priceScaleId: line.priceScaleId ?? 'right',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      if (line.priceScaleId) {
        this.chart!.priceScale(line.priceScaleId).applyOptions({
          scaleMargins: { top: 0.75, bottom: 0.05 },
          visible: false,
        });
      }
      this.activeLines.set(line.id, { series, fn: line.fn });
    }
  }

  private getCandles(symbol: string): Candle[] {
    const candles = [...this.stockPrices.getSortedCandles(symbol)];
    const open = this.stockPrices.getOpenCandle(symbol);
    if (open) candles.push(open);
    return candles;
  }

  private candlesToPoints(candles: Candle[]): PlotPoint[] {
    return candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
  }

  private updateSeries(points: PlotPoint[]): void {
    if (!this.series || points.length === 0) return;
    if (!this.seriesInitialized) {
      this.series.setData(
        points.map(p => ({ time: p.time as any, open: p.open, high: p.high, low: p.low, close: p.close }))
      );
      this.seriesInitialized = true;
    } else {
      const last = points[points.length - 1];
      this.series.update({ time: last.time as any, open: last.open, high: last.high, low: last.low, close: last.close });
    }
    this.chart?.timeScale().scrollToRealTime();
  }

  private updateIndicators(primary: Candle[]): void {
    // Build sources map: 'primary' + any extra symbols declared by active indicators
    const sources: Record<string, Candle[]> = { primary };
    for (const def of this.activeIndicators.values()) {
      for (const sym of def.sources ?? []) {
        if (!sources[sym]) sources[sym] = this.getCandles(sym);
      }
    }

    for (const [, { series, fn }] of this.activeLines) {
      const values = fn(sources);
      series.setData(
        primary
          .map((c, i) => ({ time: c.time as any, value: values[i] }))
          .filter(d => isFinite(d.value))
      );
    }
  }

  private emit(): void {
    if (!this.currentSymbol) return;
    const candles = this.getCandles(this.currentSymbol);
    const points = this.candlesToPoints(candles);
    this.updateSeries(points);
    this.updateIndicators(candles);
    for (const listener of this.listeners) listener(points);
  }
}
