'use strict';
/*
 * Signal Center monitoring and evaluation.
 *
 *   node scripts/signal-performance.js backfill [NDATES]   point-in-time replay of the current engine (in-sample)
 *   node scripts/signal-performance.js report              outcomes and aggregates -> public/data/signal-performance.json
 *
 * appendFromBuild() is called by build-signal-center-snapshot.js and logs the live (out-of-sample) setups.
 * It only writes when SIGNAL_LOG=1, so local test builds never touch the committed log.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'public', 'data', 'signal-log.json');
const PERF_FILE = path.join(ROOT, 'public', 'data', 'signal-performance.json');

const HORIZONS = [1, 3, 5, 10, 20];
const OUTCOME_WINDOW = 20;
const TRIGGER_WINDOW = 10;
const REPEAT_DAYS = 7;
const MIN_N = 30;
const MIN_DATES = 10;
const LIQ = 1e9;
const FIELDS = 'stock_id,trade_date,previous_price,open,first_trade,high,low,close,change_price,volume,value,frequency,offer,offer_volume,bid,bid_volume,foreign_sell,foreign_buy';

const rnd = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const median = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const dayDiff = (a, b) => Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000;

function loadLog() {
  try {
    const j = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    if (j && Array.isArray(j.entries)) return j;
  } catch (e) { /* new log */ }
  return { version: 1, entries: [] };
}

function saveLog(log) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  log.entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const body = log.entries.map(e => JSON.stringify(e)).join(',\n');
  fs.writeFileSync(LOG_FILE, '{"version":1,"entries":[\n' + body + '\n]}\n');
}

function toEntry(row, date, shown, source) {
  const num = (v) => (v === null || v === undefined || v === '' ? null : rnd(Number(v), 2));
  return {
    date, code: row.stockCode, setup: row.setup, status: row.status,
    price: num(row.price), trigger: num(row.trigger), invalidation: num(row.invalidation),
    target1: num(row.target1), target2: num(row.target2),
    preBreakout: row.preBreakout === true, idleSessions: row.idleSessions || 0,
    planStale: row.planStale === true, stopDistancePct: num(row.stopDistancePct),
    shown, source
  };
}

function appendFromBuild(result, considered) {
  if (process.env.SIGNAL_LOG !== '1') { console.log('[signal-log] SIGNAL_LOG!=1, skipped'); return; }
  if (!result || !result.date) { console.log('[signal-log] no result date, skipped'); return; }
  if (!considered || considered.date !== result.date) { console.log('[signal-log] snapshot reused, nothing new to log'); return; }
  const shownCodes = new Set((result.signals || []).map(s => s.stockCode));
  const log = loadLog();
  log.entries = log.entries.filter(e => !(e.date === result.date && e.source === 'backfill'));
  const seen = new Set(log.entries.map(e => e.date + '|' + e.code));
  let added = 0;
  for (const row of considered.rows) {
    if (seen.has(result.date + '|' + row.stockCode)) continue;
    log.entries.push(toEntry(row, result.date, shownCodes.has(row.stockCode), 'live'));
    added++;
  }
  saveLog(log);
  console.log('[signal-log] +' + added + ' entries for ' + result.date);
}

function connect() {
  try { require('dotenv').config(); } catch (e) { /* env from CI */ }
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase env missing');
  return createClient(url, key);
}

