require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SCOPE = 8e9, PRE = 4e9, WARM = 60, HZ = [5, 10];
const argDate = ((process.argv.find(a => a.startsWith('--date=')) || '').slice(7)) || '';

async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
async function runBatches(items, fn, size) {
  size = size || 25;
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

function structure(c, end) {
  const hi = [], lo = [];
  for (let i = 2; i < end - 2; i++) {
    const x = c[i];
    if (x.high > c[i-1].high && x.high > c[i-2].high && x.high > c[i+1].high && x.high > c[i+2].high) hi.push(x.high);
    if (x.low < c[i-1].low && x.low < c[i-2].low && x.low < c[i+1].low && x.low < c[i+2].low) lo.push(x.low);
  }
  const lh = hi[hi.length - 1], ph = hi[hi.length - 2], ll = lo[lo.length - 1], pl = lo[lo.length - 2];
  let trend = 'SIDEWAYS';
  if ([lh, ph, ll, pl].every(v => v != null)) {
    if (lh > ph && ll > pl) trend = 'BULL';
    else if (lh < ph && ll < pl) trend = 'BEAR';
  }
  const close = c[end - 1].close;
  if (ll != null && close < ll) trend = 'BREAKDOWN';
  else if (lh != null && close > lh) trend = 'BREAKOUT';
  return trend;
}

async function logSignals(target, codeById) {
  const day = await fetchAll(() => sb.from('daily_stock_data').select('stock_id,value').eq('trade_date', target).gte('value', PRE).order('stock_id'));
  const toInsert = [];
  for (const t of day) {
    const code = codeById.get(String(t.stock_id));
    if (!code) continue;
    const q = await sb.from('daily_stock_data').select('trade_date,high,low,close,value,foreign_buy,foreign_sell').eq('stock_id', t.stock_id).lte('trade_date', target).order('trade_date', { ascending: true }).limit(1000);
    const rows = (q.data || []).filter(r => Number(r.close) > 0);
    if (rows.length < WARM + 5 || rows[rows.length - 1].trade_date !== target) continue;
    const c = rows.map(r => ({ high: +r.high, low: +r.low, close: +r.close, value: +r.value || 0, net: (+r.foreign_buy || 0) - (+r.foreign_sell || 0), gross: (+r.foreign_buy || 0) + (+r.foreign_sell || 0) }));
    const n = c.length, l20 = c.slice(-20);
    const avgV = l20.reduce((s, x) => s + x.value, 0) / l20.length;
    if (avgV < SCOPE) continue;
    const net = l20.reduce((s, x) => s + x.net, 0), gross = l20.reduce((s, x) => s + x.gross, 0);
    const ratio = gross > 0 ? net / gross : 0;
    const trend = structure(c, n);
    const base = { log_date: target, stock_code: code, ref_close: c[n - 1].close, foreign_ratio_20d: ratio, avg_value_20d: avgV };
    toInsert.push(Object.assign({}, base, { verdict: 'UNIVERSE' }));
    if (trend === 'BREAKDOWN') toInsert.push(Object.assign({}, base, { verdict: 'BREAKDOWN' }));
    else if (trend === 'BREAKOUT' && ratio > 0.1) toInsert.push(Object.assign({}, base, { verdict: 'BREAKOUT_ASING' }));
  }
  for (let i = 0; i < toInsert.length; i += 500) {
    const { error } = await sb.from('verdict_forward_log').upsert(toInsert.slice(i, i + 500), { onConflict: 'log_date,stock_code,verdict', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const names = v => toInsert.filter(r => r.verdict === v).map(r => r.stock_code).join(', ') || '-';
  console.log('Dicatat ' + target + ': ' + toInsert.filter(r => r.verdict === 'UNIVERSE').length + ' saham universe');
  console.log('  BREAKOUT + ASING AKUMULASI: ' + names('BREAKOUT_ASING'));
  console.log('  BREAKDOWN: ' + names('BREAKDOWN'));
}

async function logBrokerDay(d, codeById) {
  const MINV = Number(process.env.BROKER_MIN_VALUE || 25e9);
  const q = await sb.from('broker_summary_daily').select('stock_code,total_value,top3_buy_net,top3_sell_net').eq('trade_date', d).gte('total_value', MINV).limit(1000);
  if (q.error) { console.log('Radar broker ' + d + ' dilewati: ' + q.error.message); return; }
  const rows = (q.data || []).map(r => ({ code: r.stock_code, v: Number(r.total_value), score: (Number(r.top3_buy_net) + Number(r.top3_sell_net)) / Number(r.total_value) * 100 })).filter(r => isFinite(r.score));
  if (rows.length < 10) return;
  const acc = rows.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  const dist = rows.filter(r => r.score < 0).sort((a, b) => a.score - b.score).slice(0, 5);
  const idByCode = new Map();
  codeById.forEach((code, id) => idByCode.set(code, id));
  const ids = acc.concat(dist).map(r => idByCode.get(r.code)).filter(Boolean);
  if (!ids.length) return;
  const px = await sb.from('daily_stock_data').select('stock_id,close').eq('trade_date', d).in('stock_id', ids);
  const closeById = new Map((px.data || []).map(p => [String(p.stock_id), Number(p.close)]));
  const mk = (arr, verdict) => arr.map(r => ({ log_date: d, stock_code: r.code, verdict: verdict, ref_close: closeById.get(String(idByCode.get(r.code))), foreign_ratio_20d: null, avg_value_20d: r.v })).filter(x => x.ref_close > 0);
  const out = mk(acc, 'BROKER_ACC').concat(mk(dist, 'BROKER_DIST'));
  if (!out.length) return;
  const r = await sb.from('verdict_forward_log').upsert(out, { onConflict: 'log_date,stock_code,verdict', ignoreDuplicates: true });
  if (r.error) throw new Error(r.error.message);
  console.log('Radar broker dicatat ' + d + ': akumulasi ' + acc.map(x => x.code).join(', ') + ' | distribusi ' + dist.map(x => x.code).join(', '));
}
async function logBrokerCatchUp(cal, codeById) {
  for (const d of cal.slice(-6)) await logBrokerDay(d, codeById);
}

async function fillReturns(cal, codeById) {
  for (const h of HZ) {
    const col = 'ret_' + h + 'd';
    const pend = await fetchAll(() => sb.from('verdict_forward_log').select('id,log_date,stock_code,ref_close').is(col, null).order('id'));
    const byDate = new Map();
    for (const r of pend) {
      const i = cal.indexOf(r.log_date);
      if (i < 0 || i + h >= cal.length) continue;
      const d = cal[i + h];
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(r);
    }
    for (const [d, list] of byDate) {
      const px = await fetchAll(() => sb.from('daily_stock_data').select('stock_id,close').eq('trade_date', d).order('stock_id'));
      const closeByCode = new Map(px.map(p => [codeById.get(String(p.stock_id)), Number(p.close)]));
      await runBatches(list, async r => {
        const ret = closeByCode.get(r.stock_code) / Number(r.ref_close) - 1;
        if (!isFinite(ret) || Math.abs(ret) > 0.4) return;
        const upd = {}; upd[col] = ret;
        await sb.from('verdict_forward_log').update(upd).eq('id', r.id);
      });
    }
  }
}

async function summary() {
  const all = await fetchAll(() => sb.from('verdict_forward_log').select('log_date,verdict,ret_5d,ret_10d').order('id'));
  console.log('Hari tercatat: ' + new Set(all.map(r => r.log_date)).size);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const out = [];
  for (const h of HZ) {
    const col = 'ret_' + h + 'd', uni = {};
    for (const r of all) if (r.verdict === 'UNIVERSE' && r[col] != null) { const o = uni[r.log_date] || (uni[r.log_date] = { s: 0, n: 0 }); o.s += Number(r[col]); o.n++; }
    for (const v of ['BREAKOUT_ASING', 'BREAKDOWN']) {
      const rs = all.filter(r => r.verdict === v && r[col] != null && uni[r.log_date]);
      if (!rs.length) continue;
      const rets = rs.map(r => Number(r[col]));
      const ex = rs.map(r => Number(r[col]) - uni[r.log_date].s / uni[r.log_date].n);
      out.push({ sinyal: v, hari: h, n: rs.length, 'naik %': (rets.filter(x => x > 0).length / rs.length * 100).toFixed(1), rata2: (avg(rets) * 100).toFixed(2) + '%', 'vs universe (pp)': (avg(ex) * 100).toFixed(2), catatan: rs.length < 30 ? 'sampel kecil' : '' });
    }
  }
  if (out.length) console.table(out); else console.log('Belum ada hasil 5/10 hari: muncul setelah cukup hari bursa berlalu.');
}

(async () => {
  const stocks = await fetchAll(() => sb.from('stocks').select('id,code').order('id'));
  const codeById = new Map(stocks.map(s => [String(s.id), s.code]));
  const bbca = stocks.find(s => s.code === 'BBCA');
  const cal = (await fetchAll(() => sb.from('daily_stock_data').select('trade_date').eq('stock_id', bbca.id).order('trade_date'))).map(r => r.trade_date);
  const target = argDate || cal[cal.length - 1];
  await logSignals(target, codeById);
  await logBrokerCatchUp(cal, codeById);
  await fillReturns(cal, codeById);
  await summary();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });