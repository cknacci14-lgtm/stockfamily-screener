"use strict";

/*
 * Generates the two JSON snapshots read by the Pattern Scanner page:
 *   public/data/pattern-scan.json      today's matches + bubble map
 *   public/data/pattern-backtest.json  win rate etc. per pattern (1 year, 10 days)
 *
 * All numbers come from Supabase daily_stock_data. Run it after the daily upload
 * (same place the qbs-daily-screener workflow runs), not per page view: scanning
 * ~965 stocks is too heavy for a Cloudflare Function request.
 *
 *   node scripts/pattern-scan.js [--out public/data]
 */

const fs = require("fs");
const path = require("path");
const pe = require("../src/lib/pattern-engine");
const { loadStockMap, loadRowsSince, loadStockHistory } = require("../src/lib/pattern-engine/loader");
const { cleanCandles } = require("../src/lib/pattern-engine/utils");
const { avg } = require("../src/lib/pattern-engine/utils");

const PATTERNS = Object.keys(pe.DETECTORS);
const dayMs = 86400000;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

function atrPct(candles, n = 14) {
  const c = candles.slice(-(n + 1));
  if (c.length < 2) return null;
  const trs = [];
  for (let i = 1; i < c.length; i++) {
    trs.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  }
  return (avg(trs) / c[c.length - 1].close) * 100;
}

/** Unconditional h-day return over the same stocks and period: what "no pattern" gives you. */
function baselineStats(histories, cutoff, horizon) {
  const rets = [];
  for (const candles of histories.values()) {
    for (let t = 0; t + horizon < candles.length; t++) {
      if (candles[t].date < cutoff) continue;
      rets.push((candles[t + horizon].close / candles[t].close - 1) * 100);
    }
  }
  const n = rets.length;
  return {
    samples: n,
    win_rate_pct: n ? Number(((rets.filter((r) => r > 0).length / n) * 100).toFixed(1)) : null,
    avg_return_pct: n ? Number(avg(rets).toFixed(2)) : null,
  };
}

