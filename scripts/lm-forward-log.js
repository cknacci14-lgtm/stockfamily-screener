/*
 * Pencatat forward test LATE MOMENTUM (src/engine/lateMomentumEngine.js).
 * Dimuat OPSIONAL oleh verdict-forward-log.js, sama seperti gem-forward-log.js dan zone-forward-log.js.
 *
 * Verdict yang dicatat di verdict_forward_log:
 *   LM_SIGNAL : saham lolos rumus engine (passesLonggar) pada hari T
 *   LM_BASE   : semua saham lain dengan volume >= 200.000 lembar pada hari T (pembanding hari yang sama)
 * Rumus TIDAK disalin: fungsi diambil langsung dari engine, jadi forward test selalu menguji rumus yang sama dengan situs.
 * Fitur hanya memakai data sampai hari T. ret_1d/3d/5d/10d (close T -> close T+h) diisi oleh fillReturns.
 *
 * Realistis: sinyal terbit malam hari, jadi harga masuk yang bisa didapat adalah open T+1. summary() menghitung juga
 * open T+1 -> close T+h langsung dari daily_stock_data (kolom open), dan menampilkannya berdampingan.
 *
 * Aturan sebelum melihat hasil (supaya tidak digeser belakangan):
 *   - Pengamatan bersih = log_date >= LM_CLEAN_FROM (default 2026-10-21, setelah semua data yang dipakai backtest).
 *   - Pembanding utama = LM_BASE di hari yang sama.
 *   - Keputusan baru layak bila >= 100 kejadian LM_SIGNAL dari >= 30 hari bursa. Sebelum itu: "sampel kecil".
 *   - Ukuran yang menentukan = open T+1 -> close T+3 vs base, bukan close T -> close T+h.
 */
const CLEAN_FROM = process.env.LM_CLEAN_FROM || '2026-10-21';
const VERDICTS = ['LM_SIGNAL', 'LM_BASE'];
const MIN_EVENTS = 100, MIN_DAYS = 30;

let engine = null, engineErr = null;
function getEngine() {
  if (engine || engineErr) return engine;
  try { engine = require('../src/engine/lateMomentumEngine'); }
  catch (e) { engineErr = e; console.warn('LATE MOMENTUM forward log dilewati: gagal memuat engine (' + (e && e.message) + ')'); }
  return engine;
}

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const pct = x => (x == null ? '-' : (x * 100).toFixed(2) + '%');

let colsCache = null;
async function pickCols(sb) {
  if (colsCache) return colsCache;
  const base = 'stock_id,trade_date,close,high,low,volume,value,foreign_buy,foreign_sell';
  const full = base + ',open,bid_volume,offer_volume';
  const { error } = await sb.from('daily_stock_data').select(full).limit(1);
  colsCache = error ? base : full;
  if (error) console.warn('  LM: kolom open/bid_volume/offer_volume tidak lengkap di daily_stock_data; syarat bid > offer tidak akan terpenuhi.');
  return colsCache;
}

