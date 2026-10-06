// ============================================================
// Cloudflare Pages Function - API Router (Batch A + B)
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sbFetch, getLatestTradeDate, rangeToStartDate } from '../_lib/supabase.js';
import { calculateLatestForHistory, calculateHistoryForAllRows } from '../_lib/gemEngine.js';
import smartCore from '../../src/lib/smartwatchlist-core.js';

const app = new Hono();

// ============================================================
// CORS
// ============================================================
// CORS middleware untuk semua routes
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: false
}));

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/test', (c) => {
  return c.json({ ok: true, batch: 'A+B', timestamp: new Date().toISOString() });
});

// ============================================================
// ============================================================
// AUTH (CHARTNALIST) - Edge-compatible
// ============================================================

app.get('/api/auth/config', (c) => {
  const supabaseUrl = (c.env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = (c.env.SUPABASE_ANON_KEY || "").trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return c.json({ success: false, error: 'Auth config incomplete' }, 503);
  }
  return c.json({ success: true, supabaseUrl, supabaseAnonKey });
});

// ADMIN GUARD - semua route /api/admin/* wajib admin (cek tabel profiles)
app.use('/api/admin/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const match = (c.req.header('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return c.json({ success: false, error: 'Authentication required' }, 401);

  const url = c.env.SUPABASE_URL;
  const key = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return c.json({ success: false, error: 'Supabase server configuration missing' }, 500);

  const uRes = await fetch(url + '/auth/v1/user', {
    headers: { Authorization: 'Bearer ' + match[1], apikey: key },
  });
  if (!uRes.ok) return c.json({ success: false, error: 'Invalid or expired session' }, 401);
  const user = await uRes.json();

  const pRes = await fetch(url + '/rest/v1/profiles?select=role&id=eq.' + user.id, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  });
  const profile = pRes.ok ? (await pRes.json())[0] : null;
  if (!profile || profile.role !== 'admin') {
    return c.json({ success: false, error: 'Admin access required' }, 403);
  }

  c.set('authUser', user);
  await next();
});

app.get('/api/auth/me', async (c) => {
  const match = (c.req.header('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return c.json({ success: false, error: 'Authentication required' }, 401);

  const url = c.env.SUPABASE_URL;
  const key = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return c.json({ success: false, error: 'Supabase server configuration missing' }, 500);

  try {
    const uRes = await fetch(url + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + match[1], apikey: key },
    });
    if (!uRes.ok) return c.json({ success: false, error: 'Invalid or expired session' }, 401);
    const user = await uRes.json();

    const pRes = await fetch(
      url + '/rest/v1/profiles?select=id,email,display_name,avatar_url,role,plan,created_at&id=eq.' + user.id,
      { headers: { apikey: key, Authorization: 'Bearer ' + key } }
    );
    if (!pRes.ok) return c.json({ success: false, error: 'Failed to load user profile' }, 500);
    const profile = (await pRes.json())[0];
    if (!profile) return c.json({ success: false, error: 'User profile not found' }, 404);

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: profile.email || user.email || '',
        displayName: profile.display_name || '',
        avatarUrl: profile.avatar_url || '',
        role: profile.role || 'user',
        plan: profile.plan || 'free',
        createdAt: profile.created_at || null,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Auth service error' }, 500);
  }
});

// BATCH A: HISTORY (Candlestick + Volume + NonRegular)
// ============================================================
app.get('/api/public/history/:code', async (c) => {
  try {
    const code = String(c.req.param('code') || '').trim().toUpperCase();
    const range = c.req.query('range') || '3mo';
    const env = c.env;
    if (!code) return c.json({ success: false, error: 'Code required' }, 400);
    
    const stocks = await sbFetch(env, 'stocks?select=id,code,name&code=eq.' + code);
    if (!stocks || !stocks.length) {
      return c.json({ success: false, error: 'Ticker ' + code + ' tidak ditemukan' }, 404);
    }
    const stock = stocks[0];
    const latestDate = await getLatestTradeDate(env);
    const startDate = rangeToStartDate(range, latestDate);
    
    let query = 'daily_stock_data?select=trade_date,open,high,low,close,volume,value,non_regular_volume,non_regular_value,non_regular_frequency,bid,bid_volume,offer,offer_volume,foreign_buy,foreign_sell,previous_price,change_price,high,low,listed_shares,tradeable_shares,weight_for_index&stock_id=eq.' + stock.id + '&order=trade_date.asc';
    if (startDate) query += '&trade_date=gte.' + startDate;
    if (latestDate) query += '&trade_date=lte.' + latestDate;
    
    const rows = await sbFetch(env, query);
    
    const candles = rows.filter(r => r.open != null && r.close != null).map(r => ({
      time: r.trade_date, open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close)
    }));
    const volumes = rows.map(r => ({
      time: r.trade_date, value: Number(r.volume) || 0,
      color: (Number(r.close) >= Number(r.open)) ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'
    }));
    const nonRegular = rows.filter(r => Number(r.non_regular_volume) > 0).map(r => ({
      time: r.trade_date, volume: Number(r.non_regular_volume) || 0,
      value: Number(r.non_regular_value) || 0, frequency: Number(r.non_regular_frequency) || 0
    }));
    
    return c.json({
      success: true, code: stock.code, name: stock.name,
      range, startDate, endDate: latestDate, candles, volumes, nonRegular
    });
  } catch (err) {
    console.error('[history]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============================================================
// BATCH B: SUMMARY (Bandarmology + 52W Range)
// ============================================================
app.get('/api/public/summary/:code', async (c) => {
  try {
    const code = String(c.req.param('code') || '').trim().toUpperCase();
    const env = c.env;
    if (!code) return c.json({ success: false, error: 'Code required' }, 400);
    
    const stocks = await sbFetch(env, 'stocks?select=id,code,name&code=eq.' + code);
    if (!stocks || !stocks.length) {
      return c.json({ success: false, error: 'Ticker tidak ditemukan', hasData: false }, 404);
    }
    const stock = stocks[0];
    
    // Ambil 25 hari terakhir untuk hitung avg foreign + 52W
    const recentRows = await sbFetch(env, 
      'daily_stock_data?select=trade_date,close,volume,value,foreign_buy,foreign_sell,high,low&stock_id=eq.' + 
      stock.id + '&order=trade_date.desc&limit=252'
    );
    
    if (!recentRows || !recentRows.length) {
      return c.json({ success: true, hasData: false, error: 'No data' });
    }
    
    // Row terbaru (hari ini)
    const latest = recentRows[0];
    const yesterday = recentRows[1] || latest;
    
    // 52W dari 252 rows terakhir
    const high52 = Math.max(...recentRows.map(r => Number(r.high) || 0));
    const low52 = Math.min(...recentRows.filter(r => Number(r.low) > 0).map(r => Number(r.low)));
    
    // Foreign flow
    const foreignBuyToday = Number(latest.foreign_buy) || 0;
    const foreignSellToday = Number(latest.foreign_sell) || 0;
    const netForeignToday = foreignBuyToday - foreignSellToday;
    
    // Net Foreign 20D (sum last 20 days)
    const last20 = recentRows.slice(0, 20);
    const netForeign20d = last20.reduce((sum, r) => {
      return sum + ((Number(r.foreign_buy) || 0) - (Number(r.foreign_sell) || 0));
    }, 0);
    
    // Simple bandar score heuristic (0-100)
    // Based on: net foreign trend + volume surge
    let bandarScore = 50;
    
    
    
    const gross20 = last20.reduce((s, r) => s + (Number(r.foreign_buy) || 0) + (Number(r.foreign_sell) || 0), 0);
    bandarScore = gross20 > 0 ? 50 + 50 * (netForeign20d / gross20) : 50;
    
    
    
    bandarScore = Math.max(0, Math.min(100, Math.round(bandarScore)));
    
    return c.json({
      success: true,
      hasData: true,
      code: stock.code,
      name: stock.name,
      date: latest.trade_date,
      marketLatestDate: latest.trade_date,
      close: Number(latest.close) || 0,
      low52: low52,
      high52: high52,
      bandarScore: bandarScore,
      foreignBuyToday: foreignBuyToday,
      foreignSellToday: foreignSellToday,
      netForeignToday: netForeignToday,
      netForeign20d: netForeign20d,
      foreignRatio20d: gross20 > 0 ? netForeign20d / gross20 : 0,
      avgValue20d: last20.reduce((s, r) => s + (Number(r.value) || 0), 0) / Math.max(1, last20.length),
      isCurrentSession: true,
      dataStatus: 'CURRENT'
    });
  } catch (err) {
    console.error('[summary]', err);
    return c.json({ success: false, hasData: false, error: err.message }, 500);
  }
});

// ============================================================
// BATCH A: YAHOO QUOTE PROXY
// ============================================================
// ============================================================
// KUNJUNGAN + MONITORING + FORWARD TEST
// ============================================================
async function cnRpc(env, fn) {
  const t0 = Date.now();
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!r.ok) throw new Error(fn + ' HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return { data: await r.json(), ms: Date.now() - t0 };
}
async function cnGetOne(env, query) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + query, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }
  });
  if (!r.ok) throw new Error('query HTTP ' + r.status);
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : null;
}
async function cnYahooPing() {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?range=1d&interval=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal
    });
    clearTimeout(to);
    return { ok: r.ok, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0 };
  }
}