async function backfill(nDates) {
  const sb = connect();
  const { computeSmartwatchlist } = require('../src/lib/smartwatchlist-core.js');
  let MAX_STOP_PCT = 25;
  try { const v = require('../src/services/signalCenterService').MAX_STOP_PCT; if (Number.isFinite(v)) MAX_STOP_PCT = v; } catch (e) { /* fallback */ }

  const { data: stocks, error: e1 } = await sb.from('stocks').select('id,code,name').range(0, 1999);
  if (e1) throw e1;
  const { data: lm, error: e2 } = await sb.from('daily_stock_data').select('trade_date').order('trade_date', { ascending: false }).limit(1);
  if (e2) throw e2;
  const market = String(lm[0].trade_date).slice(0, 10);
  const sd = new Date(market + 'T00:00:00Z'); sd.setUTCDate(sd.getUTCDate() - 520);
  const start = sd.toISOString().slice(0, 10);

  const history = [];
  process.stdout.write('memuat data');
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from('daily_stock_data').select(FIELDS)
      .gte('trade_date', start).lte('trade_date', market)
      .order('trade_date', { ascending: true }).order('stock_id', { ascending: true })
      .range(off, off + 999);
    if (error) throw error;
    history.push(...(data || []));
    if (off % 50000 === 0) process.stdout.write('.');
    if (!data || data.length < 1000) break;
  }
  console.log(' selesai: ' + history.length + ' baris, sampai ' + market);

  const lastIdx = new Map();
  history.forEach((r, i) => lastIdx.set(String(r.trade_date).slice(0, 10), i));
  const dates = [...lastIdx.keys()].sort();

  const log = loadLog();
  const liveDates = new Set(log.entries.filter(e => e.source === 'live').map(e => e.date));
  log.entries = log.entries.filter(e => e.source !== 'backfill');
  const use = dates.slice(-nDates).filter(d => !liveDates.has(d));

  for (let i = 0; i < use.length; i++) {
    const D = use[i];
    const t0 = Date.now();
    const rows = computeSmartwatchlist(stocks, history.slice(0, lastIdx.get(D) + 1), D).stocks;
    let shownN = 0;
    for (const row of rows) {
      const shown = !(row.idleSessions >= 1) && !row.planStale && !(row.stopDistancePct > MAX_STOP_PCT);
      if (shown) shownN++;
      log.entries.push(toEntry(row, D, shown, 'backfill'));
    }
    console.log(D + ': ' + rows.length + ' setup, ' + shownN + ' tampil (' + Math.round((Date.now() - t0) / 1000) + ' dtk) [' + (i + 1) + '/' + use.length + ']');
  }
  saveLog(log);

  try {
    const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'signal-center-snapshot.json'), 'utf8'));
    if (snap && snap.date && use.includes(snap.date)) {
      const mine = log.entries.filter(e => e.date === snap.date && e.source === 'backfill' && e.shown).map(e => e.code).sort().join(',');
      const theirs = (snap.signals || []).map(s => s.stockCode).sort().join(',');
      console.log('paritas dengan snapshot ' + snap.date + ': ' + (mine === theirs ? 'OK' : 'BEDA (backfill: ' + mine + ' | snapshot: ' + theirs + ')'));
    }
  } catch (e) { /* no snapshot to compare */ }
  console.log('log tersimpan: ' + log.entries.length + ' entri');
}

function groupOf(e) {
  if (e.preBreakout) return 'PRA-BREAKOUT';
  if (e.setup === 'BREAKOUT') return 'BREAKOUT';
  if (e.setup === 'PULLBACK') return 'PULLBACK';
  if (e.setup === 'ACCUMULATION') return 'ACCUMULATION';
  return 'LAIN';
}

function tradeOutcome(e, rows, t) {
  const n = rows.length;
  const stop = e.invalidation, t1 = e.target1, t2 = e.target2;
  if (!Number.isFinite(stop) || !Number.isFinite(t1) || !Number.isFinite(e.price)) return { state: 'N/A' };
  let entry = e.price, start = t + 1;
  if (e.status === 'WATCH' && Number.isFinite(e.trigger) && e.trigger > e.price) {
    let hit = false;
    for (let k = t + 1; k <= t + TRIGGER_WINDOW && k < n; k++) {
      const r = rows[k];
      if (r.h >= e.trigger) { hit = true; entry = e.trigger; start = k; break; }
      if (r.l <= stop) return { state: 'GAGAL_SEBELUM_TRIGGER', entered: false };
    }
    if (!hit) return { state: t + TRIGGER_WINDOW < n ? 'TIDAK_TERPICU' : 'MENUNGGU', entered: false };
  }
  const risk = entry - stop;
  if (!(risk > 0)) return { state: 'N/A' };
  if (entry >= t1) return { state: 'T1_LEWAT' };
  const last = Math.min(n - 1, start + OUTCOME_WINDOW - 1);
  let iStop = -1, i1 = -1, i2 = -1;
  for (let k = start; k <= last; k++) {
    const r = rows[k];
    const stopHit = r.l <= stop;
    if (!stopHit && i1 < 0 && r.h >= t1) i1 = k;
    if (!stopHit && i2 < 0 && Number.isFinite(t2) && r.h >= t2) i2 = k;
    if (stopHit) { iStop = k; break; }
  }
  const complete = start + OUTCOME_WINDOW - 1 <= n - 1;
  const mtm = (rows[last].c - entry) / risk;
  const pick = (iT, target) => (iT >= 0 ? (target - entry) / risk : iStop >= 0 ? -1 : complete ? mtm : null);
  const state = i1 >= 0 ? 'T1' : iStop >= 0 ? 'STOP' : complete ? 'KEDALUWARSA' : 'MENUNGGU';
  return { state, entered: true, R1: pick(i1, t1), R2: Number.isFinite(t2) ? pick(i2, t2) : null, entry, riskPct: rnd(risk / entry * 100, 1) };
}

function summarize(list) {
  const out = {
    n: list.length,
    stocks: new Set(list.map(x => x.e.code)).size,
    dates: new Set(list.map(x => x.e.date)).size,
    fwd: {}, trade: {}
  };
  for (const h of [5, 10, 20]) {
    const xs = list.filter(x => x.fwd && x.fwd[h] && x.fwd[h].ex != null);
    out.fwd['h' + h] = xs.length
      ? { n: xs.length, medRet: rnd(median(xs.map(x => x.fwd[h].ret)) * 100), medExcess: rnd(median(xs.map(x => x.fwd[h].ex)) * 100),
          beat: Math.round(xs.filter(x => x.fwd[h].ex > 0).length / xs.length * 100) }
      : { n: 0 };
  }
  const resolved = list.filter(x => x.trade && x.trade.entered && ['T1', 'STOP', 'KEDALUWARSA'].includes(x.trade.state));
  const pct = (k) => (resolved.length ? Math.round(resolved.filter(x => x.trade.state === k).length / resolved.length * 100) : null);
  const r1 = resolved.map(x => x.trade.R1).filter(Number.isFinite);
  const r2 = resolved.map(x => x.trade.R2).filter(Number.isFinite);
  const dec = list.filter(x => x.trade && x.e.status === 'WATCH' &&
    (x.trade.entered || x.trade.state === 'TIDAK_TERPICU' || x.trade.state === 'GAGAL_SEBELUM_TRIGGER'));
  out.trade = {
    n: resolved.length, t1Pct: pct('T1'), stopPct: pct('STOP'), expPct: pct('KEDALUWARSA'),
    avgR1: rnd(mean(r1)), avgR2: rnd(mean(r2)),
    trigPct: dec.length ? Math.round(dec.filter(x => x.trade.entered).length / dec.length * 100) : null,
    pending: list.filter(x => x.trade && x.trade.state === 'MENUNGGU').length,
    t1Late: list.filter(x => x.trade && x.trade.state === 'T1_LEWAT').length
  };
  return out;
}

function verdict(s) {
  const f = s.fwd.h10;
  if (!f || f.n < MIN_N || s.dates < MIN_DATES) return 'BELUM CUKUP DATA';
  if (f.medExcess > 0 && f.beat >= 55) return 'DI ATAS PASAR';
  if (f.medExcess < 0 && f.beat <= 45) return 'DI BAWAH PASAR';
  return 'SEIMBANG';
}

