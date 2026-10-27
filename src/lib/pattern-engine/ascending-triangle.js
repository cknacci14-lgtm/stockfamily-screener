"use strict";

const { avg, clamp01, round, pivotLows, noMatch } = require("./utils");

const PATTERN = "asc_triangle";

/**
 * Ascending Triangle (60 candles).
 *
 * Interpretation of the spec:
 *  - Flat resistance: the 3 highest highs (at least 2 candles apart) inside the
 *    last 20 candles must be within `resTol` (2%) of each other.
 *  - Higher lows: the last 3 pivot lows (window 2, searched in the last 30
 *    candles) must each rise at least `minRise` (1.5%) over the previous one.
 *  - Volume: avg volume of last 5 candles > avg of last 20 * `volRatio` (1.2).
 *  - confidence = (resistance_tightness + higher_low_strength) / 2
 */
function detectAscendingTriangle(candles, opts = {}) {
  const o = {
    window: 60,
    resWindow: 20,
    resTol: 0.02,
    minRise: 0.015,
    volRatio: 1.2,
    ...opts,
  };

  if (!candles || candles.length < o.window) {
    return noMatch(PATTERN, "not_enough_candles");
  }

  const c = candles.slice(-o.window);
  const recent = c.slice(-o.resWindow);

  // 1. flat resistance
  const order = recent.map((_, i) => i).sort((a, b) => recent[b].high - recent[a].high);
  const picked = [];
  for (const i of order) {
    if (picked.every((p) => Math.abs(p - i) >= 2)) picked.push(i);
    if (picked.length === 3) break;
  }
  if (picked.length < 3) return noMatch(PATTERN, "no_resistance_touches");

  const touches = picked.map((i) => recent[i].high);
  const resistance = Math.max(...touches);
  const spread = (resistance - Math.min(...touches)) / resistance;
  if (spread >= o.resTol) return noMatch(PATTERN, "resistance_not_flat");
  const tightness = clamp01(1 - spread / o.resTol);

  // 2. higher lows
  const seg = c.slice(-30);
  const piv = pivotLows(seg, 2).slice(-3);
  if (piv.length < 3) return noMatch(PATTERN, "not_enough_pivot_lows");
  const lows = piv.map((i) => seg[i].low);
  const rise1 = lows[1] / lows[0] - 1;
  const rise2 = lows[2] / lows[1] - 1;
  if (rise1 < o.minRise || rise2 < o.minRise) return noMatch(PATTERN, "lows_not_rising");
  const strength = clamp01(avg([rise1, rise2]) / (2 * o.minRise));

  // 3. volume
  const vol5 = avg(c.slice(-5).map((x) => x.volume));
  const vol20 = avg(c.slice(-20).map((x) => x.volume));
  if (!(vol5 > vol20 * o.volRatio)) return noMatch(PATTERN, "volume_not_expanding");

  const last = c[c.length - 1];
  const height = resistance - lows[0];

  return {
    matched: true,
    pattern: PATTERN,
    confidence: round((tightness + strength) / 2),
    status: last.close > resistance ? "breakout" : "forming",
    levels: {
      trigger: round(resistance, 2),
      invalidation: round(lows[2], 2),
      target: round(resistance + height, 2),
    },
    details: {
      resistance_spread_pct: round(spread * 100, 2),
      resistance_tightness: round(tightness),
      higher_low_strength: round(strength),
      pivot_lows: lows.map((x) => round(x, 2)),
      vol5_vs_vol20: round(vol5 / vol20, 2),
    },
  };
}

module.exports = { detectAscendingTriangle, PATTERN };
