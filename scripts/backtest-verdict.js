require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TOP = 150, HORIZONS = [3, 5, 10], WARM = 60;

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
  const stats = {};
  const add = (k, r) => { if (!stats[k]) stats[k] = []; stats[k].push(r); };
  let done = 0, firstDate = null;
  for (const t of top.data) {
    const q = await sb.from('daily_stock_data').select('trade_date,high,low,close,foreign_buy,foreign_sell').eq('stock_id', t.stock_id).order('trade_date', { ascending: true }).limit(1000);
    const rows = (q.data || []).filter(r => Number(r.close) > 0);
    if (rows.length < WARM + 15) continue;
    if (!firstDate || rows[0].trade_date < firstDate) firstDate = rows[0].trade_date;
    const c = rows.map(r => ({ high: +r.high, low: +r.low, close: +r.close, net: (+r.foreign_buy || 0) - (+r.foreign_sell || 0) }));
    for (let i = WARM; i < c.length; i++) {
      const trend = structure(c, i + 1);
      let net20 = 0;
      for (let k = i - 19; k <= i; k++) net20 += c[k].net;
      const up = /BULL|BREAKOUT/.test(trend), dn = /BEAR|BREAKDOWN/.test(trend), flow = Math.sign(net20);
      const verdict = (dn && flow <= 0) ? 'HINDARI' : (up && flow >= 0) ? 'SETUP' : 'NETRAL';
      for (const h of HORIZONS) {
        if (i + h >= c.length) continue;
        const r = c[i + h].close / c[i].close - 1;
        if (!isFinite(r) || Math.abs(r) > 0.4) continue;
        add(verdict + '|' + h, r);
        add('SEMUA|' + h, r);
      }
    }
    done++;
  }
  const pct = x => (x * 100).toFixed(2) + '%';
  const out = [];
  for (const v of ['SETUP', 'NETRAL', 'HINDARI', 'SEMUA']) {
    for (const h of HORIZONS) {
      const a = stats[v + '|' + h] || [];
      if (!a.length) continue;
      const s = a.slice().sort((x, y) => x - y);
      out.push({ verdict: v, hari: h, n: a.length, 'naik %': (a.filter(x => x > 0).length / a.length * 100).toFixed(1), rata2: pct(a.reduce((x, y) => x + y, 0) / a.length), median: pct(s[Math.floor(s.length / 2)]) });
    }
  }
  console.log('Saham diuji: ' + done + ' | data mulai: ' + firstDate + ' | sampai: ' + last);
  console.table(out);
  require('fs').writeFileSync('results/verdict-backtest.json', JSON.stringify(out, null, 2));
})();