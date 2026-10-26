/**
 * Flag + Pennant (continuation) — research detector.
 * Same impulse + dry consolidation idea as bull_flag, but consolidation may be:
 *  - flag: tight range (flagRange), or
 *  - pennant: channel width shrinks (last third width < shrinkRatio * first third)
 * Does not replace bull_flag until backtest passes product gates.
 */
const { avg, clamp01, round, noMatch } = require("./utils");

const PATTERN = "flag_pennant";

function detectFlagPennant(candles, opts = {}) {
  const o = {
    minCandles: 40,
    minImpulse: 3,
    maxImpulse: 12,
    minFlag: 3,
    maxFlag: 10,
    minImpulseGain: 0.075,
    flagRange: 0.065,
    maxRetrace: 0.50,
    volDrop: 0.18,
    shrinkRatio: 0.70,
    breakoutOnly: false,
    ...opts,
  };
  const PATTERN_LOCAL = PATTERN;
  if (!candles || candles.length < o.minCandles) return noMatch(PATTERN_LOCAL, "not_enough_candles");

  const c = candles;
  const n = c.length;
  const hit = (k) => {
    if (o.trace) o.trace[k] = (o.trace[k] || 0) + 1;
  };

  let best = null;

  for (let k = o.minFlag; k <= o.maxFlag; k++) {
    hit("tried");
    const flagStart = n - k;
    if (flagStart < o.minImpulse + 1) continue;
    const flag = c.slice(flagStart);
    const before = c.slice(0, flagStart);

    // impulse window ending at flag start
    let imp = null;
    for (let il = o.minImpulse; il <= o.maxImpulse; il++) {
      if (before.length < il) break;
      const seg = before.slice(before.length - il);
      const impLow = Math.min(...seg.map((x) => x.low));
      const impHigh = Math.max(...seg.map((x) => x.high));
      const gain = (impHigh - impLow) / impLow;
      if (gain < o.minImpulseGain) continue;
      const impVol = avg(seg.map((x) => x.volume));
      const pre = before.slice(Math.max(0, before.length - il - 10), before.length - il);
      const preVol = pre.length ? avg(pre.map((x) => x.volume)) : impVol;
      if (!(impVol > preVol * 1.05)) continue;
      imp = { seg, impLow, impHigh, gain, impVol };
    }
    if (!imp) continue;
    hit("impulse_gain");
    hit("impulse_volume");

    const flagHigh = Math.max(...flag.map((x) => x.high));
    const flagLow = Math.min(...flag.map((x) => x.low));
    const range = (flagHigh - flagLow) / flagHigh;

    // pennant: width first third vs last third
    const t = Math.max(1, Math.floor(k / 3));
    const wFirst = Math.max(...flag.slice(0, t).map((x) => x.high)) - Math.min(...flag.slice(0, t).map((x) => x.low));
    const wLast = Math.max(...flag.slice(k - t).map((x) => x.high)) - Math.min(...flag.slice(k - t).map((x) => x.low));
    const shrinking = wFirst > 0 && wLast <= o.shrinkRatio * wFirst;

    const isFlag = range < o.flagRange;
    const isPennant = shrinking && range < o.flagRange * 1.35;
    if (!isFlag && !isPennant) continue;
    hit("flag_range");

    const flagVol = avg(flag.map((x) => x.volume));
    if (!(flagVol <= imp.impVol * (1 - o.volDrop))) continue;
    hit("flag_volume");

    const retrace = (imp.impHigh - flagLow) / (imp.impHigh - imp.impLow);
    if (!(retrace <= o.maxRetrace)) continue;
    hit("retrace_ok");

    const conf =
      (clamp01(imp.gain / 0.15) +
        clamp01(1 - range / (o.flagRange * 1.35)) +
        clamp01((1 - flagVol / imp.impVol) / 0.7) +
        (isPennant ? 0.15 : 0)) /
      3.15;

    const candidate = {
      matched: true,
      pattern: PATTERN_LOCAL,
      confidence: round(Math.min(1, conf), 2),
      status: c[n - 1].close > flagHigh ? "breakout" : "forming",
      levels: {
        trigger: round(flagHigh, 2),
        invalidation: round(flagLow, 2),
        target: round(flagHigh + (imp.impHigh - imp.impLow), 2),
      },
      details: {
        shape: isPennant && !isFlag ? "pennant" : isPennant ? "flag_or_pennant" : "flag",
        flag_candles: k,
        flag_range_pct: round(range * 100, 2),
        width_shrink: round(wFirst > 0 ? wLast / wFirst : 1, 2),
        flag_vol_vs_impulse: round(flagVol / imp.impVol, 2),
        impulse_gain_pct: round(imp.gain * 100, 2),
      },
    };
    if (o.breakoutOnly && candidate.status !== "breakout") continue;
    if (!best || candidate.confidence > best.confidence) best = candidate;
  }

  return best || noMatch(PATTERN_LOCAL, "no_flag_pennant");
}

module.exports = { detectFlagPennant, PATTERN };
