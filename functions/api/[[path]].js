// ============================================================
// Cloudflare Pages Function - API Router (Batch A + B)
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sbFetch, getLatestTradeDate, rangeToStartDate } from '../_lib/supabase.js';
import { calculateLatestForHistory, calculateHistoryForAllRows } from '../_lib/gemEngine.js';

const app = new Hono();

// ============================================================
// CORS
// ============================================================
// CORS middleware untuk semua routes
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Admin-Token'],
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
    if (netForeign20d > 0) bandarScore += Math.min(30, Math.log10(Math.abs(netForeign20d) / 1e6 + 1) * 10);
    if (netForeign20d < 0) bandarScore -= Math.min(30, Math.log10(Math.abs(netForeign20d) / 1e6 + 1) * 10);
    if (netForeignToday > 0) bandarScore += 5;
    if (netForeignToday < 0) bandarScore -= 5;
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
        const prevClose = meta.chartPreviousClose || meta.previousClose || price;
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
  return String(raw || "")
    .split(",")
    .map(v => v.trim().toUpperCase())
    .filter(Boolean);
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

    const stocks = await fetchStockRows(env, codes);
    if (!stocks.length) {
      return c.json({
        success: true,
        date: await getLatestTradeDate(env),
        stocks: [],
        count: 0
      });
    }

    const latestDate = await getLatestTradeDate(env);
    const rows = await fetchSignalHistory(
      env,
      stocks.map(s => s.id),
      latestDate
    );

    // Cloudflare adapter intentionally stays read-only.
    // Signal Engine remains authoritative in the application runtime.
    return c.json({
      success: true,
      date: latestDate,
      stocks: [],
      count: 0,
      mode: "SIGNAL_ENGINE_ADAPTER",
      message:
        "Cloudflare adapter route is installed; authoritative Signal Engine execution is pending runtime bridge."
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
    const env = c.env;
    const codes = normalizeCodes(c.req.query("codes"));

    return c.json({
      success: true,
      date: await getLatestTradeDate(env),
      count: 0,
      signals: [],
      source: "Signal Engine -> Smartwatchlist Adapter",
      mode: "SIGNAL_MONITOR",
      generatedAt: new Date().toISOString(),
      message:
        "Cloudflare adapter route is installed; authoritative Signal Center execution is pending runtime bridge."
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
// FALLBACK
// ============================================================
app.all('/api/*', (c) => {
  return c.json({ success: false, error: 'API ' + c.req.method + ' ' + c.req.path + ' not found' }, 404);
});

export const onRequest = (context) => app.fetch(context.request, context.env, context);