require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const KEY = process.env.ARJUM_API_KEY;
const BASE = 'https://stock.arjum.com';
const STOCKS = Number(process.env.BF_STOCKS || 50);
const CAP = Number(process.env.BF_CAP || 750);
const MAXREQ = Number(process.env.BF_MAX || Infinity);
const CONC = 3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let warned = false;

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
async function usageToday() {
  const day = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const q = await sb.from('api_usage').select('count').eq('day', day).eq('provider', 'arjum').maybeSingle();
  return q.data ? q.data.count : 0;
}
async function addUsage(n) {
  const r = await sb.rpc('api_usage_add', { p_provider: 'arjum', p_n: n });
  if (r.error && !warned) { warned = true; console.log('Peringatan: penghitung kuota gagal: ' + r.error.message); }
}
async function tradingDates() {
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?range=2y&interval=1d', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('Yahoo HTTP ' + r.status);
  const j = await r.json();
  const ts = j.chart.result[0].timestamp, cl = j.chart.result[0].indicators.quote[0].close;
  const out = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] != null) out.push(new Date((ts[i] + 7 * 3600) * 1000).toISOString().slice(0, 10));
  return Array.from(new Set(out)).sort();
}
function weeklySample(dates) {
  const byWeek = new Map();
  dates.forEach(d => {
    const dt = new Date(d + 'T00:00:00Z');
    const wd = dt.getUTCDay();
    if (wd < 3) return;
    const mon = new Date(dt);
    mon.setUTCDate(dt.getUTCDate() - ((wd + 6) % 7));
    const wk = mon.toISOString().slice(0, 10);
    if (!byWeek.has(wk)) byWeek.set(wk, d);
  });
  return Array.from(byWeek.values()).sort();
}
function interleave(arr) {
  const out = [];
  let i = 0, j = arr.length - 1;
  while (i <= j) { out.push(arr[j--]); if (i <= j) out.push(arr[i++]); }
  return out;
}
async function fetchDay(code, d) {
  let attempts = 0;
  for (let k = 0; k < 3; k++) {
    attempts++;
    try {
      const r = await fetch(BASE + '/api/broker-summary/' + encodeURIComponent(code) + '?all_data=true&start_date=' + d + '&end_date=' + d, { headers: { 'X-API-Key': KEY, Accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (k + 1)); continue; }
      if (!r.ok) return { attempts: attempts, error: 'HTTP ' + r.status };
      return { attempts: attempts, json: await r.json() };
    } catch (e) { await sleep(1000 * (k + 1)); }
  }
  return { attempts: attempts, error: 'gagal setelah 3 percobaan' };
}
function summarize(code, d, j) {
  const ok = j && j.broker_end_date === d && Array.isArray(j.brokers);
  const rows = ok ? j.brokers.map(b => ({ nval: +b.nval || 0, bval: +b.bval || 0 })) : [];
  const total = rows.reduce((s, x) => s + x.bval, 0);
  const buy = rows.filter(x => x.nval > 0).sort((a, b) => b.nval - a.nval).slice(0, 3).reduce((s, x) => s + x.nval, 0);
  const sell = rows.filter(x => x.nval < 0).sort((a, b) => a.nval - b.nval).slice(0, 3).reduce((s, x) => s + x.nval, 0);
  return { trade_date: d, stock_code: code, total_value: Math.round(total), top3_buy_net: Math.round(buy), top3_sell_net: Math.round(sell), broker_count: rows.length };
}

(async () => {
  if (!KEY) throw new Error('ARJUM_API_KEY tidak ada');
  const d0 = await sb.from('daily_stock_data').select('trade_date').order('trade_date', { ascending: false }).limit(1);
  const latest = d0.data[0].trade_date;
  const top = await sb.from('daily_stock_data').select('stock_id,value').eq('trade_date', latest).order('value', { ascending: false }).limit(STOCKS);
  const ids = top.data.map(t => t.stock_id);
  const sq = await sb.from('stocks').select('id,code').in('id', ids);
  const codeOf = new Map((sq.data || []).map(s => [String(s.id), s.code]));
  const codes = ids.map(id => codeOf.get(String(id))).filter(Boolean);
  const cutoffD = new Date(latest + 'T00:00:00Z');
  cutoffD.setUTCDate(cutoffD.getUTCDate() - 14);
  const cutoff = cutoffD.toISOString().slice(0, 10);
  const dates = interleave(weeklySample(await tradingDates()).filter(d => d <= cutoff));
  const have = new Set((await fetchAll(() => sb.from('broker_backfill_daily').select('trade_date,stock_code').order('trade_date').order('stock_code'))).map(r => r.trade_date + '|' + r.stock_code));
  const queue = [];
  dates.forEach(d => codes.forEach(c => { if (!have.has(d + '|' + c)) queue.push({ d: d, c: c }); }));
  const totalTasks = dates.length * codes.length;
  let used = await usageToday();
  console.log('Tanggal sampel: ' + dates.length + ' | saham: ' + codes.length + ' | tugas tersisa: ' + queue.length + ' dari ' + totalTasks + ' | pemakaian hari ini: ' + used + ' (batas ' + CAP + ')');

  const out = [];
  let stored = 0, fail = 0, stopped = false, reqs = 0;
  async function flush() {
    const part = out.splice(0, out.length);
    if (!part.length) return;
    const r = await sb.from('broker_backfill_daily').upsert(part, { onConflict: 'trade_date,stock_code' });
    if (r.error) throw new Error(r.error.message);
  }
  async function worker() {
    while (queue.length && !stopped) {
      if (used >= CAP || reqs >= MAXREQ) { stopped = true; break; }
      const t = queue.shift();
      const r = await fetchDay(t.c, t.d);
      used += r.attempts; reqs += r.attempts;
      await addUsage(r.attempts);
      if (r.error || !r.json) { fail++; console.log('  gagal ' + t.c + ' ' + t.d + ': ' + r.error); continue; }
      out.push(summarize(t.c, t.d, r.json));
      stored++;
      if (out.length >= 40) await flush();
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  await flush();
  console.log('Selesai. Tersimpan: ' + stored + ' | gagal: ' + fail + ' | tugas tersisa: ' + queue.length + ' | pemakaian hari ini: ' + used + '/' + CAP + (stopped ? ' (berhenti karena batas)' : ''));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });