"use strict";

const { avg, clamp01, round, pivotLows, noMatch } = require("./utils");

const PATTERN = "w_bottom";

/**
 * W-Bottom (60 candles).
 *
 *  - Two pivot-low bottoms (window 3) 10-30 candles apart.
 *  - Bottom lows within `lowTol` (3%) of each other.
 *  - Bottom 2 volume > bottom 1 volume * `volRatio` (1.1). Volume at a bottom is
 *    the average of the pivot candle and its two neighbours, so one odd candle
 *    doesn't decide it.
 *  - Neckline = highest high between the two bottoms. It must be at least
 *    `minDepth` (3%) above the higher bottom (extra guard against noise; not in
 *    the original spec, set to 0 to disable).
 *  - Confirmed only if a candle after bottom 2 closes > neckline * 1.01 with
 *    volume above the average of the 20 candles before it. The break must be
 *    within the last `freshBars` candles + 1 (default: the last 3 candles).
 */
function detectWBottom(candles, opts = {}) {
  const o = {
    window: 60,
    minGap: 10,
    maxGap: 30,
    lowTol: 0.03,
    volRatio: 1.1,
    minDepth: 0.03,
    breakPct: 0.01,
    freshBars: 2,
    ...opts,
  };

  if (!candles || candles.length < o.window) return noMatch(PATTERN, "not_enough_candles");

  const c = candles.slice(-o.window);
  const n = c.length;
  const piv = pivotLows(c, 3);
  if (piv.length < 2) return noMatch(PATTERN, "not_enough_bottoms");

  const volAt = (k) => avg(c.slice(Math.max(0, k - 1), k + 2).map((x) => x.volume));

  let best = null;

  for (let a = 0; a < piv.length; a++) {
    for (let b = a + 1; b < piv.length; b++) {
      const i = piv[a];
      const j = piv[b];
      const gap = j - i;
      if (gap < o.minGap || gap > o.maxGap) continue;

      const low1 = c[i].low;
      const low2 = c[j].low;
      const diff = Math.abs(low2 - low1) / Math.min(low1, low2);
      if (diff >= o.lowTol) continue;

      const v1 = volAt(i);
      const v2 = volAt(j);
      if (!(v2 > v1 * o.volRatio)) continue;

      let neckline = 0;
      for (let k = i; k <= j; k++) neckline = Math.max(neckline, c[k].high);
      const higherBottom = Math.max(low1, low2);
      if ((neckline - higherBottom) / higherBottom < o.minDepth) continue;

      // breakout after bottom 2: must be the FIRST close above the break level
      // since bottom 2, and that first close must be within the fresh window
      const level = neckline * (1 + o.breakPct);
      let firstCross = -1;
      for (let t = j + 1; t < n; t++) {
        if (c[t].close > level) { firstCross = t; break; }
      }
      if (firstCross < 0 || firstCross < n - 1 - o.freshBars) continue;

      let breakIdx = -1;
      for (let t = firstCross; t < n; t++) {
        const prevVol = avg(c.slice(Math.max(0, t - 20), t).map((x) => x.volume));
        if (c[t].close > level && c[t].volume > prevVol) {
          breakIdx = t;
          break;
        }
      }
      if (breakIdx < 0) continue;

      const prevVol = avg(c.slice(Math.max(0, breakIdx - 20), breakIdx).map((x) => x.volume));
      const symmetry = clamp01(1 - diff / o.lowTol);
      const volScore = clamp01((v2 / v1 - 1) / 0.5);
      const breakVol = clamp01(c[breakIdx].volume / prevVol / 2);
      const confidence = (symmetry + volScore + breakVol) / 3;

      if (!best || confidence > best.confidence) {
        const bottomAvg = (low1 + low2) / 2;
        best = {
          matched: true,
          pattern: PATTERN,
          confidence: round(confidence),
          status: breakIdx === n - 1 ? "breakout_today" : "breakout_recent",
          levels: {
            trigger: round(neckline, 2),
            invalidation: round(Math.min(low1, low2), 2),
            target: round(neckline + (neckline - bottomAvg), 2),
          },
          details: {
            bottom1: { date: c[i].date, low: round(low1, 2) },
            bottom2: { date: c[j].date, low: round(low2, 2) },
            bottoms_gap_candles: gap,
            bottoms_diff_pct: round(diff * 100, 2),
            bottom2_vs_bottom1_volume: round(v2 / v1, 2),
            break_date: c[breakIdx].date,
            break_close: round(c[breakIdx].close, 2),
          },
        };
      }
    }
  }

  return best || noMatch(PATTERN, "no_confirmed_w");
}

module.exports = { detectWBottom, PATTERN };
