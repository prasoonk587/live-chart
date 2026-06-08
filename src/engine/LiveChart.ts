import { createChart, IChartApi, ISeriesApi, CandlestickSeries, TickMarkType } from 'lightweight-charts';
import { StockPrices } from './StockPrices';

export interface PlotPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type PlotListener = (points: PlotPoint[]) => void;

export class LiveChart {
  private static instance: LiveChart;

  private stockPrices = new StockPrices();
  private listeners: Set<PlotListener> = new Set();
  private currentSymbol = '';
  private unsubUpdate: (() => void) | null = null;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private constructor() {}

  static getInstance(): LiveChart {
    if (!LiveChart.instance) {
      LiveChart.instance = new LiveChart();
    }
    return LiveChart.instance;
  }

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
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.chart?.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight || 400,
      });
    });
    this.resizeObserver.observe(container);

    // Render any data that arrived before the DOM was ready
    if (this.currentSymbol) {
      this.updateSeries(this.computePoints(this.currentSymbol));
    }
  }

  unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.chart?.remove();
    this.chart = null;
    this.series = null;
  }

  async loadChart(symbol: string): Promise<void> {
    this.unsubUpdate?.();
    this.currentSymbol = symbol;

    await this.stockPrices.load(symbol);

    this.unsubUpdate = this.stockPrices.emitter.on(symbol, () => this.emit());
    this.emit();
  }

  subscribe(listener: PlotListener): () => void {
    this.listeners.add(listener);
    if (this.currentSymbol) {
      listener(this.computePoints(this.currentSymbol));
    }
    return () => this.listeners.delete(listener);
  }

  private computePoints(symbol: string): PlotPoint[] {
    const candles = this.stockPrices.getSortedCandles(symbol).map((c) => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    }));

    const open = this.stockPrices.getOpenCandle(symbol);
    if (open) {
      candles.push({ time: open.time, open: open.open, high: open.high, low: open.low, close: open.close });
    }

    return candles;
  }

  private updateSeries(points: PlotPoint[]): void {
    if (!this.series || points.length === 0) return;
    this.series.setData(
      points.map((p) => ({ time: p.time as any, open: p.open, high: p.high, low: p.low, close: p.close }))
    );
    this.chart?.timeScale().scrollToRealTime();
  }

  private emit(): void {
    if (!this.currentSymbol) return;
    const points = this.computePoints(this.currentSymbol);
    this.updateSeries(points);
    for (const listener of this.listeners) {
      listener(points);
    }
  }
}
