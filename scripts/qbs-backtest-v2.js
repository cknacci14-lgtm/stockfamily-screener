'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ===== CONFIG =====
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const a = args.find(x => x.startsWith('--' + name + '='));
  return a ? a.split('=').slice(1).join('=') : def;
};
const START_DATE = getArg('start', '2026-04-01');
const END_DATE = getArg('end', '2026-09-25');
const HORIZONS = getArg('horizons', '5,10,20').split(',').map(Number);
const POLICY = getArg('policy', 'tier1'); // 'all' | 'tier1'
const MIN_LOOKBACK = 25;
const LOOKBACK_DAYS = 60;
const FORWARD_DAYS = 40;

// ===== POLICY =====
const POLICIES = {
  all: { excludeRegimes: [], excludeCells: [] },
  tier1: { excludeRegimes: ['Weak', 'Neutral-'], excludeCells: ['Supportive/C'] },
  tier2: { excludeRegimes: ['Weak', 'Neutral-', 'Neutral+'], excludeCells: ['Supportive/C'] },
};
const P = POLICIES[POLICY] || POLICIES.tier1;

function applyPolicy(regime, label, action) {
  if (action === 'SKIP') return { keep: false, reason: 'SKIP' };
  if (P.excludeRegimes.includes(regime)) return { keep: false, reason: 'regime:' + regime };
  const cell = regime + '/' + label;
  if (P.excludeCells.includes(cell)) return { keep: false, reason: 'cell:' + cell };
  return { keep: true, reason: null };
}

// ===== HELPERS =====
const pct = x => (x * 100).toFixed(2) + '%';
const avg = a => a.length ? a.reduce((x,y)=>x+y,0) / a.length : 0;
const med = a => { if (!a.length) return 0; const s = [...a].sort((x,y)=>x-y); const m = Math.floor(s.length/2); return s.length % 2 ? s[m] : (s[m-1]+s[m])/2; };
const addDays = (str, days) => { const d = new Date(str); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]; };

async function fetchAll(table, select, filters) {
  const PAGE = 1000; let all = [], from = 0;
  while (true) {
    let q = sb.from(table).select(select);
    if (table === 'daily_stock_data') {
      q = q.order('trade_date', { ascending: true }).order('stock_id', { ascending: true });
    }
    q = q.range(from, from + PAGE - 1);
    for (const [k, v] of Object.entries(filters || {})) {
      if (v.op === 'gte') q = q.gte(k, v.val); else if (v.op === 'lte') q = q.lte(k, v.val); else q = q.eq(k, v.val);
    }
    const { data, error } = await q;
    if (error) throw error;
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
    process.stdout.write('\r  Fetching ' + table + ': ' + all.length + ' rows...');
  }
  process.stdout.write('\r  Fetched  ' + table + ': ' + all.length + ' rows       \n');
  return all;
}

async function loadData() {
  console.log('\n=== QBS BACKTEST v2 ===');
  console.log('Policy: ' + POLICY);
  console.log('Range:  ' + START_DATE + ' -> ' + END_DATE);
  console.log('Horizons: T+' + HORIZONS.join(', T+') + '\n');
  const fetchStart = addDays(START_DATE, -LOOKBACK_DAYS);
  const fetchEnd = addDays(END_DATE, FORWARD_DAYS);
  const stocks = await fetchAll('stocks', 'id, code', {});
  const stockMap = Object.fromEntries(stocks.map(s => [s.id, s.code]));
  const rows = await fetchAll('daily_stock_data',
    'stock_id, trade_date, previous_price, open, high, low, close, volume, value, bid_volume, offer_volume, foreign_buy, foreign_sell',
    { trade_date: { op: 'gte', val: fetchStart } });
  const filtered = rows.filter(r => r.trade_date <= fetchEnd);
  console.log('  Final dataset: ' + filtered.length + ' rows\n');
  return { stockMap, rows: filtered };
}

