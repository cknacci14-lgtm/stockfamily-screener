"use strict";

const { avg, clamp01, round, noMatch } = require("./utils");

const PATTERN = "flag_pennant";

/**
 * Flag & Pennant - continuation after a sharp move. The consolidation must end on
 * the latest candle.
 *
 *  - Pole: 3 candles whose last close is > `impulsePct` (8%) above the close before
 *    them, on volume > `impulseVolRatio` (1.5x) the average of the 20 candles before.
 *  - Consolidation: `minCons`-`maxCons` (3-10) candles right after the pole.
 *  - Tightness is measured against the pole, not a fixed %: consolidation range
 *    (high - low) <= `rangeVsPole` (0.4) x pole height. A fixed 4% limit rejected
 *    almost everything on IDX daily candles (29 of 6,433 candidates in the last
 *    year's scan of 100 liquid stocks).
 *  - Volume dries up: average <= pole volume * (1 - `volDrop`) (30% lower).
 *  - Low may not retrace more than `maxRetrace` (50%) of the pole.
 *  - Shape (needs >= 5 candles to tell apart):
 *      pennant: highs falling AND lows rising (converging) and the second half's
 *               range <= `contraction` (0.75) x the first half's.
 *      flag:    otherwise, as long as it drifts down or sideways (second-half
 *               average close <= first-half average close * 1.005).
 *    A consolidation that keeps climbing is not a rest and is rejected.
 *
 *  Levels: trigger = consolidation high, invalidation = consolidation low,
 *  target = trigger + pole height.
 *
 *  All thresholds are fixed up front; do not tune them against the backtest win rate.
 */
function detectFlagPennant(candles, opts = {}) {
  const o = {
    minCandles: 30,
    impulsePct: 0.08,
    impulseVolRatio: 1.5,
    minCons: 3,
    maxCons: 10,
    rangeVsPole: 0.4,
    volDrop: 0.3,
    maxRetrace: 0.5,
    contraction: 0.75,
    ...opts,
  };

  if (!candles || candles.length < o.minCandles) return noMatch(PATTERN, "not_enough_candles");

  const c = candles.slice(-40);
  const n = c.length;
  let best = null;
  const hit = (stage) => { if (o.trace) o.trace[stage] = (o.trace[stage] || 0) + 1; };

  for (let k = o.minCons; k <= o.maxCons; k++) {
    const impStart = n - k - 3;
    if (impStart - 1 < 0) continue;

    const pole = c.slice(impStart, impStart + 3);
    const cons = c.slice(n - k);
    const prevClose = c[impStart - 1].close;

    hit("tried");
    const gain = pole[2].close / prevClose - 1;
    if (!(gain > o.impulsePct)) continue;
    hit("impulse_gain");

    const poleVol = avg(pole.map((x) => x.volume));
    const baseVol = avg(c.slice(Math.max(0, impStart - 20), impStart).map((x) => x.volume));
    if (!(poleVol > baseVol * o.impulseVolRatio)) continue;
    hit("impulse_volume");

    const poleHigh = Math.max(...pole.map((x) => x.high));
    const poleLow = Math.min(...pole.map((x) => x.low));
    const poleHeight = poleHigh - poleLow;
    const consHigh = Math.max(...cons.map((x) => x.high));
    const consLow = Math.min(...cons.map((x) => x.low));
    const range = consHigh - consLow;
    if (!(range <= o.rangeVsPole * poleHeight)) continue;
    hit("tight");

    const consVol = avg(cons.map((x) => x.volume));
    if (!(consVol <= poleVol * (1 - o.volDrop))) continue;
    hit("volume_dry");

    const retrace = (poleHigh - consLow) / poleHeight;
    if (retrace > o.maxRetrace) continue;
    hit("retrace_ok");

    // shape
    const h = Math.floor(k / 2);
    const first = cons.slice(0, h);
    const second = cons.slice(k - h);
    const meanHigh = (a) => avg(a.map((x) => x.high));
    const meanLow = (a) => avg(a.map((x) => x.low));
    const meanClose = (a) => avg(a.map((x) => x.close));
    const rng = (a) => Math.max(...a.map((x) => x.high)) - Math.min(...a.map((x) => x.low));

    let variant = null;
    if (h >= 2 && meanHigh(second) < meanHigh(first) && meanLow(second) > meanLow(first) && rng(second) <= o.contraction * rng(first)) {
      variant = "pennant";
    } else if (meanClose(second) <= meanClose(first) * 1.005) {
      variant = "flag";
    }
    if (!variant) continue;
    hit("shape_ok");

    const confidence =
      (clamp01((gain - o.impulsePct) / 0.12) +
        clamp01(1 - range / (o.rangeVsPole * poleHeight)) +
        clamp01((1 - consVol / poleVol) / 0.7)) /
      3;

    if (!best || confidence > best.confidence) {
      best = {
        matched: true,
        pattern: PATTERN,
        confidence: round(confidence),
        status: c[n - 1].close > consHigh ? "breakout" : "forming",
        levels: {
          trigger: round(consHigh, 2),
          invalidation: round(consLow, 2),
          target: round(consHigh + poleHeight, 2),
        },
        details: {
          variant,
          pole_gain_pct: round(gain * 100, 2),
          pole_vol_vs_base: round(poleVol / baseVol, 2),
          consolidation_candles: k,
          range_vs_pole: round(range / poleHeight, 2),
          cons_vol_vs_pole: round(consVol / poleVol, 2),
          retrace_pct: round(retrace * 100, 1),
        },
      };
    }
  }

  return best || noMatch(PATTERN, "no_flag_or_pennant");
}

module.exports = { detectFlagPennant, PATTERN };
