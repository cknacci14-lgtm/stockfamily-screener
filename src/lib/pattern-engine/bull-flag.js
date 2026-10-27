"use strict";

const { avg, clamp01, round, noMatch } = require("./utils");

const PATTERN = "bull_flag";

/**
 * Bull Flag - the flag must end on the latest candle.
 *
 *  - Impulse: 3 candles whose last close is > `impulsePct` (8%) above the close
 *    before the impulse, on volume > `impulseVolRatio` (1.5x, my reading of
 *    "volume besar") the average of the 20 candles before the impulse.
 *  - Flag: 3-7 candles right after, total range (high-low)/high < `flagRange` (4%),
 *    average volume <= impulse volume * (1 - `volDrop`) (30% drop).
 *  - Flag low may not retrace more than `maxRetrace` (50%) of the impulse
 *    (impulse low -> impulse high).
 *  Levels: trigger = flag high, invalidation = flag low, target = flag high +
 *  pole height.
 */
function detectBullFlag(candles, opts = {}) {
  const o = {
    minCandles: 30,
    impulsePct: 0.08,
    impulseVolRatio: 1.5,
    minFlag: 3,
    maxFlag: 7,
    flagRange: 0.04,
    volDrop: 0.3,
    maxRetrace: 0.5,
    ...opts,
  };

  if (!candles || candles.length < o.minCandles) return noMatch(PATTERN, "not_enough_candles");

  const c = candles.slice(-40);
  const n = c.length;
  let best = null;
  // optional diagnostics: o.trace = {} collects how many (window, flag length) combos pass each stage
  const hit = (stage) => { if (o.trace) o.trace[stage] = (o.trace[stage] || 0) + 1; };

  for (let k = o.minFlag; k <= o.maxFlag; k++) {
    const impStart = n - k - 3;
    if (impStart - 1 < 0) continue;

    const imp = c.slice(impStart, impStart + 3);
    const flag = c.slice(n - k);
    const prevClose = c[impStart - 1].close;

    hit("tried");
    const gain = imp[2].close / prevClose - 1;
    if (!(gain > o.impulsePct)) continue;
    hit("impulse_gain");

    const impVol = avg(imp.map((x) => x.volume));
    const baseVol = avg(c.slice(Math.max(0, impStart - 20), impStart).map((x) => x.volume));
    if (!(impVol > baseVol * o.impulseVolRatio)) continue;
    hit("impulse_volume");

    const flagHigh = Math.max(...flag.map((x) => x.high));
    const flagLow = Math.min(...flag.map((x) => x.low));
    const range = (flagHigh - flagLow) / flagHigh;
    if (!(range < o.flagRange)) continue;
    hit("flag_range");

    const flagVol = avg(flag.map((x) => x.volume));
    if (!(flagVol <= impVol * (1 - o.volDrop))) continue;
    hit("flag_volume");

    const impHigh = Math.max(...imp.map((x) => x.high));
    const impLow = Math.min(...imp.map((x) => x.low));
    const retrace = (impHigh - flagLow) / (impHigh - impLow);
    if (retrace > o.maxRetrace) continue;
    hit("retrace_ok");

    const confidence =
      (clamp01((gain - o.impulsePct) / 0.12) +
        clamp01(1 - range / o.flagRange) +
        clamp01((1 - flagVol / impVol) / 0.7)) /
      3;

    if (!best || confidence > best.confidence) {
      best = {
        matched: true,
        pattern: PATTERN,
        confidence: round(confidence),
        status: c[n - 1].close > flagHigh ? "breakout" : "forming",
        levels: {
          trigger: round(flagHigh, 2),
          invalidation: round(flagLow, 2),
          target: round(flagHigh + (impHigh - impLow), 2),
        },
        details: {
          impulse_gain_pct: round(gain * 100, 2),
          impulse_vol_vs_base: round(impVol / baseVol, 2),
          flag_candles: k,
          flag_range_pct: round(range * 100, 2),
          flag_vol_vs_impulse: round(flagVol / impVol, 2),
          retrace_pct: round(retrace * 100, 1),
        },
      };
    }
  }

  return best || noMatch(PATTERN, "no_flag");
}

module.exports = { detectBullFlag, PATTERN };
