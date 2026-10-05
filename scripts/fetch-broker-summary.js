require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const KEY = process.env.ARJUM_API_KEY;
const BASE = 'https://stock.arjum.com';
const TOP = Number(process.env.TOP || 200);
const HARD_CAP = Number(process.env.QUOTA_CAP || 900);
const CONC = 4;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let warned = false;

async function usageToday() {
  const day = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const q = await sb.from('api_usage').select('count').eq('day', day).eq('provider', 'arjum').maybeSingle();
  return q.data ? q.data.count : 0;
}
async function addUsage(n) {
  const r = await sb.rpc('api_usage_add', { p_provider: 'arjum', p_n: n });
  if (r.error && !warned) { warned = true; console.log('Peringatan: penghitung kuota gagal: ' + r.error.message); }
}
async function fetchBroker(code) {
  let attempts = 0;
  for (let k = 0; k < 3; k++) {
    attempts++;
    try {
      const r = await fetch(BASE + '/api/broker-summary/' + encodeURIComponent(code) + '?all_data=true', { headers: { 'X-API-Key': KEY, Accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (k + 1)); continue; }
      if (!r.ok) return { attempts: attempts, error: 'HTTP ' + r.status };
      return { attempts: attempts, json: await r.json() };
    } catch (e) { await sleep(1000 * (k + 1)); }
  }
  return { attempts: attempts, error: 'gagal setelah 3 percobaan' };
}
function summarize(code, j) {
  const rows = (j.brokers || []).map(b => ({ c: b.broker_code, n: b.broker_name, nval: +b.nval || 0, bval: +b.bval || 0, bvol: +b.bvol || 0, sval: +b.sval || 0, svol: +b.svol || 0 }));
  if (!rows.length) return null;
  const total = rows.reduce((s, x) => s + x.bval, 0);
  const shape = x => ({ c: x.c, n: x.n, nval: Math.round(x.nval), bval: Math.round(x.bval), sval: Math.round(x.sval),
    bavg: x.bvol > 0 ? Math.round(x.bval / x.bvol * 100) / 100 : null, savg: x.svol > 0 ? Math.round(x.sval / x.svol * 100) / 100 : null });
  const buyers = rows.filter(x => x.nval > 0).sort((a, b) => b.nval - a.nval).slice(0, 10);
  const sellers = rows.filter(x => x.nval < 0).sort((a, b) => a.nval - b.nval).slice(0, 10);
  return {
    trade_date: j.broker_end_date, stock_code: code, total_value: Math.round(total), broker_count: rows.length,
    top_buyers: buyers.map(shape), top_sellers: sellers.map(shape),
    top3_buy_net: Math.round(buyers.slice(0, 3).reduce((s, x) => s + x.nval, 0)),
    top3_sell_net: Math.round(sellers.slice(0, 3).reduce((s, x) => s + x.nval, 0))
  };
}

(async () => {
  if (!KEY) throw new Error('ARJUM_API_KEY tidak ada');
  const d0 = await sb.from('daily_stock_data').select('trade_date').order('trade_date', { ascending: false }).limit(1);
  const latest = d0.data[0].trade_date;
  const top = await sb.from('daily_stock_data').select('stock_id,value').eq('trade_date', latest).order('value', { ascending: false }).limit(TOP);
  const ids = top.data.map(t => t.stock_id);
  const byId = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const q = await sb.from('stocks').select('id,code').in('id', ids.slice(i, i + 100));
    (q.data || []).forEach(s => byId.set(String(s.id), s.code));
  }
  const codes = ids.map(id => byId.get(String(id))).filter(Boolean);

  let used = await usageToday();
  console.log('Kuota terpakai hari ini sebelum jalan: ' + used + ' dari batas ' + HARD_CAP);
  if (used >= HARD_CAP) { console.log('Batas tercapai, berhenti.'); return; }

  const probe = await fetchBroker('BBCA');
  used += probe.attempts; await addUsage(probe.attempts);
  if (probe.error || !probe.json) throw new Error('Probe BBCA gagal: ' + probe.error);
  const arjumDate = probe.json.broker_end_date;
  if (arjumDate !== latest) { console.log('Arjum belum memuat ' + latest + ' (terbaru: ' + arjumDate + '). Berhenti tanpa memakai kuota lagi.'); return; }

  const ex = await sb.from('broker_summary_daily').select('stock_code').eq('trade_date', arjumDate);
  const have = new Set((ex.data || []).map(x => x.stock_code));
  const out = [];
  if (!have.has('BBCA')) { const r0 = summarize('BBCA', probe.json); if (r0) out.push(r0); }
  const queue = codes.filter(c => c !== 'BBCA' && !have.has(c));
  console.log('Tanggal data: ' + arjumDate + ' | antre: ' + queue.length + ' | sudah ada: ' + have.size);

  let ok = out.length, fail = 0, stopped = false;
  async function flush() {
    const part = out.splice(0, out.length);
    if (!part.length) return;
    const r = await sb.from('broker_summary_daily').upsert(part, { onConflict: 'trade_date,stock_code' });
    if (r.error) throw new Error(r.error.message);
  }
  async function worker() {
    while (queue.length && !stopped) {
      if (used >= HARD_CAP) { stopped = true; console.log('Batas kuota tercapai, berhenti.'); break; }
      const code = queue.shift();
      const r = await fetchBroker(code);
      used += r.attempts; await addUsage(r.attempts);
      if (r.error || !r.json) { fail++; console.log('  gagal ' + code + ': ' + r.error); continue; }
      const row = summarize(code, r.json);
      if (!row || row.trade_date !== arjumDate) { fail++; console.log('  lewati ' + code + ': tanggal atau data tidak sesuai'); continue; }
      out.push(row); ok++;
      if (out.length >= 40) await flush();
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  await flush();
  console.log('Selesai. Tersimpan: ' + ok + ' | gagal: ' + fail + ' | sisa antre: ' + queue.length + ' | kuota terpakai hari ini (perkiraan): ' + used + '/' + HARD_CAP);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });