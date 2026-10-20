/*
 * Pencatat forward test GEM Score (Quiet Accumulation).
 * Dimuat OPSIONAL oleh verdict-forward-log.js (require dibungkus try/catch), sama seperti zone-forward-log.js.
 *
 * Verdict yang dicatat di verdict_forward_log:
 *   GEM_STRONG : skor GEM >= 75 pada hari T (saham likuid)
 *   GEM_BASE   : saham likuid lain yang skornya < 75 pada hari yang sama (pembanding)
 * "Likuid" = rata-rata nilai transaksi 20 hari >= Rp 25 M (env GEM_MIN_VALUE), sama dengan backtest dan BROKER_BASE.
 *
 * Rumus skor = salinan functions/_lib/gemEngine.js. Kalau rumus di situs berubah, salin ulang fungsinya ke sini
 * (kalau tidak, forward test menguji rumus lain). Fitur hanya memakai data sampai hari T.
 * Hasil (ret_1d, ret_3d, ret_5d, ret_10d) diisi belakangan oleh fillReturns di verdict-forward-log.js.
 *
 * Aturan sebelum melihat hasil (supaya tidak digeser belakangan):
 *   - Pengamatan bersih = log_date >= GEM_CLEAN_FROM (default 2026-10-19, setelah data yang dipakai backtest).
 *   - Pembanding utama = GEM_BASE di hari yang sama, bukan rata-rata universe.
 *   - Keputusan baru layak diambil bila ada >= 150 kejadian GEM_STRONG dari >= 40 hari bursa. Sebelum itu: "sampel kecil".
 */
const MINVAL = Number(process.env.GEM_MIN_VALUE || 25e9);
const STRONG_MIN = Number(process.env.GEM_STRONG_MIN || 75);
const CLEAN_FROM = process.env.GEM_CLEAN_FROM || '2026-10-19';
const VERDICTS = ['GEM_STRONG', 'GEM_BASE'];

