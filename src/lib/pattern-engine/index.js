"use strict";

const { detectAscendingTriangle } = require("./ascending-triangle");
const { detectWBottom } = require("./w-bottom");
const { detectBullFlag } = require("./bull-flag");
const { detectFlagPennant } = require("./flag-pennant");
const { scanHistory, summarize } = require("./backtest");
const { loadCandles, topLiquidCodes } = require("./loader");
const { cleanCandles } = require("./utils");

const DETECTORS = {
  asc_triangle: detectAscendingTriangle,
  w_bottom: detectWBottom,
  bull_flag: detectBullFlag,
  flag_pennant: detectFlagPennant,
};

function getDetector(type) {
  const d = DETECTORS[type];
  if (!d) throw new Error(`Unknown pattern_type "${type}". Use: ${Object.keys(DETECTORS).join(", ")}`);
  return d;
}

/** POST /api/scan  { pattern_type, codes } -> real matches from daily_stock_data */
async function scanPattern(supabase, patternType, codes) {
  const detect = getDetector(patternType);
  const candlesByCode = await loadCandles(supabase, codes, { days: 120 });
  const matches = [];
  const skipped = [];

  for (const [code, candles] of candlesByCode) {
    if (!candles.length) { skipped.push({ code, reason: "no_data" }); continue; }
    const res = detect(candles);
    if (res.matched) {
      matches.push({ code, last_date: candles[candles.length - 1].date,
        last_close: candles[candles.length - 1].close, ...res });
    }
  }
  matches.sort((a, b) => b.confidence - a.confidence);
  return { pattern_type: patternType, scanned: candlesByCode.size, matches, skipped };
}

/** GET /api/backtest?pattern=asc_triangle&days=365 */
async function backtestPattern(supabase, patternType, { codes, days = 365, horizon = 10, limit = 45 } = {}) {
  const detect = getDetector(patternType);
  const universe = codes && codes.length ? codes : await topLiquidCodes(supabase, limit);
  const candlesByCode = await loadCandles(supabase, universe, { days: days + 60 });

  const perStock = [];
  const allTrades = [];
  for (const [code, candles] of candlesByCode) {
    if (candles.length < 60 + horizon) continue;
    const { trades, pending } = scanHistory(candles, detect, { horizon });
    // keep only signals inside the requested lookback
    const cutoff = candles[Math.max(0, candles.length - days)].date;
    const inRange = trades.filter((t) => t.signal_date >= cutoff);
    allTrades.push(...inRange.map((t) => ({ code, ...t })));
    perStock.push({ code, ...summarize(inRange), pending: pending.length });
  }

  return {
    pattern_type: patternType,
    days, horizon,
    universe_size: universe.length,
    overall: summarize(allTrades),
    per_stock: perStock.filter((s) => s.signals > 0).sort((a, b) => b.signals - a.signals),
    trades: allTrades,
    note: "In-sample historical detection, close-to-close, no fees/slippage. Treat as a description of past behaviour, not an edge.",
  };
}

/** Why each detector accepted/rejected each code - for checking against real data. */
async function explainCodes(supabase, codes) {
  const candlesByCode = await loadCandles(supabase, codes, { days: 120 });
  const out = [];
  for (const [code, candles] of candlesByCode) {
    const row = { code, candles: candles.length, first: candles[0]?.date || null,
      last: candles[candles.length - 1]?.date || null, patterns: {} };
    for (const [type, detect] of Object.entries(DETECTORS)) {
      const r = detect(candles);
      row.patterns[type] = r.matched ? `MATCH ${r.confidence}` : r.reason;
    }
    out.push(row);
  }
  return out;
}

module.exports = {
  explainCodes,
  DETECTORS, getDetector, scanPattern, backtestPattern,
  detectAscendingTriangle, detectWBottom, detectBullFlag, detectFlagPennant,
  scanHistory, summarize, loadCandles, topLiquidCodes, cleanCandles,
};