async function build(supabase, opts = {}) {
  const o = {
    today: new Date(),
    universe: 45,          // backtest universe = N most liquid stocks (by avg 20d value)
    bubbles: 60,           // stocks shown on the bubble map
    minAvgValue: 1e9,      // scan filter: avg 20d traded value >= Rp 1 miliar
    horizon: 10,
    backtestDays: 365,
    detectorOpts: {},      // e.g. { flag_pennant: { rangeVsPole: 0.5 } }
    ...opts,
  };
  const todayMs = new Date(o.today).getTime();

  const stockMap = await loadStockMap(supabase);
  const rows = await loadRowsSince(supabase, isoDate(todayMs - 170 * dayMs));

  const byStock = new Map();
  for (const r of rows) {
    if (!byStock.has(r.stock_id)) byStock.set(r.stock_id, []);
    byStock.get(r.stock_id).push(r);
  }

  const items = [];
  let dataDate = "";
  for (const [id, list] of byStock) {
    const meta = stockMap.get(id);
    if (!meta) continue;
    const candles = cleanCandles(list);
    if (!candles.length) continue;
    const last = candles[candles.length - 1];
    if (last.date > dataDate) dataDate = last.date;
    items.push({ id, ...meta, candles, avgValue: avg(candles.slice(-20).map((c) => c.value)) });
  }

  // only stocks that traded on the latest market date (drops suspended stocks)
  const live = items.filter((s) => s.candles[s.candles.length - 1].date === dataDate);
  const liquid = live.filter((s) => s.avgValue >= o.minAvgValue).sort((a, b) => b.avgValue - a.avgValue);

  const scan = {
    generated_at: new Date().toISOString(),
    data_date: dataDate,
    stocks_total: stockMap.size,
    stocks_traded_on_data_date: live.length,
    stocks_scanned: liquid.length,
    min_avg_value_idr: o.minAvgValue,
    patterns: Object.fromEntries(PATTERNS.map((p) => [p, []])),
    bubbles: [],
  };

  for (const s of liquid) {
    const last = s.candles[s.candles.length - 1];
    const prev = s.candles[s.candles.length - 2];
    const base = {
      code: s.code, name: s.name, last_close: last.close,
      change_pct: prev ? Number(((last.close / prev.close - 1) * 100).toFixed(2)) : null,
      avg_value: Math.round(s.avgValue),
    };
    let best = null;
    for (const p of PATTERNS) {
      const r = pe.DETECTORS[p](s.candles, o.detectorOpts[p] || {});
      if (!r.matched) continue;
      scan.patterns[p].push({ ...base, ...r });
      if (!best || r.confidence > best.confidence) best = { pattern: p, confidence: r.confidence };
    }
    s.base = base;
    s.best = best;
  }
  for (const p of PATTERNS) scan.patterns[p].sort((a, b) => b.confidence - a.confidence);

  scan.bubbles = liquid.slice(0, o.bubbles).map((s) => ({
    ...s.base,
    atr_pct: Number((atrPct(s.candles) || 0).toFixed(2)),
    pattern: s.best ? s.best.pattern : null,
    confidence: s.best ? s.best.confidence : null,
  }));

  // ---- backtest on the most liquid N stocks
  const universe = liquid.slice(0, o.universe);
  const sinceBt = isoDate(todayMs - (o.backtestDays + 110) * dayMs);
  const cutoff = isoDate(todayMs - o.backtestDays * dayMs);

  const bt = {
    generated_at: scan.generated_at,
    data_date: dataDate,
    days: o.backtestDays,
    horizon: o.horizon,
    universe: universe.map((s) => s.code),
    universe_rule: `${o.universe} saham dengan rata-rata nilai transaksi 20 hari tertinggi per ${dataDate} (peringkat hari ini dipakai untuk melihat ke belakang)`,
    entry_rule: `Entry = close candle sinyal, exit = close ${o.horizon} hari bursa kemudian, tanpa fee dan slippage, jeda ${o.horizon} hari per saham agar satu pola tidak dihitung berulang`,
    caveat: "Universe dipilih berdasarkan likuiditas hari ini, sehingga saham yang sekarang ramai ikut dihitung di masa lalu; hasil cenderung terlalu optimistis. Aturan pattern juga dipilih sebelum melihat hasil, tetapi tetap diuji pada periode yang sama dengan yang kita lihat.",
    patterns: {},
  };

  const histories = new Map();
  for (const s of universe) histories.set(s.code, await loadStockHistory(supabase, s.id, sinceBt));

  bt.baseline = baselineStats(histories, cutoff, o.horizon);

  for (const p of PATTERNS) {
    const trades = [];
    const perStock = [];
    for (const s of universe) {
      const candles = histories.get(s.code);
      if (candles.length < 60 + o.horizon) continue;
      const { trades: t } = pe.scanHistory(candles, pe.DETECTORS[p], { horizon: o.horizon, detectorOpts: o.detectorOpts[p] || {} });
      const inRange = t.filter((x) => x.signal_date >= cutoff).map((x) => ({ code: s.code, ...x }));
      trades.push(...inRange);
      if (inRange.length) perStock.push({ code: s.code, ...pe.summarize(inRange) });
    }
    trades.sort((a, b) => (a.signal_date < b.signal_date ? 1 : -1));
    const best = perStock.filter((x) => x.signals >= 3).sort((a, b) => b.avg_return_pct - a.avg_return_pct).slice(0, 3).map((x) => x.code);
    bt.patterns[p] = { summary: pe.summarize(trades), best, per_stock: perStock, trades };
  }

  return { scan, backtest: bt };
}

async function main() {
  require("dotenv").config();
  const { createClient } = require("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

  const argOut = process.argv.indexOf("--out");
  const outDir = path.resolve(argOut > -1 ? process.argv[argOut + 1] : "public/data");
  fs.mkdirSync(outDir, { recursive: true });

  const detectorOpts = {};
  const fr = process.argv.indexOf("--range-vs-pole");
  if (fr > -1) detectorOpts.flag_pennant = { rangeVsPole: Number(process.argv[fr + 1]) };

  const { scan, backtest } = await build(createClient(url, key), { detectorOpts });
  backtest.detector_overrides = detectorOpts;
  fs.writeFileSync(path.join(outDir, "pattern-scan.json"), JSON.stringify(scan));
  fs.writeFileSync(path.join(outDir, "pattern-backtest.json"), JSON.stringify(backtest));

  console.log(`data_date=${scan.data_date} scanned=${scan.stocks_scanned}/${scan.stocks_total}`);
  const b = backtest.baseline;
  console.log(`baseline (any day, same stocks): samples=${b.samples} win=${b.win_rate_pct}% avg=${b.avg_return_pct}%`);
  for (const p of PATTERNS) {
    const s = backtest.patterns[p].summary;
    console.log(`${p}: today=${scan.patterns[p].length} | 1y signals=${s.signals} win=${s.win_rate_pct}% avg=${s.avg_return_pct}% pf=${s.profit_factor}`);
  }
}

module.exports = { build };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