// ===== salinan gemEngine.js =====
function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calculateGemScore(history, index) {
  const empty = {
    gem_score: null, gem_signal: null, vol_ratio: null,
    foreign_net20: null, foreign_net5: null, price_pos: null,
    vol_std20: null, ret_20: null, ret_5: null, ma_dist: null,
  };

  if (!Array.isArray(history) || index < 20) return empty;

  const window20 = history.slice(index - 19, index + 1);
  const window5 = history.slice(index - 4, index + 1);
  const windowRet = history.slice(index - 20, index + 1);

  if (window20.length !== 20 || window5.length !== 5 || windowRet.length !== 21) return empty;

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const requiredFields = ["volume", "close", "high", "low", "foreignBuy", "foreignSell", "frequency"];
  for (const row of windowRet) {
    for (const field of requiredFields) {
      if (num(row?.[field]) === null) return empty;
    }
  }

  const volumes20 = window20.map(d => num(d.volume));
  const volumes5 = window5.map(d => num(d.volume));
  const closes20 = window20.map(d => num(d.close));
  const closesRet = windowRet.map(d => num(d.close));
  const highs20 = window20.map(d => num(d.high));
  const lows20 = window20.map(d => num(d.low));
  const foreignBuys20 = window20.map(d => num(d.foreignBuy));
  const foreignSells20 = window20.map(d => num(d.foreignSell));
  const freqs20 = window20.map(d => num(d.frequency));

  const volMa20 = average(volumes20);
  const volMa5 = average(volumes5);
  const volRatio = volMa20 > 0 ? volMa5 / volMa20 : null;

  const foreignNet20 = foreignBuys20.reduce((a, b) => a + b, 0) - foreignSells20.reduce((a, b) => a + b, 0);
  const foreignNet5 = window5.reduce((sum, d) => sum + num(d.foreignBuy), 0) - window5.reduce((sum, d) => sum + num(d.foreignSell), 0);

  const high20 = Math.max(...highs20);
  const low20 = Math.min(...lows20);
  const close = closes20[closes20.length - 1];
  const pricePos = high20 > low20 ? (close - low20) / (high20 - low20) : 0.5;

  const close20Ago = num(history[index - 20]?.close);
  const close5Ago = num(history[index - 5]?.close);
  if (close20Ago === null || close5Ago === null) return empty;

  const ret20 = close20Ago > 0 ? (close - close20Ago) / close20Ago : null;
  const ret5 = close5Ago > 0 ? (close - close5Ago) / close5Ago : null;

  const returns = [];
  for (let i = 1; i < closesRet.length; i++) {
    const previous = closesRet[i - 1];
    const current = closesRet[i];
    if (previous > 0) returns.push((current - previous) / previous);
  }
  const volStd20 = returns.length === 20 ? standardDeviation(returns) : null;

  const freqMa20 = average(freqs20);
  const closeMa20 = average(closes20);
  const maDist = closeMa20 > 0 ? (close - closeMa20) / closeMa20 : null;

  let score = 0;

  // 1. Volume Acceleration (0-25)
  if (volRatio !== null) {
    if (volRatio >= 2.5) score += 25;
    else if (volRatio >= 1.8) score += 20;
    else if (volRatio >= 1.4) score += 15;
    else if (volRatio >= 1.2) score += 10;
    else if (volRatio >= 1.0) score += 5;
  }

  // 2. Foreign Smart Money (0-25)
  if (foreignNet20 > 5000000 && foreignNet5 > 0) score += 25;
  else if (foreignNet20 > 1000000 && foreignNet5 >= 0) score += 20;
  else if (foreignNet20 > 200000) score += 15;
  else if (foreignNet20 > 0) score += 10;
  else if (foreignNet20 > -500000) score += 3;

  // 3. Price Structure (0-20)
  if (maDist !== null && maDist > 0.03 && pricePos > 0.7) score += 20;
  else if (maDist !== null && maDist > 0 && pricePos > 0.55) score += 15;
  else if (maDist !== null && maDist > -0.02 && pricePos > 0.45) score += 10;
  else if (pricePos > 0.4) score += 5;

  // 4. Controlled Volatility (0-15)
  if (volStd20 !== null) {
    if (volStd20 < 0.03 && freqMa20 < 300) score += 15;
    else if (volStd20 < 0.045 && freqMa20 < 600) score += 12;
    else if (volStd20 < 0.06 && freqMa20 < 1000) score += 8;
    else if (volStd20 < 0.08) score += 4;
  }

  // 5. Momentum Quality (0-15)
  if (ret20 !== null && ret5 !== null) {
    if (ret20 > -0.05 && ret20 < 0.25 && ret5 > 0) score += 15;
    else if (ret20 > -0.1 && ret20 < 0.35 && ret5 > -0.03) score += 10;
    else if (ret20 > -0.15 && ret20 < 0.45) score += 5;
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  let signal = "WEAK / DIST";
  if (score >= 75) signal = "STRONG ACCUM";
  else if (score >= 60) signal = "ACCUMULATING";
  else if (score >= 45) signal = "WATCH";
  else if (score >= 30) signal = "NEUTRAL";

  return {
    gem_score: score,
    gem_signal: signal,
    vol_ratio: volRatio !== null ? Number(volRatio.toFixed(3)) : null,
    foreign_net20: Math.round(foreignNet20),
    foreign_net5: Math.round(foreignNet5),
    price_pos: Number(pricePos.toFixed(3)),
    vol_std20: volStd20 !== null ? Number(volStd20.toFixed(4)) : null,
    ret_20: ret20 !== null ? Number(ret20.toFixed(4)) : null,
    ret_5: ret5 !== null ? Number(ret5.toFixed(4)) : null,
    ma_dist: maDist !== null ? Number(maDist.toFixed(4)) : null,
  };
}

// Map DB row (snake_case) → engine format (camelCase)
function mapRow(r) {
  return {
    date: r.trade_date,
    close: Number(r.close),
    high: Number(r.high),
    low: Number(r.low),
    volume: Number(r.volume),
    frequency: Number(r.frequency),
    foreignBuy: Number(r.foreign_buy) || 0,
    foreignSell: Number(r.foreign_sell) || 0,
  };
}


// ===== akhir salinan =====

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = a => {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

async function logRecent(sb, dates, codeById, fetchAll) {
  const targets = Array.from(new Set(dates)).sort();
  if (!targets.length) return 0;
  const from = new Date(new Date(targets[0]).getTime() - 50 * 86400000).toISOString().slice(0, 10);
  const raw = await fetchAll(() => sb.from('daily_stock_data')
    .select('stock_id,trade_date,close,high,low,volume,value,frequency,foreign_buy,foreign_sell')
    .gte('trade_date', from).lte('trade_date', targets[targets.length - 1])
    .order('trade_date').order('stock_id'));

  const bySt = new Map();
  for (const r of raw) {
    const k = String(r.stock_id);
    if (!bySt.has(k)) bySt.set(k, []);
    bySt.get(k).push(r);
  }
  const series = [];
  for (const [id, rows] of bySt) {
    const code = codeById.get(id);
    if (!code) continue;
    series.push({ code, rows, hist: rows.map(mapRow), val: rows.map(r => Number(r.value) || 0) });
  }

  let total = 0;
  for (const T of targets) {
    const out = [];
    const scores = [];   // hanya untuk diagnosis di log, tidak disimpan ke database
    for (const s of series) {
      let idx = -1;
      for (let i = s.rows.length - 1; i >= 0; i--) {
        const d = String(s.rows[i].trade_date).slice(0, 10);
        if (d === T) { idx = i; break; }
        if (d < T) break;
      }
      if (idx < 20) continue;
      let sum = 0;
      for (let k = idx - 19; k <= idx; k++) sum += s.val[k];
      const avg = sum / 20;
      const close = Number(s.rows[idx].close);
      if (!(avg >= MINVAL) || !(close > 0)) continue;
      const g = calculateGemScore(s.hist, idx);
      if (g.gem_score == null) continue;
      out.push({ log_date: T, stock_code: s.code, verdict: g.gem_score >= STRONG_MIN ? 'GEM_STRONG' : 'GEM_BASE', ref_close: close, foreign_ratio_20d: null, avg_value_20d: avg });
      scores.push(g.gem_score);
    }
    for (let i = 0; i < out.length; i += 500) {
      const { error } = await sb.from('verdict_forward_log').upsert(out.slice(i, i + 500), { onConflict: 'log_date,stock_code,verdict', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    const strong = out.filter(r => r.verdict === 'GEM_STRONG').map(r => r.stock_code);
    const n60 = scores.filter(x => x >= 60).length, n45 = scores.filter(x => x >= 45).length;
    console.log('Pencatat GEM ' + T + ': ' + out.length + ' saham likuid dinilai, GEM_STRONG ' + strong.length + (strong.length ? ' (' + strong.join(', ') + ')' : ''));
    console.log('  diagnosis skor: tertinggi ' + (scores.length ? Math.max(...scores) : '-') + ', median ' + (scores.length ? median(scores) : '-') + ', >=60: ' + n60 + ', >=45: ' + n45);
    total += out.length;
  }
  return total;
}

async function logDay(sb, target, codeById, fetchAll) {
  return logRecent(sb, [target], codeById, fetchAll);
}

async function summary(sb, fetchAll) {
  const all = await fetchAll(() => sb.from('verdict_forward_log')
    .select('log_date,stock_code,verdict,ret_1d,ret_3d,ret_5d,ret_10d').in('verdict', VERDICTS).order('id'));
  const clean = all.filter(r => r.log_date >= CLEAN_FROM);
  const strongAll = clean.filter(r => r.verdict === 'GEM_STRONG');
  console.log('Forward test GEM: ' + strongAll.length + ' kejadian GEM_STRONG dalam ' + new Set(strongAll.map(r => r.log_date)).size +
    ' hari (log_date >= ' + CLEAN_FROM + '). Pembanding: GEM_BASE hari yang sama.');
  console.log('  ' + (all.length - clean.length) + ' baris sebelum batas itu tidak dihitung (tumpang tindih dengan data backtest).');

  const pct = x => (x == null ? '-' : (x * 100).toFixed(2) + '%');
  const rows = [];
  for (const h of [1, 3, 5, 10]) {
    const col = 'ret_' + h + 'd';
    const baseDay = new Map();
    for (const r of clean) {
      if (r.verdict !== 'GEM_BASE' || r[col] == null) continue;
      const o = baseDay.get(r.log_date) || { s: 0, n: 0, v: [] };
      o.s += Number(r[col]); o.n++; o.v.push(Number(r[col])); baseDay.set(r.log_date, o);
    }
    const rs = strongAll.filter(r => r[col] != null && baseDay.has(r.log_date) && baseDay.get(r.log_date).n >= 10);
    if (!rs.length) continue;
    const rets = rs.map(r => Number(r[col]));
    const exs = rs.map(r => Number(r[col]) - baseDay.get(r.log_date).s / baseDay.get(r.log_date).n);
    const days = new Set(rs.map(r => r.log_date)).size;
    const sorted = exs.slice().sort((a, b) => b - a);
    const tot = exs.reduce((a, b) => a + b, 0);
    const top3 = tot > 0 ? sorted.slice(0, 3).reduce((a, b) => a + b, 0) / tot : null;
    const baseRets = [];
    baseDay.forEach(o => baseRets.push(...o.v));
    const notes = [];
    if (rs.length < 30) notes.push('sampel kecil');
    if (days < 10) notes.push('sedikit hari');
    rows.push({
      hari: h, n: rs.length, 'hari tercatat': days,
      'naik %': (rets.filter(x => x > 0).length / rs.length * 100).toFixed(1),
      'base naik %': baseRets.length ? (baseRets.filter(x => x > 0).length / baseRets.length * 100).toFixed(1) : '-',
      'rata2': pct(mean(rets)), 'vs base (pp)': (mean(exs) * 100).toFixed(2),
      median: pct(median(rets)), 'median base': pct(median(baseRets)),
      '3 teratas %': top3 == null ? '-' : (top3 * 100).toFixed(0) + '%',
      catatan: notes.join(', '),
    });
  }
  if (!rows.length) { console.log('  Belum ada hasil GEM yang bersih: muncul setelah beberapa hari bursa berlalu sejak ' + CLEAN_FROM + '.'); return; }
  console.table(rows);
  console.log('  "3 teratas %" = porsi selisih total yang datang dari 3 kejadian terbaik; makin tinggi, makin bergantung pada lonjakan langka.');
  console.log('  Keputusan baru layak bila >= 150 kejadian dari >= 40 hari bursa. Pembanding backtest (in-sample, T+10): GEM>=75 +5,9 pp vs universe, median 0%, t = 1,6 (belum signifikan).');
}

module.exports = { logDay, logRecent, summary, VERDICTS };
