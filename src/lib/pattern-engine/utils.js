"use strict";

/*
 * Pattern engine utilities - pure functions, no I/O.
 * Candle shape: { date, open, high, low, close, volume }
 */

const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round = (x, d = 4) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

/**
 * Convert daily_stock_data rows to clean, ascending candles.
 * Placeholder rows (volume 0, e.g. suspended stocks) are dropped, so
 * detectors never see fake flat candles.
 */
function cleanCandles(rows) {
  return (rows || [])
    .map((r) => ({
      date: r.date || r.trade_date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      value: Number(r.value) || 0,
    }))
    .filter(
      (c) =>
        c.date &&
        c.volume > 0 &&
        c.close > 0 &&
        c.high > 0 &&
        c.low > 0 &&
        Number.isFinite(c.close)
    )
    .map((c) => (c.open > 0 ? c : { ...c, open: c.close }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Pivot lows: index i is a pivot if low[i] is <= every low in the w candles
 * to its left and < every low in the w candles to its right.
 */
function pivotLows(candles, w) {
  const out = [];
  for (let i = w; i < candles.length - w; i++) {
    let ok = true;
    for (let j = 1; j <= w && ok; j++) {
      if (candles[i - j].low < candles[i].low) ok = false;
      if (candles[i + j].low <= candles[i].low) ok = false;
    }
    if (ok) out.push(i);
  }
  return out;
}

const noMatch = (pattern, reason) => ({
  matched: false,
  pattern,
  confidence: 0,
  reason,
});

module.exports = { avg, clamp01, round, cleanCandles, pivotLows, noMatch };