function computeDerived(rows, stockMap) {
  const byStock = {};
  for (const r of rows) { if (!byStock[r.stock_id]) byStock[r.stock_id] = []; byStock[r.stock_id].push(r); }
  const derived = [];
  for (const sid in byStock) {
    const srows = byStock[sid].sort((a,b) => a.trade_date.localeCompare(b.trade_date));
    for (let i = MIN_LOOKBACK - 1; i < srows.length; i++) {
      const r = srows[i];
      const hist = srows.slice(0, i + 1);
      const cp = r.high === r.low ? 0 : (r.close - r.low) / (r.high - r.low);
      const last3 = hist.slice(-3);
      const cp3d = Math.max(...last3.map(x => x.high === x.low ? 0 : (x.close - x.low) / (x.high - x.low)));
      const last20 = hist.slice(-20);
      const sh = Math.max(...last20.map(x => x.high));
      const sl = Math.min(...last20.map(x => x.low));
      const rng = sh - sl;
      const fib = rng === 0 ? 0 : (sh - r.close) / rng;
      const high10 = Math.max(...hist.slice(-10).map(x => x.high));
      const vol5 = hist.slice(-5).reduce((a,x)=>a + x.volume, 0) / 5;
      const rvol = vol5 === 0 ? 0 : r.volume / vol5;
      const fnet1 = (r.foreign_buy||0) - (r.foreign_sell||0);
      const fnet3 = hist.slice(-3).reduce((a,x) => a + (x.foreign_buy||0) - (x.foreign_sell||0), 0);
      derived.push({
        stock_id: sid, ticker: stockMap[sid] || ('ID'+sid), date: r.trade_date,
        open: r.open, high: r.high, low: r.low, close: r.close, prev_close: r.previous_price,
        volume: r.volume, value: r.value, bid_volume: r.bid_volume, offer_volume: r.offer_volume,
        close_pos: cp, close_pos_3d_max: cp3d,
        swing_high_20d: sh, swing_low_20d: sl, fib_ratio: fib,
        high_10d: high10, rvol_5d: rvol,
        fnet_1d: fnet1, fnet_3d: fnet3,
      });
    }
  }
  console.log('  ' + derived.length + ' stock-day rows computed\n');
  return derived;
}

// ===== RULES (IDENTIK v1) =====
const corr = s => s.high_10d === 0 ? 0 : (s.close / s.high_10d) - 1;
function passesFilter(s) {
  const c = corr(s);
  return s.fnet_3d > 0
    && s.close_pos_3d_max >= 0.65
    && s.fib_ratio >= 0.50 && s.fib_ratio <= 0.81
    && c >= -0.14 && c <= -0.03
    && (s.bid_volume === 0 && s.offer_volume === 0 ? true : s.bid_volume > s.offer_volume)
    && s.value >= 1e9
    && s.volume > 100000
    && s.rvol_5d < 1.3
    && s.close > 100;
}
function classifyLabel(s) {
  if (s.close_pos >= 0.55 && s.fnet_1d >= 0) return 'A';
  if (s.close_pos >= 0.40 || s.fnet_1d > -0.5 * s.fnet_3d) return 'B';
  return 'C';
}
const isDeepFib = s => corr(s) <= -0.10;
function classifyRegime(list) {
  const u = list.filter(s => s.value >= 1e9 && s.close > 50);
  if (!u.length) return { regime: 'Weak', pctUp: 0, meanFnet: 0 };
  const pctUp = u.filter(s => s.close > s.prev_close).length / u.length;
  const mf = u.reduce((a,s) => a + s.fnet_1d, 0) / u.length;
  if (pctUp >= 0.45 && mf >= 0) return { regime: 'Supportive', pctUp, meanFnet: mf };
  if (pctUp >= 0.40 || mf > -1e6) return { regime: mf >= 0 ? 'Neutral+' : 'Neutral-', pctUp, meanFnet: mf };
  return { regime: 'Weak', pctUp, meanFnet: mf };
}
function decideAction(s, regime) {
  const label = classifyLabel(s);
  const cp = s.close_pos, cp3 = s.close_pos_3d_max, f1 = s.fnet_1d;
  if (regime === 'Supportive') {
    if (label === 'A' || label === 'B') return 'FULL';
    if (label === 'C' && cp3 >= 0.70) return 'HALF';
    return 'SKIP';
  }
  if (regime === 'Neutral+') { if (label === 'A' && cp >= 0.60) return 'FULL'; return 'SKIP'; }
  if (regime === 'Neutral-') { if (label === 'A' && cp >= 0.70 && f1 > 0) return 'FULL'; return 'SKIP'; }
  if (regime === 'Weak') {
    if (isDeepFib(s)) return 'HALF';
    if (label === 'A' && cp >= 0.70 && f1 > 0) return 'HALF';
    return 'SKIP';
  }
  return 'SKIP';
}

