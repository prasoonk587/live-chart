export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Tick {
  time: number; // unix seconds
  price: number;
  volume: number;
}

// A resolved candle built from ticks within a minute bucket
export type CandleUpdate =
  | { type: 'snapshot'; candles: Candle[] }  // bulk historical load
  | { type: 'update'; candle: Candle }        // current live candle updated in-place
  | { type: 'new'; candle: Candle };          // new candle opened (minute rolled over)
