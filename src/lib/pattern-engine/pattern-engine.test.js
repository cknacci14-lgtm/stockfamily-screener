"use strict";
// Logic tests only: synthetic candles built to contain (or not contain) each pattern.
// The app itself never uses synthetic data.
const assert = require("node:assert");
const {
  detectAscendingTriangle, detectWBottom, detectBullFlag, detectFlagPennant, scanHistory, summarize, cleanCandles,
} = require("./index");

let day = 0;
const dateOf = (i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const candle = (i, o, h, l, c, v) => ({ date: dateOf(i), open: o, high: h, low: l, close: c, volume: v });
const flat = (n, start = 0, price = 100, vol = 1000) =>
  Array.from({ length: n }, (_, k) => {
    const wob = Math.sin((start + k) * 1.7) * 0.3;
    return candle(start + k, price, price + 0.4 + wob * 0.1, price - 0.4 - wob * 0.1, price + wob * 0.1, vol);
  });
const reindex = (arr) => arr.map((c, i) => ({ ...c, date: dateOf(i) }));

// ---- Ascending triangle
function ascTriangle() {
  const base = flat(40);
  const frac = [1, 0.6, 0.2, 0, 0.4, 0.8];
  const tri = [];
  for (let i = 0; i < 20; i++) {
    const cycle = Math.floor(i / 6), p = i % 6;
    const floor = 100 + cycle * 3;
    const lvl = floor + (110 - floor) * frac[p];
    const prev = tri.length ? tri[tri.length - 1].close : 100;
    tri.push(candle(40 + i, prev, lvl + 0.2, lvl - 0.2, lvl, i >= 15 ? 1500 : 1000));
  }
  return reindex([...base, ...tri]);
}

// ---- W bottom
function wBottom() {
  const keys = [[0, 120], [25, 100], [40, 112], [50, 101], [56, 110], [58, 112], [59, 114]];
  const out = [];
  for (let i = 0; i < 60; i++) {
    let k = 0; while (keys[k + 1][0] < i) k++;
    const [i0, p0] = keys[k], [i1, p1] = keys[k + 1];
    const px = p0 + ((p1 - p0) * (i - i0)) / (i1 - i0);
    let vol = 1000;
    if (i >= 48 && i <= 52) vol = 1300;
    if (i === 59) vol = 2000;
    out.push(candle(i, px, px + 0.2, px - 0.2, px, vol));
  }
  return out;
}

// ---- Bull flag (base 32 + impulse 3 + flag 5 = 40) ; `lead` adds extra flat history
function bullFlag(lead = 0) {
  const base = flat(32 + lead);
  const n0 = base.length;
  const imp = [104, 108, 112].map((cl, i) =>
    candle(n0 + i, i === 0 ? 100 : [104, 108][i - 1], cl + 0.3, cl - 0.3 - (i === 0 ? 3 : 0), cl, 3000));
  const flagCloses = [111.5, 111.2, 111.0, 111.3, 111.1];
  const flag = flagCloses.map((cl, i) => candle(n0 + 3 + i, cl, cl + 0.3, cl - 0.3, cl, 800));
  return [...base, ...imp, ...flag];
}

// 1. asc triangle fires, noise doesn't
let r = detectAscendingTriangle(ascTriangle());
assert.ok(r.matched, "asc triangle should match: " + JSON.stringify(r));
assert.ok(r.confidence > 0.5 && r.status === "forming");
assert.strictEqual(r.levels.trigger, 110.2);
assert.ok(!detectAscendingTriangle(reindex(flat(60))).matched, "flat data must not match triangle");
// volume rule
const noVol = ascTriangle().map((c) => ({ ...c, volume: 1000 }));
assert.strictEqual(detectAscendingTriangle(noVol).reason, "volume_not_expanding");
// rising-lows rule
const tooFew = detectAscendingTriangle(reindex(flat(60)));
assert.ok(!tooFew.matched);

// 2. W bottom fires
r = detectWBottom(wBottom());
assert.ok(r.matched, "W bottom should match: " + JSON.stringify(r));
assert.strictEqual(r.status, "breakout_today");
assert.ok(r.levels.target > r.levels.trigger);
// without the breakout candle volume -> no confirmed W
const w2 = wBottom(); w2[59] = { ...w2[59], volume: 500 };
assert.ok(!detectWBottom(w2).matched, "no volume on break => no match");
// bottom 2 volume not higher
const w3 = wBottom().map((c, i) => (i >= 48 && i <= 52 ? { ...c, volume: 1000 } : c));
assert.ok(!detectWBottom(w3).matched, "bottom2 volume not > bottom1*1.1");
assert.ok(!detectWBottom(reindex(flat(60))).matched);

// 3. bull flag fires
r = detectBullFlag(bullFlag());
assert.ok(r.matched, "bull flag should match: " + JSON.stringify(r));
assert.strictEqual(r.details.flag_candles, 5);
assert.ok(r.details.impulse_gain_pct > 8);
// trace: every stage passes for a valid flag
const trace = {}; detectBullFlag(bullFlag(), { trace });
for (const st of ["tried","impulse_gain","impulse_volume","flag_range","flag_volume","retrace_ok"]) assert.ok(trace[st] >= 1, "trace "+st);
// deep retrace kills it
const deep = bullFlag(); deep[deep.length - 1] = { ...deep[deep.length - 1], low: 100, close: 111.1 };
assert.ok(!detectBullFlag(deep).matched, "retrace>50% must fail (or range>4%)");
// flag volume not dry
const wet = bullFlag().map((c, i, a) => (i >= a.length - 5 ? { ...c, volume: 2800 } : c));
assert.ok(!detectBullFlag(wet).matched, "flag volume not dry");
assert.ok(!detectBullFlag(reindex(flat(60))).matched);

// 3b. flag & pennant
r = detectFlagPennant(bullFlag());
assert.ok(r.matched, "flag should match: " + JSON.stringify(r));
assert.strictEqual(r.details.variant, "flag");
assert.ok(r.details.range_vs_pole <= 0.4);
// pennant: converging highs/lows, 8 candles
function pennant() {
  const base = flat(32), n0 = base.length;
  const pole = [104, 108, 112].map((cl, i) => candle(n0 + i, [100, 104, 108][i], cl + 0.3, [100, 104, 108][i] - 0.3 - (i === 0 ? 3 : 0), cl, 3000));
  const cons = [];
  for (let i = 0; i < 8; i++) {
    const hi = 112.0 - i * 0.11, lo = 109.6 + i * 0.17, mid = (hi + lo) / 2;
    cons.push(candle(n0 + 3 + i, mid, hi, lo, mid, 800));
  }
  return [...base, ...pole, ...cons];
}
r = detectFlagPennant(pennant());
assert.ok(r.matched, "pennant should match: " + JSON.stringify(r));
assert.strictEqual(r.details.variant, "pennant");
assert.strictEqual(r.details.consolidation_candles, 8);
// consolidation that keeps climbing is rejected
const climb = pennant().map((c, i, a) => (i >= a.length - 8 ? { ...c, high: c.high + (i - (a.length - 8)) * 0.15, low: c.low + (i - (a.length - 8)) * 0.15, close: c.close + (i - (a.length - 8)) * 0.15, open: c.open + (i - (a.length - 8)) * 0.15 } : c));
assert.ok(!detectFlagPennant(climb).matched, "rising consolidation must not match");
// too wide relative to the pole is rejected
const wide = bullFlag().map((c, i, a) => (i === a.length - 2 ? { ...c, high: c.high + 6.5 } : c));
assert.ok(!detectFlagPennant(wide).matched, "range > 0.4 x pole must not match");
// dry volume + trace
const tr = {}; detectFlagPennant(bullFlag(), { trace: tr });
for (const st of ["tried","impulse_gain","impulse_volume","tight","volume_dry","retrace_ok","shape_ok"]) assert.ok(tr[st] >= 1, "trace " + st);
assert.ok(!detectFlagPennant(reindex(flat(60))).matched);

// 4. suspended placeholder rows are dropped
const cleaned = cleanCandles([
  { trade_date: "2025-01-02", open: 0, high: 0, low: 0, close: 50, volume: 0 },
  { trade_date: "2025-01-03", open: 50, high: 52, low: 49, close: 51, volume: 100 },
]);
assert.strictEqual(cleaned.length, 1);

// 5. backtest: flag followed by a rally; return must be close[t+10]/close[t]-1, no lookahead
const hist = [...bullFlag(48)];
for (let i = 0; i < 12; i++) {
  const px = 111.1 + i * 1.2;
  hist.push(candle(hist.length, px, px + 0.3, px - 0.3, px, 1500));
}
const series = reindex(hist);
const { trades } = scanHistory(series, detectFlagPennant, { window: 60, horizon: 10 });
assert.ok(trades.length >= 1, "backtest should find the flag");
const tIdx = series.findIndex((c) => c.date === trades[0].signal_date);
assert.strictEqual(trades[0].exit, Number(series[tIdx + 10].close.toFixed(2)));
assert.ok(trades[0].return_pct > 0);
// per-signal diagnostics (holding period t+1..t+10, not used for the decision)
assert.strictEqual(typeof trades[0].max_drawdown_pct, "number");
assert.ok(trades[0].max_runup_pct >= trades[0].return_pct, "run-up covers the exit");
assert.strictEqual(trades[0].hit_invalidation, false);
assert.strictEqual(typeof trades[0].reached_target, "boolean");
assert.ok(["flag", "pennant"].includes(trades[0].variant));
// accept() gate: rejecting everything yields no signals
assert.strictEqual(scanHistory(series, detectFlagPennant, { window: 60, horizon: 10, accept: () => false }).trades.length, 0);
// no lookahead: result for t must not change if future candles are removed
const cut = series.slice(0, tIdx + 1);
assert.ok(detectFlagPennant(cut.slice(-60)).matched, "signal must reproduce using only data up to t");

// 6. summarize
const s = summarize([{ return_pct: 5 }, { return_pct: -2 }, { return_pct: 3 }, { return_pct: -1 }]);
assert.strictEqual(s.win_rate_pct, 50);
assert.strictEqual(s.profit_factor, 2.67);
assert.strictEqual(s.median_return_pct, 1);
assert.strictEqual(summarize([]).signals, 0);

console.log("all pattern-engine tests passed");