// Publik: pencatat kunjungan (tanpa IP, tanpa query string)
app.post('/api/track', async (c) => {
  try {
    const ua = c.req.header('User-Agent') || '';
    if (/bot|crawl|spider|slurp|facebookexternalhit|headless|lighthouse|preview/i.test(ua)) return c.json({ ok: true });
    const b = await c.req.json();
    const path = String(b.path || '').split('?')[0].slice(0, 200);
    const sid = String(b.sid || '').slice(0, 64);
    if (path.charAt(0) !== '/' || /^\/admin/i.test(path) || sid.length < 8) return c.json({ ok: true });
    const uid = /^[0-9a-f-]{36}$/i.test(String(b.uid || '')) ? b.uid : null;
    const row = { path: path, session_id: sid, user_id: uid, referrer: String(b.ref || '').slice(0, 200) || null };
    await fetch(c.env.SUPABASE_URL + '/rest/v1/page_views', {
      method: 'POST',
      headers: { apikey: c.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + c.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: true });
  }
});

async function cnArjumInfo(env) {
  try {
    const day = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await Promise.all([
      cnGetOne(env, 'api_usage?select=count&provider=eq.arjum&day=eq.' + day),
      cnGetOne(env, 'broker_summary_daily?select=trade_date&order=trade_date.desc&limit=1')
    ]);
    return { used_today: res[0] ? res[0].count : 0, limit: 1000, last_broker_date: res[1] ? res[1].trade_date : null };
  } catch (e) { return { error: e.message }; }
}
app.get('/api/admin/monitor', async (c) => {
  try {
    const env = c.env;
    const [stats, eod, lastView, yahoo] = await Promise.all([
      cnRpc(env, 'admin_monitor_stats'),
      cnGetOne(env, 'daily_stock_data?select=trade_date&order=trade_date.desc&limit=1'),
      cnGetOne(env, 'page_views?select=viewed_at&order=viewed_at.desc&limit=1'),
      cnYahooPing()
    ]);
    return c.json({
      success: true,
      stats: stats.data,
      health: {
        db_ms: stats.ms,
        latest_trade_date: eod ? eod.trade_date : null,
        last_view_at: lastView ? lastView.viewed_at : null,
        yahoo: yahoo,
        arjum: await cnArjumInfo(env),
        server_time: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[admin-monitor]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get('/api/admin/forward-test', async (c) => {
  try {
    const r = await cnRpc(c.env, 'admin_forward_summary');
    return c.json({ success: true, data: r.data });
  } catch (err) {
    console.error('[admin-forward-test]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});
// ============================================================
// BROKER SUMMARY (wajib login; membaca tabel sendiri, tanpa request ke penyedia)
// ============================================================
async function cnRequireUser(c) {
  const m = (c.req.header('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const r = await fetch(c.env.SUPABASE_URL + '/auth/v1/user', {
    headers: { Authorization: 'Bearer ' + m[1], apikey: c.env.SUPABASE_SERVICE_ROLE_KEY }
  });
  if (!r.ok) return null;
  return await r.json();
}
app.get('/api/broker/:code', async (c) => {
  try {
    const user = await cnRequireUser(c);
    if (!user) return c.json({ success: false, error: 'Login diperlukan' }, 401);
    const code = String(c.req.param('code') || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,6}$/.test(code)) return c.json({ success: false, error: 'Kode tidak valid' }, 400);
    const r = await fetch(c.env.SUPABASE_URL + '/rest/v1/broker_summary_daily?select=trade_date,stock_code,total_value,broker_count,top_buyers,top_sellers,top3_buy_net,top3_sell_net&stock_code=eq.' + code + '&order=trade_date.desc&limit=10', {
      headers: { apikey: c.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + c.env.SUPABASE_SERVICE_ROLE_KEY }
    });
    if (!r.ok) throw new Error('query HTTP ' + r.status);
    const rows = await r.json();
    c.header('Cache-Control', 'private, max-age=300');
    return c.json({ success: true, code: code, rows: rows });
  } catch (err) {
    console.error('[broker]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});
app.get('/api/yahoo/quote', async (c) => {
  try {
    const symbols = c.req.query('symbols') || '';
    if (!symbols) return c.json({ success: false, error: 'symbols required' }, 400);
    
    // Yahoo now requires crumb. Use v8/chart endpoint for each symbol (no crumb).
    const symbolList = symbols.split(',').map(s => s.trim()).filter(Boolean);
    
    const results = await Promise.all(symbolList.map(async (sym) => {
      try {
        const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=5d&interval=1d';
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          }
        });
        if (!res.ok) return null;
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) return null;
        
        const price = meta.regularMarketPrice || meta.previousClose || 0;
        const prevClose = (function () { try { const r = data.chart.result[0]; const ts = r.timestamp || []; const cl = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || []; const rows = []; for (let i = 0; i < ts.length; i++) { if (cl[i] != null) rows.push({ t: ts[i], c: cl[i] }); } if (rows.length < 2) return meta.previousClose || price; const day = function (s) { return new Date((s + 7 * 3600) * 1000).toISOString().slice(0, 10); }; const lastDay = day(rows[rows.length - 1].t); const mktDay = meta.regularMarketTime ? day(meta.regularMarketTime) : lastDay; return lastDay === mktDay ? rows[rows.length - 2].c : rows[rows.length - 1].c; } catch (e) { return meta.previousClose || price; } })();
        const change = price - prevClose;
        const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
        
        return {
          symbol: meta.symbol || sym,
          longName: meta.longName || meta.shortName || sym,
          shortName: meta.shortName || meta.longName || sym,
          regularMarketPrice: price,
          regularMarketChange: change,
          regularMarketChangePercent: changePct,
          regularMarketVolume: meta.regularMarketVolume || 0,
          fiftyTwoWeekLow: meta.fiftyTwoWeekLow || null,
          fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || null,
          bid: null, bidSize: null, ask: null, askSize: null
        };
      } catch (e) {
        return null;
      }
    }));
    
    return c.json({ success: true, result: results.filter(Boolean) });
  } catch (err) {
    console.error('[yahoo-quote]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============================================================
// BATCH A: YAHOO CHART PROXY
// ============================================================
app.get('/api/yahoo/chart/:symbol', async (c) => {
  try {
    const symbol = c.req.param('symbol');
    const range = c.req.query('range') || '1y';
    const interval = c.req.query('interval') || '1d';
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=' + range + '&interval=' + interval;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    if (!res.ok) return c.json({ success: false, error: 'Yahoo HTTP ' + res.status }, res.status);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return c.json({ success: false, error: 'No data from Yahoo' }, 404);
    return c.json({ success: true, result });
  } catch (err) {
    console.error('[yahoo-chart]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============================================================
// BATCH B: SEARCH (Ticker Autocomplete)
// ============================================================
app.get('/api/public/search', async (c) => {
  try {
    const q = (c.req.query('q') || '').trim();
    if (!q || q.length < 1) return c.json({ success: true, results: [] });
    const env = c.env;
    
    // Supabase ilike search
    const safeQ = q.replace(/[%*(),]/g, '');
    const query = 'stocks?select=id,code,name&or=(code.ilike.*' + safeQ + '*,name.ilike.*' + safeQ + '*)&limit=10&order=code.asc';
    
    const results = await sbFetch(env, query);
    return c.json({ success: true, results: results || [] });
  } catch (err) {
    console.error('[search]', err);
    return c.json({ success: false, error: err.message, results: [] }, 500);
  }
});

// ============================================================
// BATCH B: PUBLIC SIGNALS
// ============================================================
app.get('/api/public/signals', async (c) => {
  try {
    const env = c.env;
    const statusFilter = c.req.query('status');
    
    let query = 'signals?select=*&status=in.(PUBLISHED,ACTIVE,CLOSED,EXPIRED)&order=published_at.desc&limit=100';
    if (statusFilter) {
      query = 'signals?select=*&status=eq.' + statusFilter + '&order=published_at.desc&limit=100';
    }
    
    const signals = await sbFetch(env, query);
    return c.json({ success: true, signals: signals || [] });
  } catch (err) {
    console.error('[public-signals]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============================================================
// BATCH B: SIGNAL PERFORMANCE STATS
// ============================================================
app.get('/api/public/signals/performance', async (c) => {
  try {
    const env = c.env;
    const signals = await sbFetch(env, 'signals?select=*&order=created_at.asc');
    const all = signals || [];
    
    const closed = all.filter(s => s.status === 'CLOSED' && s.outcome);
    const active = all.filter(s => s.status === 'ACTIVE');
    const published = all.filter(s => s.status === 'PUBLISHED');
    const expired = all.filter(s => s.status === 'EXPIRED');
    
    const wins = closed.filter(s => ['TP1','TP2','TP3'].includes(s.outcome));
    const losses = closed.filter(s => s.outcome === 'SL');
    const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
    
    let totalReturnPct = 0, returnCount = 0;
    let totalDays = 0, daysCount = 0;
    
    closed.forEach(s => {
      if (!s.entry_avg) return;
      let exitPrice = null;
      if (s.outcome === 'TP1') exitPrice = s.target_1;
      else if (s.outcome === 'TP2') exitPrice = s.target_2;
      else if (s.outcome === 'TP3') exitPrice = s.target_3;
      else if (s.outcome === 'SL') exitPrice = s.stop_loss;
      if (exitPrice) {
        totalReturnPct += ((exitPrice - s.entry_avg) / s.entry_avg) * 100;
        returnCount++;
      }
      if (s.entry_hit_at && s.closed_at) {
        totalDays += (new Date(s.closed_at) - new Date(s.entry_hit_at)) / (1000*60*60*24);
        daysCount++;
      }
    });
    
    const avgReturn = returnCount > 0 ? totalReturnPct / returnCount : 0;
    const avgDays = daysCount > 0 ? totalDays / daysCount : 0;
    
    const byStatus = {
      PUBLISHED: published.length, ACTIVE: active.length,
      CLOSED: closed.length, EXPIRED: expired.length
    };
    
    const byOutcome = {
      TP3: closed.filter(s => s.outcome === 'TP3').length,
      TP2: closed.filter(s => s.outcome === 'TP2').length,
      TP1: closed.filter(s => s.outcome === 'TP1').length,
      SL: closed.filter(s => s.outcome === 'SL').length
    };
    
    const byTicker = {};
    all.forEach(s => {
      if (!byTicker[s.ticker]) byTicker[s.ticker] = { ticker: s.ticker, total: 0, wins: 0 };
      byTicker[s.ticker].total++;
      if (s.outcome && ['TP1','TP2','TP3'].includes(s.outcome)) byTicker[s.ticker].wins++;
    });
    
    const growth = [];
    let cumPips = 0;
    const closedSorted = closed.filter(s => s.closed_at && s.entry_avg).sort((a,b) => 
      new Date(a.closed_at) - new Date(b.closed_at)
    );
    closedSorted.forEach(s => {
      let exitPrice = null;
      if (s.outcome === 'TP1') exitPrice = s.target_1;
      else if (s.outcome === 'TP2') exitPrice = s.target_2;
      else if (s.outcome === 'TP3') exitPrice = s.target_3;
      else if (s.outcome === 'SL') exitPrice = s.stop_loss;
      if (exitPrice) {
        cumPips += exitPrice - s.entry_avg;
        growth.push({
          date: s.closed_at.slice(0, 10), pips: Math.round(cumPips),
          ticker: s.ticker, outcome: s.outcome
        });
      }
    });
    
    const recentClosed = closed
      .filter(s => s.closed_at)
      .sort((a,b) => new Date(b.closed_at) - new Date(a.closed_at))
      .slice(0, 10)
      .map(s => {
        let exitPrice = null;
        if (s.outcome === 'TP1') exitPrice = s.target_1;
        else if (s.outcome === 'TP2') exitPrice = s.target_2;
        else if (s.outcome === 'TP3') exitPrice = s.target_3;
        else if (s.outcome === 'SL') exitPrice = s.stop_loss;
        const retPct = (exitPrice && s.entry_avg) ? ((exitPrice - s.entry_avg) / s.entry_avg) * 100 : null;
        const days = (s.entry_hit_at && s.closed_at)
          ? Math.round((new Date(s.closed_at) - new Date(s.entry_hit_at)) / (1000*60*60*24))
          : null;
        return {
          id: s.id, ticker: s.ticker, outcome: s.outcome,
          entry_avg: s.entry_avg, exit_price: exitPrice,
          return_pct: retPct, days: days, closed_at: s.closed_at,
          risk_reward: s.risk_reward
        };
      });
    
    return c.json({
      success: true,
      stats: {
        total: all.length, closed: closed.length, active: active.length,
        published: published.length, expired: expired.length,
        wins: wins.length, losses: losses.length,
        winRate: Math.round(winRate * 10) / 10,
        avgReturn: Math.round(avgReturn * 100) / 100,
        avgDays: Math.round(avgDays * 10) / 10
      },
      byStatus, byOutcome,
      byTicker: Object.values(byTicker).sort((a,b) => b.total - a.total).slice(0, 10),
      growth, recentClosed
    });
  } catch (err) {
    console.error('[performance]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============================================================
// BATCH C: BID/OFFER (dari daily_stock_data)
// ============================================================
app.get('/api/bid-offer', async (c) => {
  try {
    const code = String(c.req.query('code') || '').trim().toUpperCase();
    if (!code) return c.json({ success: false, error: 'Code required' }, 400);
    const env = c.env;
    
    const stocks = await sbFetch(env, 'stocks?select=id,code,name&code=eq.' + code);
    if (!stocks || !stocks.length) return c.json({ success: false, error: 'Stock not found' }, 404);
    const stock = stocks[0];
    
    const rows = await sbFetch(env,
      'daily_stock_data?select=trade_date,bid,bid_volume,offer,offer_volume,close,previous_price,change_price&stock_id=eq.' +
      stock.id + '&order=trade_date.desc&limit=1'
    );
    if (!rows || !rows.length) return c.json({ success: false, error: 'No data' }, 404);
    
    const row = rows[0];
    const bidVol = Number(row.bid_volume) || 0;
    const offerVol = Number(row.offer_volume) || 0;
    const totalVol = bidVol + offerVol;
    const ratio = offerVol > 0 ? bidVol / offerVol : (bidVol > 0 ? 999 : 0);
    
    let pressure = 'BALANCED', pressureColor = '#64748B';
    if (ratio >= 5) { pressure = 'STRONG BUY'; pressureColor = '#00E676'; }
    else if (ratio >= 2) { pressure = 'BUY'; pressureColor = '#00E676'; }
    else if (ratio >= 1.2) { pressure = 'SLIGHT BUY'; pressureColor = '#88E676'; }
    else if (ratio > 0 && ratio <= 0.2) { pressure = 'STRONG SELL'; pressureColor = '#FF5252'; }
    else if (ratio > 0 && ratio <= 0.5) { pressure = 'SELL'; pressureColor = '#FF5252'; }
    else if (ratio > 0 && ratio <= 0.8) { pressure = 'SLIGHT SELL'; pressureColor = '#FF8888'; }
    
    return c.json({
      success: true,
      code: stock.code, name: stock.name, trade_date: row.trade_date,
      bid: Number(row.bid) || 0, bid_volume: bidVol,
      offer: Number(row.offer) || 0, offer_volume: offerVol,
      close: Number(row.close) || 0,
      previous_price: Number(row.previous_price) || 0,
      change_price: Number(row.change_price) || 0,
      bid_pct: totalVol > 0 ? (bidVol / totalVol) * 100 : 50,
      offer_pct: totalVol > 0 ? (offerVol / totalVol) * 100 : 50,
      ratio: ratio, pressure: pressure, pressure_color: pressureColor,
      source: 'IDX EOD'
    });
  } catch (err) {
    console.error('[bid-offer]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============================================================
// BATCH C: FUNDAMENTAL (Market Cap, Free Float, Turnover)
// ============================================================
app.get('/api/fundamental/:code', async (c) => {
  try {
    const code = String(c.req.param('code') || '').trim().toUpperCase();
    if (!code) return c.json({ success: false, error: 'Code required' }, 400);
    const env = c.env;
    
    const stocks = await sbFetch(env, 'stocks?select=id,code,name&code=eq.' + code);
    if (!stocks || !stocks.length) return c.json({ success: false, error: 'Stock not found' }, 404);
    const stock = stocks[0];
    
    const rows = await sbFetch(env,
      'daily_stock_data?select=trade_date,close,volume,value,listed_shares,tradeable_shares&stock_id=eq.' +
      stock.id + '&order=trade_date.desc&limit=1'
    );
    if (!rows || !rows.length) return c.json({ success: false, error: 'No data' }, 404);
    
    const row = rows[0];
    const close = Number(row.close) || 0;
    const listed = Number(row.listed_shares) || 0;
    const tradeable = Number(row.tradeable_shares) || 0;
    const volume = Number(row.volume) || 0;
    const value = Number(row.value) || 0;
    
    return c.json({
      success: true,
      code: stock.code, name: stock.name, trade_date: row.trade_date,
      close: close, volume: volume, value: value,
      listed_shares: listed, tradeable_shares: tradeable,
      market_cap: close * listed,
      free_float_pct: listed > 0 ? (tradeable / listed) * 100 : 0,
      turnover_pct: listed > 0 ? (volume / listed) * 100 : 0,
      avg_price: volume > 0 ? value / volume : close,
      source: 'IDX EOD'
    });
  } catch (err) {
    console.error('[fundamental]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============================================================
// GEM SCORE LATEST (compute on-demand dari daily_stock_data)
// ============================================================
app.get('/api/gem-score/latest', async (c) => {
  try {
    const codes = (c.req.query('codes') || '').toUpperCase().split(',').map(x => x.trim()).filter(Boolean);
    if (!codes.length) return c.json({ success: true, data: [] });
    const env = c.env;
    
    const results = [];
    for (const code of codes) {
      try {
        const stocks = await sbFetch(env, 'stocks?select=id,code&code=eq.' + code);
        if (!stocks || !stocks.length) continue;
        
        const rows = await sbFetch(env,
          'daily_stock_data?select=trade_date,close,high,low,volume,frequency,foreign_buy,foreign_sell&stock_id=eq.' +
          stocks[0].id + '&order=trade_date.desc&limit=60'
        );
        if (!rows || rows.length < 25) continue;
        
        // Reverse untuk ascending
        const ascending = rows.slice().reverse();
        const result = calculateLatestForHistory(ascending);
        if (!result) continue;
        
        results.push({ ...result, code: stocks[0].code });
      } catch (e) {
        console.warn('[gem-latest-code]', code, e.message);
      }
    }
    
    return c.json({ success: true, data: results });
  } catch (err) {
    console.error('[gem-latest]', err);
    return c.json({ success: true, data: [] });
  }
});

// ============================================================
// GEM SCORE HISTORY (compute on-demand)
// ============================================================
app.get('/api/gem-score/history/:code', async (c) => {
  try {
    const code = String(c.req.param('code') || '').trim().toUpperCase();
    if (!code) return c.json({ success: false, error: 'Code required', data: [] }, 400);
    const env = c.env;
    
    const stocks = await sbFetch(env, 'stocks?select=id,code&code=eq.' + code);
    if (!stocks || !stocks.length) return c.json({ success: true, data: [] });
    
    const rows = await sbFetch(env,
      'daily_stock_data?select=trade_date,close,high,low,volume,frequency,foreign_buy,foreign_sell&stock_id=eq.' +
      stocks[0].id + '&order=trade_date.desc&limit=400'
    );
    if (!rows || rows.length < 25) return c.json({ success: true, data: [] });
    
    const ascending = rows.slice().reverse();
    const data = calculateHistoryForAllRows(ascending, code);
    
    // Return hanya yang gem_score != null
    const filtered = data.filter(r => r.gem_score !== null);
    return c.json({ success: true, data: filtered });
  } catch (err) {
    console.error('[gem-history]', err);
    return c.json({ success: true, data: [] });
  }
});

// ============================================================
// BATCH D: ADMIN SIGNALS - CRUD
// ============================================================

// Helper: validate signal input
function validateSignalInput(body) {
  const errors = [];
  if (!body.ticker) errors.push('Ticker wajib');
  if (!body.stop_loss) errors.push('Stop loss wajib');
  if (!body.entry_1) errors.push('Entry 1 wajib');
  if (!body.target_1) errors.push('Target 1 wajib');
  const e1 = Number(body.entry_1);
  const sl = Number(body.stop_loss);
  const tp1 = Number(body.target_1);
  if (![e1, sl, tp1].every(Number.isFinite)) errors.push('Entry, stop loss, dan target harus berupa angka');
  if (sl >= e1) errors.push('Stop loss harus lebih rendah dari entry');
  if (tp1 <= e1) errors.push('Target 1 harus lebih tinggi dari entry');
  return errors;
}

// Helper: calc entry avg (weighted)
function calcEntryAvg(s) {
  const p1 = Number(s.entry_1_pct) || 30;
  const p2 = Number(s.entry_2_pct) || 30;
  const p3 = Number(s.entry_3_pct) || 40;
  let sum = 0, weightSum = 0;
  if (s.entry_1) { sum += Number(s.entry_1) * p1; weightSum += p1; }
  if (s.entry_2) { sum += Number(s.entry_2) * p2; weightSum += p2; }
  if (s.entry_3) { sum += Number(s.entry_3) * p3; weightSum += p3; }
  return weightSum > 0 ? sum / weightSum : null;
}

// Helper: calc RR
function calcRR(s) {
  const entryAvg = calcEntryAvg(s);
  const sl = Number(s.stop_loss);
  const tp1 = Number(s.target_1);
  if (!entryAvg || !sl || !tp1) return null;
  const risk = Math.abs(entryAvg - sl);
  const reward = Math.abs(tp1 - entryAvg);
  if (risk === 0) return null;
  return reward / risk;
}

// GET /api/admin/signals - List all
app.get('/api/admin/signals', async (c) => {
  try {
    const env = c.env;
    const signals = await sbFetch(env, 'signals?select=*&order=created_at.desc');
    return c.json({ success: true, signals: signals || [] });
  } catch (err) {
    console.error('[admin-signals-list]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/admin/signals/:id - Detail
app.get('/api/admin/signals/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const env = c.env;
    const signals = await sbFetch(env, 'signals?select=*&id=eq.' + id);
    if (!signals || !signals.length) return c.json({ success: false, error: 'Not found' }, 404);
    const events = await sbFetch(env, 'signal_events?select=*&signal_id=eq.' + id + '&order=created_at.asc');
    return c.json({ success: true, signal: signals[0], events: events || [] });
  } catch (err) {
    console.error('[admin-signals-detail]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/signals - Create
app.post('/api/admin/signals', async (c) => {
  try {
    const body = await c.req.json();
    const env = c.env;
    const errors = validateSignalInput(body);
    if (errors.length) return c.json({ success: false, error: errors.join(', ') }, 400);
    
    const entryAvg = calcEntryAvg(body);
    const rr = calcRR(body);
    
    const insertData = {
      ticker: String(body.ticker).toUpperCase(),
      timeframe: body.timeframe || 'D1',
      notes: body.notes || null,
      image_url: body.image_url || null,
      entry_1: Number(body.entry_1) || null,
      entry_2: Number(body.entry_2) || null,
      entry_3: Number(body.entry_3) || null,
      entry_1_pct: Number(body.entry_1_pct) || 30,
      entry_2_pct: Number(body.entry_2_pct) || 30,
      entry_3_pct: Number(body.entry_3_pct) || 40,
      stop_loss: Number(body.stop_loss) || null,
      target_1: Number(body.target_1) || null,
      target_2: Number(body.target_2) || null,
      target_3: Number(body.target_3) || null,
      status: 'DRAFT',
      entry_avg: entryAvg,
      risk_reward: rr,
      created_by: 'admin'
    };
    
    const created = await sbFetch(env, 'signals', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(insertData)
    });
    
    const signal = Array.isArray(created) ? created[0] : created;
    
    // Log event
    await sbFetch(env, 'signal_events', {
      method: 'POST',
      body: JSON.stringify({
        signal_id: signal.id,
        event_type: 'CREATED',
        note: 'Signal dibuat sebagai draft'
      })
    });
    
    return c.json({ success: true, signal });
  } catch (err) {
    console.error('[admin-signals-create]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// PATCH /api/admin/signals/:id - Update (draft only)
app.patch('/api/admin/signals/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const body = await c.req.json();
    const env = c.env;
    
    const existing = await sbFetch(env, 'signals?select=*&id=eq.' + id);
    if (!existing || !existing.length) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing[0].status !== 'DRAFT') return c.json({ success: false, error: 'Hanya DRAFT yang bisa diubah' }, 400);
    
    const updateData = {};
    const allowed = ['ticker','timeframe','notes','image_url','entry_1','entry_2','entry_3',
                     'entry_1_pct','entry_2_pct','entry_3_pct','stop_loss','target_1','target_2','target_3'];
    allowed.forEach(k => { if (body[k] !== undefined) updateData[k] = body[k]; });
    
    const merged = { ...existing[0], ...updateData };
    updateData.entry_avg = calcEntryAvg(merged);
    updateData.risk_reward = calcRR(merged);
    
    const updated = await sbFetch(env, 'signals?id=eq.' + id, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(updateData)
    });
    
    return c.json({ success: true, signal: Array.isArray(updated) ? updated[0] : updated });
  } catch (err) {
    console.error('[admin-signals-update]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/signals/:id/publish - Publish
app.post('/api/admin/signals/:id/publish', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const env = c.env;
    
    const existing = await sbFetch(env, 'signals?select=*&id=eq.' + id);
    if (!existing || !existing.length) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing[0].status !== 'DRAFT') return c.json({ success: false, error: 'Hanya DRAFT yang bisa publish' }, 400);
    
    const updated = await sbFetch(env, 'signals?id=eq.' + id, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        status: 'PUBLISHED',
        published_at: new Date().toISOString()
      })
    });
    
    await sbFetch(env, 'signal_events', {
      method: 'POST',
      body: JSON.stringify({
        signal_id: id,
        event_type: 'PUBLISHED',
        note: 'Signal dipublikasikan'
      })
    });
    
    return c.json({ success: true, signal: Array.isArray(updated) ? updated[0] : updated });
  } catch (err) {
    console.error('[admin-signals-publish]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// DELETE /api/admin/signals/:id
app.delete('/api/admin/signals/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const env = c.env;
    
    const existing = await sbFetch(env, 'signals?select=*&id=eq.' + id);
    if (!existing || !existing.length) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing[0].status !== 'DRAFT') return c.json({ success: false, error: 'Hanya DRAFT yang bisa dihapus' }, 400);
    
    await sbFetch(env, 'signals?id=eq.' + id, { method: 'DELETE' });
    return c.json({ success: true });
  } catch (err) {
    console.error('[admin-signals-delete]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============================================================
// BATCH D: UPLOAD SIGNAL IMAGE
// ============================================================
app.post('/api/admin/signals/upload-image', async (c) => {
  try {
    const body = await c.req.json();
    const env = c.env;
    const { image, filename } = body;
    if (!image || !filename) return c.json({ success: false, error: 'image dan filename wajib' }, 400);
    
    const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return c.json({ success: false, error: 'Format image tidak valid' }, 400);
    
    const ext = match[1];
    const base64Data = match[2];
    
    // Decode base64
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    if (bytes.length > 5 * 1024 * 1024) {
      return c.json({ success: false, error: 'Image max 5MB' }, 400);
    }
    
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const safeName = String(filename).replace(/[^a-z0-9._-]/gi, '_').substring(0, 50);
    const storagePath = timestamp + '_' + random + '_' + safeName;
    
    // Upload via Supabase Storage REST API
    const uploadUrl = env.SUPABASE_URL + '/storage/v1/object/signal-images/' + storagePath;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'image/' + ext,
        'x-upsert': 'false'
      },
      body: bytes
    });
    
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error('Upload failed: ' + uploadRes.status + ' ' + errText.substring(0, 200));
    }
    
    const publicUrl = env.SUPABASE_URL + '/storage/v1/object/public/signal-images/' + storagePath;
    
    return c.json({
      success: true,
      url: publicUrl,
      path: storagePath,
      size: bytes.length
    });
  } catch (err) {
    console.error('[upload-signal-image]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============================================================
// BATCH D: UPLOAD EXCEL (IDX)
// ============================================================
app.post('/api/admin/upload-multiple', async (c) => {
  return c.json({
    success: false,
    error: 'Excel upload via Cloudflare belum tersedia. Pakai localhost:3000 sementara.'
  }, 501);
});

// ============================================================
// CHARTNALIST: SMARTWATCHLIST / SIGNAL CENTER
// Adapter-only production surface.
// Uses the existing Signal Engine JS as the authoritative engine.
// ============================================================

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCodes(raw) {
  const codes = String(raw || "")
    .split(",")
    .map(v => v.trim().toUpperCase())
    .filter(v => /^[A-Z0-9]{1,10}$/.test(v));
  return [...new Set(codes)].slice(0, 50);
}

async function fetchStockRows(env, codes) {
  let query =
    "stocks?select=id,code,name&order=code.asc";

  if (codes.length) {
    query += "&code=in.(" + codes.join(",") + ")";
  }

  return await sbFetch(env, query);
}

async function fetchSignalHistory(env, stockIds, latestDate) {
  if (!stockIds.length) return [];

  let query =
    "daily_stock_data?select=stock_id,trade_date,previous_price,open,first_trade,high,low,close,change_price,volume,value,frequency,offer,offer_volume,bid,bid_volume,foreign_sell,foreign_buy" +
    "&stock_id=in.(" + stockIds.join(",") + ")" +
    "&order=trade_date.asc";

  if (latestDate) {
    query += "&trade_date=lte." + latestDate;
  }

  return await sbFetch(env, query);
}

async function fetchHistoryWindow(env, stockIds, latestDate) {
  if (!stockIds.length || !latestDate) return [];

  const startD = new Date(latestDate + "T00:00:00Z");
  startD.setUTCDate(startD.getUTCDate() - 460);
  const start = startD.toISOString().slice(0, 10);

  const fields =
    "stock_id,trade_date,previous_price,open,first_trade,high,low,close,change_price,volume,value,frequency,offer,offer_volume,bid,bid_volume,foreign_sell,foreign_buy";
  const PAGE = 1000;
  const MAX_PAGES = 30;
  const rows = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await sbFetch(
      env,
      "daily_stock_data?select=" + fields +
        "&stock_id=in.(" + stockIds.join(",") + ")" +
        "&trade_date=gte." + start +
        "&trade_date=lte." + latestDate +
        "&order=trade_date.asc,stock_id.asc" +
        "&limit=" + PAGE + "&offset=" + (page * PAGE)
    );
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }

  throw new Error("Smartwatchlist history window exceeds page limit");
}

app.get("/api/public/smartwatchlist", async (c) => {
  try {
    const env = c.env;
    const codes = normalizeCodes(c.req.query("codes"));

    if (!codes.length) {
      return c.json({
        success: true,
        date: null,
        stocks: [],
        count: 0,
        message: "Smartwatchlist is empty."
      });
    }

    const latestDate = await getLatestTradeDate(env);
    const stocks = await fetchStockRows(env, codes);

    if (!stocks.length) {
      return c.json({ success: true, date: latestDate || null, stocks: [], count: 0 });
    }

    const history = await fetchHistoryWindow(env, stocks.map(s => s.id), latestDate);
    const { stocks: output } = smartCore.computeSmartwatchlist(stocks, history, latestDate);

    return c.json({
      success: true,
      date: latestDate || null,
      stocks: output,
      count: output.length
    });
  } catch (err) {
    console.error("[smartwatchlist]", err);
    return c.json({
      success: false,
      error: "SMARTWATCHLIST_FAILED",
      message: err?.message || "Unable to build Smartwatchlist",
      stocks: [],
      count: 0
    }, 500);
  }
});
app.get("/api/public/signal-center", async (c) => {
  try {
    const url = new URL(c.req.url);
    url.pathname = "/data/signal-center-snapshot.json";
    url.search = "";

    const res = await c.env.ASSETS.fetch(new Request(url.toString()));

    if (res.ok) {
      const snapshot = await res.json();
      return c.json({
        ...snapshot,
        servedFrom: "snapshot",
        servedAt: new Date().toISOString()
      });
    }

    return c.json({
      success: true,
      date: await getLatestTradeDate(c.env),
      count: 0,
      signals: [],
      message: "Snapshot not available; regenerate via cron."
    });
  } catch (err) {
    console.error("[signal-center]", err);
    return c.json({
      success: false,
      error: "SIGNAL_CENTER_FAILED",
      message: err?.message || "Unable to build Signal Center",
      signals: [],
      count: 0
    }, 500);
  }
});

// ============================================================
// ADMIN: daily-summary (same response shape as Express)
// ============================================================
async function sbAll(env, path) {
  const PAGE = 1000;
  const out = [];
  for (let page = 0; page < 5; page++) {
    const data = await sbFetch(env, path + '&limit=' + PAGE + '&offset=' + (page * PAGE));
    const batch = Array.isArray(data) ? data : [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

app.get('/api/admin/daily-summary', async (c) => {
  try {
    const env = c.env;
    const latestDate = await getLatestTradeDate(env);
    if (!latestDate) {
      return c.json({
        success: true, hasData: false, totalStocks: 0, activeStocks: 0,
        totalValue: 0, totalVolume: 0, files: [], stocks: []
      });
    }

    const rows = await sbAll(env,
      'daily_stock_data?select=stock_id,trade_date,close,volume,value&trade_date=eq.' + latestDate +
      '&order=value.desc,stock_id.asc');
    const stockRows = await sbAll(env, 'stocks?select=id,code&order=id.asc');
    const codeMap = {};
    stockRows.forEach(s => { codeMap[s.id] = s.code; });

    const stocks = rows.map(r => ({
      code: codeMap[r.stock_id] || '-',
      close: Number(r.close) || 0,
      volume: Number(r.volume) || 0,
      value: Number(r.value) || 0
    }));
    const totalStocks = stocks.length;
    const activeStocks = stocks.filter(s => s.volume > 0).length;
    const totalValue = stocks.reduce((sum, s) => sum + s.value, 0);
    const totalVolume = stocks.reduce((sum, s) => sum + s.volume, 0);

    let batches = [];
    try {
      const b = await sbFetch(env, 'upload_batches?select=*&order=trade_date.desc&limit=20');
      batches = Array.isArray(b) ? b : [];
    } catch (e) { batches = []; }
    const files = batches.map(b => ({ name: b.filename, count: b.row_count, date: b.trade_date }));

    return c.json({
      success: true,
      hasData: true,
      lastUpdated: latestDate,
      totalStocks, activeStocks, totalValue, totalVolume,
      files, stocks,
      totalDays: 1,
      totalRows: totalStocks,
      firstDate: latestDate,
      lastDate: latestDate,
      recentBatches: batches
    });
  } catch (err) {
    console.error('[admin-daily-summary]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});
// ============================================================
// ADMIN: stats / settings / scrape / cache (parity with Express)
// All /api/admin/* routes are protected by the admin guard above.
// ============================================================
async function sbCount(env, table) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?select=id', {
    method: 'HEAD',
    headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'count=exact' }
  });
  if (!res.ok) return null;
  const total = Number((res.headers.get('content-range') || '').split('/')[1]);
  return Number.isFinite(total) ? total : null;
}

app.get('/api/admin/stats', async (c) => {
  try {
    const env = c.env;
    let lastBatchDate = null;
    try {
      const b = await sbFetch(env, 'upload_batches?select=trade_date&order=trade_date.desc&limit=1');
      lastBatchDate = (b && b[0] && b[0].trade_date) || null;
    } catch (e) { /* table may be empty or missing */ }

    const latest = await getLatestTradeDate(env);
    const totalStocks = await sbCount(env, 'stocks');

    let totalDays = null;
    try {
      const s = await sbFetch(env, 'stocks?select=id&code=eq.BBCA&limit=1');
      if (s && s[0]) {
        const d = await sbFetch(env, 'daily_stock_data?select=trade_date&stock_id=eq.' + s[0].id + '&order=trade_date.asc&limit=1000');
        totalDays = Array.isArray(d) ? d.length : null;
      }
    } catch (e) { /* leave null */ }

    return c.json({
      server: 'online',
      lastUpdate: lastBatchDate || latest || null,
      totalStocks: totalStocks || 0,
      totalDays: totalDays || 0
    });
  } catch (err) {
    console.error('[admin-stats]', err);
    return c.json({ server: 'online', error: err.message });
  }
});

app.get('/api/admin/settings', (c) => c.json({ success: true, settings: {} }));
app.post('/api/admin/settings', (c) => c.json({ success: true }));
app.post('/api/admin/scrape', (c) => c.json({ success: true, message: 'Scrape disabled in FIX mode' }));
app.delete('/api/admin/cache', (c) => c.json({ success: true, message: 'Cache cleared' }));
// ============================================================
// FALLBACK
// ============================================================
app.all('/api/*', (c) => {
  return c.json({ success: false, error: 'API ' + c.req.method + ' ' + c.req.path + ' not found' }, 404);
});

export const onRequest = (context) => app.fetch(context.request, context.env, context);