async function report() {
  const sb = connect();
  const log = loadLog();
  const entries = log.entries;
  if (!entries.length) throw new Error('signal-log kosong. Jalankan: node scripts/signal-performance.js backfill 60');

  const sigDates = new Set(entries.map(e => e.date));
  const minDate = [...sigDates].sort()[0];
  const sd = new Date(minDate + 'T00:00:00Z'); sd.setUTCDate(sd.getUTCDate() - 40);
  const start = sd.toISOString().slice(0, 10);

  const { data: stocks, error: e1 } = await sb.from('stocks').select('id,code').range(0, 1999);
  if (e1) throw e1;
  const idByCode = new Map(stocks.map(s => [String(s.code).toUpperCase(), String(s.id)]));

  const by = new Map();
  let marketDate = null;
  process.stdout.write('memuat data');
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from('daily_stock_data').select('stock_id,trade_date,high,low,close,value')
      .gte('trade_date', start)
      .order('trade_date', { ascending: true }).order('stock_id', { ascending: true })
      .range(off, off + 999);
    if (error) throw error;
    for (const r of data || []) {
      const h = Number(r.high), l = Number(r.low), c = Number(r.close);
      const d = String(r.trade_date).slice(0, 10);
      if (!marketDate || d > marketDate) marketDate = d;
      if (!(h > 0 && l > 0 && c > 0)) continue;
      const k = String(r.stock_id);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push({ d, h, l, c, v: Number(r.value) });
    }
    if (off % 50000 === 0) process.stdout.write('.');
    if (!data || data.length < 1000) break;
  }
  console.log(' selesai: ' + by.size + ' saham, sampai ' + marketDate);

  const mk = new Map();
  for (const rows of by.values()) {
    const n = rows.length;
    for (let t = 19; t < n; t++) {
      const d = rows[t].d;
      if (!sigDates.has(d)) continue;
      const vals = [];
      for (let i = t - 19; i <= t; i++) if (Number.isFinite(rows[i].v)) vals.push(rows[i].v);
      if (!(median(vals) >= LIQ)) continue;
      for (const h of HORIZONS) {
        if (t + h >= n) continue;
        const key = d + '|' + h;
        if (!mk.has(key)) mk.set(key, []);
        mk.get(key).push(rows[t + h].c / rows[t].c - 1);
      }
    }
  }
  const mkMed = (d, h) => { const a = mk.get(d + '|' + h); return a && a.length >= 20 ? median(a) : null; };

  const sorted = entries.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const lastSeen = new Map();
  for (const e of sorted) {
    const key = e.source + '|' + e.code + '|' + groupOf(e);
    const prev = lastSeen.get(key);
    e._repeat = prev !== undefined && dayDiff(prev, e.date) <= REPEAT_DAYS;
    lastSeen.set(key, e.date);
  }

  const evals = [];
  for (const e of entries) {
    const sid = idByCode.get(String(e.code).toUpperCase());
    const rows = sid ? by.get(sid) : null;
    const t = rows ? rows.findIndex(r => r.d === e.date) : -1;
    if (t < 0) { evals.push({ e, missing: true }); continue; }
    const fwd = {};
    for (const h of HORIZONS) {
      if (t + h < rows.length) {
        const ret = rows[t + h].c / rows[t].c - 1;
        const m = mkMed(e.date, h);
        fwd[h] = { ret, ex: m == null ? null : ret - m };
      }
    }
    evals.push({ e, fwd, trade: tradeOutcome(e, rows, t), group: groupOf(e) });
  }

  const GROUPS = ['PRA-BREAKOUT', 'BREAKOUT', 'PULLBACK', 'ACCUMULATION'];
  const groups = [];
  for (const source of ['live', 'backfill']) {
    for (const shown of [true, false]) {
      const base = evals.filter(x => !x.missing && x.e.source === source && x.e.shown === shown && !x.e._repeat);
      const sets = [['SEMUA', base]].concat(GROUPS.map(g => [g, base.filter(x => x.group === g)]));
      for (const [g, list] of sets) {
        if (!list.length) continue;
        const s = summarize(list);
        groups.push({ source, shown, group: g, ...s, verdict: verdict(s) });
      }
    }
  }

  // Primary reason a setup was filtered, same order as the Signal Center filters.
  const reasonOf = (e) => (e.idleSessions >= 1 ? 'TANPA TRANSAKSI' : e.planStale ? 'TELAT ENTRY' : e.stopDistancePct > 25 ? 'STOP LEBAR' : 'LAIN');
  for (const source of ['live', 'backfill']) {
    const base = evals.filter(x => !x.missing && x.e.source === source && x.e.shown === false && !x.e._repeat);
    for (const reason of ['TANPA TRANSAKSI', 'TELAT ENTRY', 'STOP LEBAR', 'LAIN']) {
      const list = base.filter(x => reasonOf(x.e) === reason);
      if (!list.length) continue;
      const s = summarize(list);
      groups.push({ source, shown: false, group: 'SEMUA', reason, ...s, verdict: verdict(s) });
    }
  }
  const sources = {};
  for (const src of ['live', 'backfill']) {
    const xs = entries.filter(e => e.source === src);
    if (!xs.length) continue;
    const ds = xs.map(e => e.date).sort();
    sources[src] = { entries: xs.length, shown: xs.filter(e => e.shown).length, from: ds[0], to: ds[ds.length - 1] };
  }

  const recent = evals.filter(x => !x.missing && x.e.shown)
    .sort((a, b) => (a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : a.e.code < b.e.code ? -1 : 1))
    .slice(0, 40)
    .map(x => ({
      date: x.e.date, code: x.e.code, group: x.group, status: x.e.status, source: x.e.source, repeat: !!x.e._repeat,
      price: x.e.price, trigger: x.e.trigger, stop: x.e.invalidation, target1: x.e.target1,
      outcome: x.trade.state, R1: rnd(x.trade.R1),
      ret5: x.fwd[5] ? rnd(x.fwd[5].ret * 100, 1) : null, ret10: x.fwd[10] ? rnd(x.fwd[10].ret * 100, 1) : null
    }));

  const out = {
    generatedAt: new Date().toISOString(),
    marketDate,
    params: { outcomeWindow: OUTCOME_WINDOW, triggerWindow: TRIGGER_WINDOW, repeatDays: REPEAT_DAYS, minN: MIN_N, minDates: MIN_DATES, liquidityMedianValue: LIQ },
    caveats: [
      "Sumber 'backfill' dihitung ulang dengan mesin sinyal saat ini, dan aturannya dipilih setelah melihat data yang sama (in-sample). Hanya sumber 'live' yang merupakan bukti di luar sampel.",
      'Entry diasumsikan di harga penutupan hari sinyal. Untuk WATCH pra-breakout, entry di trigger bila tersentuh dalam ' + TRIGGER_WINDOW + ' sesi. Slippage, biaya transaksi, dan batas auto-reject belum dihitung.',
      'Bila stop dan target tersentuh pada sesi yang sama, dianggap kena stop.',
      'Excess adalah return dikurangi median return semua saham likuid pada tanggal dan horizon yang sama. Vonis memerlukan minimal ' + MIN_N + ' sinyal baru dari minimal ' + MIN_DATES + ' tanggal, dan hanya heuristik.'
    ],
    sources, groups, recent
  };
  fs.mkdirSync(path.dirname(PERF_FILE), { recursive: true });
  fs.writeFileSync(PERF_FILE, JSON.stringify(out, null, 1) + '\n');

  console.log('sumber: ' + JSON.stringify(sources));
  console.table(groups.map(r => ({
    sumber: r.source, tampil: r.shown ? 'ya' : 'disaring', alasan: r.reason || '', grup: r.group, n: r.n, tgl: r.dates,
    n10: r.fwd.h10.n, ex10: r.fwd.h10.medExcess ?? null, beat10: r.fwd.h10.beat ?? null,
    picu: r.trade.trigPct, T1: r.trade.t1Pct, stop: r.trade.stopPct, avgR1: r.trade.avgR1, vonis: r.verdict
  })));
  console.log('ditulis: ' + PERF_FILE);
}

module.exports = { appendFromBuild, loadLog };

if (require.main === module) {
  const mode = process.argv[2];
  const run = mode === 'backfill' ? () => backfill(parseInt(process.argv[3] || '60', 10))
    : mode === 'report' ? report : null;
  if (!run) { console.log('pemakaian: node scripts/signal-performance.js backfill [NDATES] | report'); process.exit(1); }
  run().then(() => process.exit(0)).catch(e => { console.error('ERROR', e && e.message ? e.message : e); process.exit(1); });
}