async function logRecent(sb, dates, codeById, fetchAll) {
  const E = getEngine();
  if (!E) return 0;
  const targets = Array.from(new Set(dates)).sort();
  if (!targets.length) return 0;
  const cols = await pickCols(sb);
  const from = new Date(new Date(targets[0]).getTime() - 100 * 86400000).toISOString().slice(0, 10);
  const raw = await fetchAll(() => sb.from('daily_stock_data').select(cols)
    .gte('trade_date', from).lte('trade_date', targets[targets.length - 1])
    .order('trade_date').order('stock_id'));
  const bySt = new Map();
  for (const r of raw) { const k = String(r.stock_id); if (!bySt.has(k)) bySt.set(k, []); bySt.get(k).push(r); }

  let total = 0;
  for (const T of targets) {
    const out = [];
    for (const [id, rows] of bySt) {
      const code = codeById.get(id) || codeById.get(Number(id));
      if (!code) continue;
      let idx = -1;
      for (let i = rows.length - 1; i >= 0; i--) {
        const d = String(rows[i].trade_date).slice(0, 10);
        if (d === T) { idx = i; break; }
        if (d < T) break;
      }
      if (idx < 8) continue;
      const slice = rows.slice(Math.max(0, idx - 59), idx + 1).map(r => Object.assign({ ticker: code }, r));
      const f = E.computeRowFeatures(slice);
      if (!f || !(f.volume >= 200000)) continue;
      let sum = 0, cnt = 0;
      for (let k = Math.max(0, idx - 19); k <= idx; k++) { sum += Number(rows[k].value) || 0; cnt++; }
      out.push({
        log_date: T, stock_code: code, verdict: E.passesLonggar(f) ? 'LM_SIGNAL' : 'LM_BASE',
        ref_close: Number(rows[idx].close), foreign_ratio_20d: null, avg_value_20d: cnt ? Math.round(sum / cnt) : null,
      });
    }
    for (let i = 0; i < out.length; i += 500) {
      const { error } = await sb.from('verdict_forward_log').upsert(out.slice(i, i + 500), { onConflict: 'log_date,stock_code,verdict', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    const sig = out.filter(r => r.verdict === 'LM_SIGNAL').map(r => r.stock_code);
    console.log('Pencatat LATE MOMENTUM ' + T + ': ' + out.length + ' saham dinilai, LM_SIGNAL ' + sig.length + (sig.length ? ' (' + sig.join(', ') + ')' : ''));
    total += out.length;
  }
  return total;
}

async function logDay(sb, target, codeById, fetchAll) { return logRecent(sb, [target], codeById, fetchAll); }

async function summary(sb, fetchAll) {
  const all = await fetchAll(() => sb.from('verdict_forward_log')
    .select('log_date,stock_code,verdict,avg_value_20d,ret_1d,ret_3d,ret_5d,ret_10d').in('verdict', VERDICTS).order('id'));
  const clean = all.filter(r => r.log_date >= CLEAN_FROM);
  const sigAll = clean.filter(r => r.verdict === 'LM_SIGNAL');
  const nDays = new Set(sigAll.map(r => r.log_date)).size;
  console.log('Forward test LATE MOMENTUM: ' + sigAll.length + ' kejadian LM_SIGNAL dalam ' + nDays + ' hari (log_date >= ' + CLEAN_FROM + '). Pembanding: LM_BASE hari yang sama.');
  console.log('  ' + (all.length - clean.length) + ' baris sebelum batas itu tidak dihitung (tumpang tindih dengan data backtest).');

  // ---- A. close T -> close T+h (dari kolom ret_*) ----
  const rowsA = [];
  for (const h of [1, 3, 5, 10]) {
    const col = 'ret_' + h + 'd';
    const baseDay = new Map();
    for (const r of clean) {
      if (r.verdict !== 'LM_BASE' || r[col] == null) continue;
      const o = baseDay.get(r.log_date) || { s: 0, n: 0, v: [] }; o.s += Number(r[col]); o.n++; o.v.push(Number(r[col])); baseDay.set(r.log_date, o);
    }
    const rs = sigAll.filter(r => r[col] != null && baseDay.has(r.log_date) && baseDay.get(r.log_date).n >= 20);
    if (!rs.length) continue;
    const rets = rs.map(r => Number(r[col]));
    const exs = rs.map(r => Number(r[col]) - baseDay.get(r.log_date).s / baseDay.get(r.log_date).n);
    const baseRets = []; baseDay.forEach(o => baseRets.push(...o.v));
    const sorted = exs.slice().sort((a, b) => b - a), tot = exs.reduce((a, b) => a + b, 0);
    const notes = []; if (rs.length < 30) notes.push('sampel kecil'); if (new Set(rs.map(r => r.log_date)).size < 10) notes.push('sedikit hari');
    rowsA.push({
      hari: h, n: rs.length, 'naik %': (rets.filter(x => x > 0).length / rs.length * 100).toFixed(1),
      'base naik %': baseRets.length ? (baseRets.filter(x => x > 0).length / baseRets.length * 100).toFixed(1) : '-',
      rata2: pct(mean(rets)), 'vs base (pp)': (mean(exs) * 100).toFixed(2), median: pct(median(rets)),
      '3 teratas %': tot > 0 ? (sorted.slice(0, 3).reduce((a, b) => a + b, 0) / tot * 100).toFixed(0) + '%' : '-', catatan: notes.join(', '),
    });
  }
  if (!rowsA.length) { console.log('  Belum ada hasil bersih: muncul setelah beberapa hari bursa berlalu sejak ' + CLEAN_FROM + '.'); return; }
  console.log('  A. Beli di close T (tidak realistis, hanya untuk dibandingkan dengan backtest):');
  console.table(rowsA);

  // ---- B. realistis: open T+1 -> close T+h ----
  try {
    const stocks = await fetchAll(() => sb.from('stocks').select('id,code'));
    const idByCode = new Map(stocks.map(s => [s.code, s.id]));
    const raw = await fetchAll(() => sb.from('daily_stock_data').select('stock_id,trade_date,open,close').gte('trade_date', CLEAN_FROM).order('trade_date').order('stock_id'));
    const by = new Map();
    for (const r of raw) { const k = String(r.stock_id); if (!by.has(k)) by.set(k, []); by.get(k).push({ d: String(r.trade_date).slice(0, 10), o: Number(r.open), c: Number(r.close) }); }
    const realized = (row, h) => {
      const a = by.get(String(idByCode.get(row.stock_code)));
      if (!a) return null;
      const i = a.findIndex(x => x.d === row.log_date);
      if (i < 0 || i + h >= a.length || !(a[i + 1].o > 0) || !(a[i + h].c > 0)) return null;
      return a[i + h].c / a[i + 1].o - 1;
    };
    const rowsB = [];
    for (const h of [1, 3, 5]) {
      const baseDay = new Map();
      for (const r of clean) {
        if (r.verdict !== 'LM_BASE') continue;
        const v = realized(r, h); if (v == null || Math.abs(v) > 1.5) continue;
        const o = baseDay.get(r.log_date) || { s: 0, n: 0 }; o.s += v; o.n++; baseDay.set(r.log_date, o);
      }
      const rs = [];
      for (const r of sigAll) { const v = realized(r, h); if (v != null && baseDay.has(r.log_date) && baseDay.get(r.log_date).n >= 20) rs.push({ v, ex: v - baseDay.get(r.log_date).s / baseDay.get(r.log_date).n }); }
      if (!rs.length) continue;
      rowsB.push({ hari: h, n: rs.length, 'naik %': (rs.filter(x => x.v > 0).length / rs.length * 100).toFixed(1), rata2: pct(mean(rs.map(x => x.v))), 'vs base (pp)': (mean(rs.map(x => x.ex)) * 100).toFixed(2), median: pct(median(rs.map(x => x.v))), catatan: rs.length < 30 ? 'sampel kecil' : '' });
    }
    if (rowsB.length) { console.log('  B. Realistis: beli di open T+1 (ukuran yang menentukan):'); console.table(rowsB); }
    else console.log('  B. Realistis: belum ada hasil (butuh kolom open dan beberapa hari bursa).');
  } catch (e) { console.warn('  B. dilewati: ' + (e && e.message)); }

  console.log('  Keputusan baru layak bila >= ' + MIN_EVENTS + ' kejadian dari >= ' + MIN_DAYS + ' hari bursa (sekarang ' + sigAll.length + ' dari ' + nDays + '). Patokan: B, 3 hari, "vs base" positif dan stabil.');
}

module.exports = { logDay, logRecent, summary, VERDICTS };
