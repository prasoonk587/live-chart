/**
 * PlotStore — persists per-plot metadata to localStorage.
 *
 * Watermark: the unix-second timestamp of the last closed candle we have
 * computed data for.  On reopen, historical fetch starts from this point so
 * only the gap [watermark, now) is fetched — not the entire history.
 */

const PREFIX = 'plot:';

export class PlotStore {
  private key: string;

  constructor(plotId: string) {
    this.key = PREFIX + plotId;
  }

  getWatermark(): number | null {
    const raw = localStorage.getItem(this.key + ':watermark');
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  setWatermark(ts: number) {
    localStorage.setItem(this.key + ':watermark', String(ts));
  }

  clear() {
    localStorage.removeItem(this.key + ':watermark');
  }
}