function replay(derived) {
  console.log('=== REPLAYING ===\n');
  const byStock = {};
  for (const s of derived) { if (!byStock[s.stock_id]) byStock[s.stock_id] = []; byStock[s.stock_id].push(s); }
  for (const sid in byStock) byStock[sid].sort((a,b) => a.date.localeCompare(b.date));
  const idx = {};
  for (const sid in byStock) { idx[sid] = {}; byStock[sid].forEach((r, i) => idx[sid][r.date] = i); }
  const byDate = {};
  for (const s of derived) { if (!byDate[s.date]) byDate[s.date] = []; byDate[s.date].push(s); }
  const testDates = Object.keys(byDate).filter(d => d >= START_DATE && d <= END_DATE).sort();
  console.log('Test days: ' + testDates.length + '\n');

  const signals = [];
  const excluded = {};
  let filterCount = 0;
  const regimeCounts = {};

  for (const date of testDates) {
    const today = byDate[date];
    const ri = classifyRegime(today);
    regimeCounts[ri.regime] = (regimeCounts[ri.regime] || 0) + 1;
    for (const s of today) {
      if (!passesFilter(s)) continue;
      filterCount++;
      const action = decideAction(s, ri.regime);
      if (action === 'SKIP') continue;
      const pol = applyPolicy(ri.regime, classifyLabel(s), action);
      if (!pol.keep) { excluded[pol.reason] = (excluded[pol.reason] || 0) + 1; continue; }
      const i = idx[s.stock_id][date];
      const entryRow = byStock[s.stock_id][i + 1];
      if (!entryRow || !entryRow.open || entryRow.open <= 0) continue;
      const entry = entryRow.open;
      const returns = {};
      for (const H of HORIZONS) {
        const exRow = byStock[s.stock_id][i + 1 + H];
        returns[H] = exRow ? (exRow.close - entry) / entry : null;
      }
      signals.push({ date, ticker: s.ticker, label: classifyLabel(s), action, regime: ri.regime, entry_price: entry, returns });
    }
  }

  console.log('Regime days: ' + JSON.stringify(regimeCounts));
  console.log('Filter pass: ' + filterCount);
  console.log('\n--- POLICY EXCLUSIONS ---');
  const totalEx = Object.values(excluded).reduce((a,b)=>a+b,0);
  for (const [k, v] of Object.entries(excluded).sort((a,b)=>b[1]-a[1])) {
    console.log('  ' + k.padEnd(28) + v);
  }
  console.log('  ' + 'TOTAL EXCLUDED'.padEnd(28) + totalEx);
  console.log('\nTradable signals (post-policy): ' + signals.length + '\n');
  return signals;
}

function group(signals, keyFn) {
  const g = {};
  for (const s of signals) { const k = keyFn(s); if (!g[k]) g[k] = []; g[k].push(s); }
  const rows = [];
  for (const k in g) {
    const sigs = g[k]; const row = { group: k, N: sigs.length };
    for (const H of HORIZONS) {
      const rets = sigs.map(s => s.returns[H]).filter(x => x !== null);
      if (!rets.length) { row['w'+H]=0; row['a'+H]=0; row['e'+H]=0; continue; }
      const wins = rets.filter(r => r > 0);
      const losses = rets.filter(r => r <= 0);
      const wr = wins.length / rets.length;
      const aw = wins.length ? avg(wins) : 0;
      const al = losses.length ? avg(losses) : 0;
      row['w'+H] = wr; row['a'+H] = avg(rets); row['e'+H] = wr * aw + (1 - wr) * al;
    }
    rows.push(row);
  }
  return rows.sort((a,b) => b.N - a.N);
}

function printTable(rows, title) {
  console.log('\n=== ' + title + ' ===');
  let hdr = 'Group'.padEnd(22) + 'N'.padEnd(6);
  for (const H of HORIZONS) hdr += ('T+' + H + ' Win%').padEnd(11) + 'Avg'.padEnd(10) + 'Exp'.padEnd(10);
  console.log(hdr);
  console.log('-'.repeat(hdr.length + 10));
  for (const r of rows) {
    let line = r.group.padEnd(22) + String(r.N).padEnd(6);
    for (const H of HORIZONS) line += pct(r['w'+H]).padEnd(11) + pct(r['a'+H]).padEnd(10) + pct(r['e'+H]).padEnd(10);
    console.log(line);
  }
}

(async () => {
  const { stockMap, rows } = await loadData();
  const derived = computeDerived(rows, stockMap);
  const signals = replay(derived);
  if (!signals.length) { console.log('\nNo signals post-policy. Longgarkan policy atau extend range.\n'); return; }
  printTable(group(signals, () => 'OVERALL'), 'OVERALL (post-policy)');
  printTable(group(signals, s => s.action), 'BY ACTION');
  printTable(group(signals, s => s.regime), 'BY REGIME');
  printTable(group(signals, s => s.regime + '/' + s.label), 'BY REGIME x LABEL');
  printTable(group(signals, s => s.regime + '/' + s.label + '/' + s.action), 'BY CELL');
  const outDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rptPath = path.join(outDir, 'qbs-backtest-v2-' + POLICY + '-' + ts + '.json');
  fs.writeFileSync(rptPath, JSON.stringify({
    config: { START_DATE, END_DATE, HORIZONS, POLICY },
    signals,
    tables: {
      overall: group(signals, () => 'OVERALL'),
      by_action: group(signals, s => s.action),
      by_regime: group(signals, s => s.regime),
      by_cell: group(signals, s => s.regime + '/' + s.label + '/' + s.action),
    },
  }, null, 2));
  console.log('\nReport saved: ' + rptPath + '\n');
})().catch(e => { console.error('\nERROR:', e.message); console.error(e.stack); process.exit(1); });