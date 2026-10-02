require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TOP = 150, HORIZONS = [5, 10], WARM = 60;

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

(async () => {
  const d0 = await sb.from('daily_stock_data').select('trade_date').order('trade_date', { ascending: false }).limit(1);
  const last = d0.data[0].trade_date;
  const top = await sb.from('daily_stock_data').select('stock_id,value').eq('trade_date', last).order('value', { ascending: false }).limit(TOP);
  const stats = {}, bym = {};
  const add = (g, h, r, m) => {
    const k = g + '|' + h;
    (stats[k] = stats[k] || []).push(r);
    const km = k + '|' + m;
    const o = (bym[km] = bym[km] || { s: 0, n: 0 });
    o.s += r; o.n++;
  };
  let done = 0;
  for (const t of top.data) {
    const q = await sb.from('daily_stock_data').select('trade_date,high,low,close,foreign_buy,foreign_sell').eq('stock_id', t.stock_id).order('trade_date', { ascending: true }).limit(1000);
    const rows = (q.data || []).filter(r => Number(r.close) > 0);
    if (rows.length < WARM + 15) continue;
    const c = rows.map(r => ({ date: r.trade_date, high: +r.high, low: +r.low, close: +r.close, net: (+r.foreign_buy || 0) - (+r.foreign_sell || 0), gross: (+r.foreign_buy || 0) + (+r.foreign_sell || 0) }));
    for (let i = WARM; i < c.length; i++) {
      const trend = structure(c, i + 1);
      let net20 = 0, gross20 = 0;
      for (let k = i - 19; k <= i; k++) { net20 += c[k].net; gross20 += c[k].gross; }
      const ratio = gross20 > 0 ? net20 / gross20 : 0;
      const fd = ratio > 0.1 ? 'asing beli' : ratio < -0.1 ? 'asing jual' : 'asing netral';
      const m = c[i].date.slice(0, 7);
      for (const h of HORIZONS) {
        if (i + h >= c.length) continue;
        const r = c[i + h].close / c[i].close - 1;
        if (!isFinite(r) || Math.abs(r) > 0.4) continue;
        add('SEMUA', h, r, m);
        add(trend + ' / ' + fd, h, r, m);
      }
    }
    done++;
  }
  const pct = x => (x * 100).toFixed(2) + '%';
  const groups = new Set(Object.keys(stats).map(k => k.split('|')[0]));
  const months = new Set(Object.keys(bym).map(k => k.split('|')[2]));
  const out = [];
  for (const h of HORIZONS) {
    const base = stats['SEMUA|' + h];
    const bm = base.reduce((x, y) => x + y, 0) / base.length;
    for (const g of groups) {
      const a = stats[g + '|' + h];
      if (!a || a.length < 300) continue;
      const mean = a.reduce((x, y) => x + y, 0) / a.length;
      let better = 0, tot = 0;
      for (const m of months) {
        const o = bym[g + '|' + h + '|' + m], b = bym['SEMUA|' + h + '|' + m];
        if (!o || !b || o.n < 20) continue;
        tot++;
        if (o.s / o.n > b.s / b.n) better++;
      }
      out.push({ kelompok: g, hari: h, n: a.length, 'naik %': (a.filter(x => x > 0).length / a.length * 100).toFixed(1), rata2: pct(mean), 'vs semua (pp)': ((mean - bm) * 100).toFixed(2), 'bulan menang': better + '/' + tot });
    }
  }
  out.sort((x, y) => x.hari - y.hari || parseFloat(y['vs semua (pp)']) - parseFloat(x['vs semua (pp)']));
  console.log('Saham diuji: ' + done + ' | sampai: ' + last);
  console.table(out);
  require('fs').writeFileSync('results/verdict-backtest-v2.json', JSON.stringify(out, null, 2));
})();