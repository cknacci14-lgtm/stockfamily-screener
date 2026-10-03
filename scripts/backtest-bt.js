require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const POOL = Number(process.env.POOL || 300);
const SCOPE = process.env.SCOPE !== undefined ? Number(process.env.SCOPE) : 8e9;
const START = '2026-01-02';
const HORIZONS = [5, 10];

const stats = {}, bym = {};
const add = (g, h, r, m) => {
  const k = g + '#' + h;
  (stats[k] = stats[k] || []).push(r);
  const km = k + '#' + m;
  const o = (bym[km] = bym[km] || { s: 0, n: 0 });
  o.s += r; o.n++;
};
const bucket = s => s < 1 ? 'S1 <1x' : s < 3 ? 'S2 1-3x' : s < 10 ? 'S3 3-10x' : 'S4 >=10x';

function scanStock(c) {
  const n = c.length;
  let vs = 0;
  for (let i = 0; i < n; i++) {
    vs += c[i].val;
    if (i >= 20) vs -= c[i - 20].val;
    if (i < 30 || c[i].d < START || vs / 20 < SCOPE) continue;
    let av = 0;
    for (let j = i - 20; j < i; j++) av += c[j].v;
    av /= 20;
    if (!(av > 0)) continue;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - 30; j <= i; j++) { if (c[j].h > hi) hi = c[j].h; if (c[j].l < lo) lo = c[j].l; }
    const pos = hi > lo ? (c[i].c - lo) / (hi - lo) * 100 : 50;
    const dir = c[i].c > c[i].o ? 'naik' : (c[i].c < c[i].o ? 'turun' : 'datar');
    const scale = c[i].bt > 0 ? c[i].bt / av : 0;
    const m = c[i].d.slice(0, 7);
    HORIZONS.forEach(h => {
      if (i + h >= n || !(c[i + 1].o > 0)) return;
      const r = c[i + h].c / c[i + 1].o - 1;
      if (!isFinite(r) || Math.abs(r) > 0.4) return;
      add('SEMUA', h, r, m);
      if (c[i].bt > 0) {
        add('BT ' + bucket(scale), h, r, m);
        if (scale >= 3 && dir !== 'datar') add('BT>=3x ' + dir + ' / ' + (pos <= 35 ? 'zona bawah' : (pos >= 65 ? 'zona atas' : 'tengah')), h, r, m);
      } else {
        add('TANPA BT', h, r, m);
      }
    });
  }
}

(async () => {
  const d0 = await sb.from('daily_stock_data').select('trade_date').order('trade_date', { ascending: false }).limit(1);
  const last = d0.data[0].trade_date;
  const top = await sb.from('daily_stock_data').select('stock_id,value').eq('trade_date', last).order('value', { ascending: false }).limit(POOL);
  const ids = top.data.map(t => t.stock_id);
  let used = 0;
  for (let k = 0; k < ids.length; k += 20) {
    const part = await Promise.all(ids.slice(k, k + 20).map(id =>
      sb.from('daily_stock_data').select('trade_date,open,high,low,close,volume,value,non_regular_volume').eq('stock_id', id).order('trade_date', { ascending: true }).limit(1000)));
    part.forEach(q => {
      const rows = (q.data || []).filter(r => Number(r.close) > 0);
      if (rows.length < 60) return;
      const c = rows.map(r => {
        const cl = +r.close;
        return { d: r.trade_date, o: +r.open > 0 ? +r.open : cl, h: +r.high > 0 ? +r.high : cl, l: +r.low > 0 ? +r.low : cl, c: cl, v: +r.volume || 0, val: +r.value || 0, bt: +r.non_regular_volume || 0 };
      });
      scanStock(c);
      used++;
    });
  }
  const pct = x => (x * 100).toFixed(2) + '%';
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const months = new Set(Object.keys(bym).map(k => k.split('#')[2]));
  const out = [];
  HORIZONS.forEach(h => {
    const baseKey = 'SEMUA#' + h;
    const base = stats[baseKey];
    if (!base || !base.length) return;
    const bm = avg(base);
    Object.keys(stats).filter(k => k.endsWith('#' + h) && k !== baseKey).forEach(k => {
      const a = stats[k];
      if (a.length < 150) return;
      const mean = avg(a);
      let better = 0, tot = 0;
      months.forEach(m => {
        const o = bym[k + '#' + m], b = bym[baseKey + '#' + m];
        if (!o || !b || o.n < 20) return;
        tot++;
        if (o.s / o.n > b.s / b.n) better++;
      });
      out.push({ kelompok: k.split('#')[0] + (a.length < 500 ? ' (sampel kecil)' : ''), hari: h, n: a.length, 'naik %': (a.filter(x => x > 0).length / a.length * 100).toFixed(1), rata2: pct(mean), 'vs semua (pp)': ((mean - bm) * 100).toFixed(2), 'bulan menang': better + '/' + tot });
    });
    out.push({ kelompok: 'SEMUA (pembanding)', hari: h, n: base.length, 'naik %': (base.filter(x => x > 0).length / base.length * 100).toFixed(1), rata2: pct(bm), 'vs semua (pp)': '0.00', 'bulan menang': '-' });
  });
  out.sort((x, y) => x.hari - y.hari || parseFloat(y['vs semua (pp)']) - parseFloat(x['vs semua (pp)']));
  console.log('Saham diuji: ' + used + ' | data BT sejak ' + START + ' sampai ' + last + ' | entry buka hari berikutnya, tanpa biaya');
  console.table(out);
  require('fs').writeFileSync('results/bt-backtest.json', JSON.stringify(out, null, 2));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });