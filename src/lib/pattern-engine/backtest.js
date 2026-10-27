"use strict";

const { avg, round } = require("./utils");

/**
 * Walk through history day by day. At each candle t the detector only sees
 * candles up to and including t (no lookahead). When it fires, the return is
 * close[t + horizon] / close[t] - 1. A cooldown (default = horizon) stops one
 * pattern being counted on consecutive days.
 *
 * Signals too recent to have `horizon` candles after them are returned as
 * `pending` and excluded from statistics.
 */
function scanHistory(candles, detector, o = {}) {
  const { window = 60, horizon = 10, cooldown = horizon, detectorOpts = {}, accept = null } = o;
  const trades = [];
  const pending = [];
  let last = -Infinity;

  for (let t = window - 1; t < candles.length; t++) {
    if (t - last < cooldown) continue;
    const win = candles.slice(t - window + 1, t + 1);
    // optional point-in-time gate, evaluated only on data up to t (e.g. liquidity at that date)
    if (accept && !accept(win)) continue;
    const res = detector(win, detectorOpts);
    if (!res.matched) continue;
    last = t;

    if (t + horizon < candles.length) {
      const entry = candles[t].close;
      const exit = candles[t + horizon].close;
      // diagnostics over the holding period (t+1 .. t+horizon); not used to decide anything
      const hold = candles.slice(t + 1, t + horizon + 1);
      const minLow = Math.min(...hold.map((c) => c.low));
      const maxHigh = Math.max(...hold.map((c) => c.high));
      const lv = res.levels || {};
      trades.push({
        signal_date: candles[t].date,
        exit_date: candles[t + horizon].date,
        entry: round(entry, 2),
        exit: round(exit, 2),
        return_pct: round((exit / entry - 1) * 100, 2),
        confidence: res.confidence,
        variant: res.details && res.details.variant ? res.details.variant : null,
        trigger: lv.trigger ?? null,
        invalidation: lv.invalidation ?? null,
        target: lv.target ?? null,
        max_drawdown_pct: round((minLow / entry - 1) * 100, 2),
        max_runup_pct: round((maxHigh / entry - 1) * 100, 2),
        hit_invalidation: lv.invalidation != null ? minLow <= lv.invalidation : null,
        reached_target: lv.target != null ? maxHigh >= lv.target : null,
      });
    } else {
      pending.push({ signal_date: candles[t].date, confidence: res.confidence, levels: res.levels });
    }
  }

  return { trades, pending };
}

function summarize(trades) {
  const n = trades.length;
  if (!n) {
    return { signals: 0, win_rate_pct: null, avg_return_pct: null, median_return_pct: null,
      avg_win_pct: null, avg_loss_pct: null, profit_factor: null, best_pct: null, worst_pct: null };
  }
  const rets = trades.map((t) => t.return_pct);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  const sorted = [...rets].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const grossWin = wins.reduce((s, x) => s + x, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x, 0));

  return {
    signals: n,
    win_rate_pct: round((wins.length / n) * 100, 1),
    avg_return_pct: round(avg(rets), 2),
    median_return_pct: round(median, 2),
    avg_win_pct: wins.length ? round(avg(wins), 2) : null,
    avg_loss_pct: losses.length ? round(avg(losses), 2) : null,
    profit_factor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
    best_pct: sorted[n - 1],
    worst_pct: sorted[0],
  };
}

module.exports = { scanHistory, summarize };
