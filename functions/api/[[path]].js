// ============================================================
// Cloudflare Pages Function - API Router (Batch A + B)
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sbFetch, getLatestTradeDate, rangeToStartDate } from '../_lib/supabase.js';

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
// BATCH C: GEM SCORE LATEST
// ============================================================
app.get('/api/gem-score/latest', async (c) => {
  try {
    const codes = (c.req.query('codes') || '').toUpperCase().split(',').map(x => x.trim()).filter(Boolean);
    if (!codes.length) return c.json({ success: true, data: [] });
    const env = c.env;
    
    const codeFilter = codes.map(x => '"' + x + '"').join(',');
    const stocks = await sbFetch(env, 'stocks?select=id,code&code=in.(' + codeFilter + ')');
    if (!stocks || !stocks.length) return c.json({ success: true, data: [] });
    
    const stockMap = {};
    stocks.forEach(s => stockMap[s.id] = s.code);
    const idsFilter = '(' + stocks.map(s => s.id).join(',') + ')';
    
    // Try gem_scores table
    try {
      const rows = await sbFetch(env, 
        'gem_scores?select=stock_id,trade_date,gem_score,gem_signal,vol_ratio,foreign_net20&stock_id=in.' +
        idsFilter + '&order=trade_date.desc&limit=50'
      );
      
      const latestByStock = {};
      (rows || []).forEach(r => {
        if (!latestByStock[r.stock_id]) {
          latestByStock[r.stock_id] = { ...r, code: stockMap[r.stock_id] };
        }
      });
      
      return c.json({ success: true, data: Object.values(latestByStock) });
    } catch (innerErr) {
      console.warn('[gem-latest] Table gem_scores tidak ada:', innerErr.message);
      return c.json({ success: true, data: [] });
    }
  } catch (err) {
    console.error('[gem-latest]', err);
    return c.json({ success: true, data: [] });
  }
});

// ============================================================
// BATCH C: GEM SCORE HISTORY
// ============================================================
app.get('/api/gem-score/history/:code', async (c) => {
  try {
    const code = String(c.req.param('code') || '').trim().toUpperCase();
    if (!code) return c.json({ success: false, error: 'Code required', data: [] }, 400);
    const env = c.env;
    
    const stocks = await sbFetch(env, 'stocks?select=id,code&code=eq.' + code);
    if (!stocks || !stocks.length) return c.json({ success: true, data: [] });
    
    try {
      const rows = await sbFetch(env,
        'gem_scores?select=trade_date,gem_score&stock_id=eq.' +
        stocks[0].id + '&order=trade_date.asc'
      );
      return c.json({ success: true, data: rows || [] });
    } catch (innerErr) {
      console.warn('[gem-history]', innerErr.message);
      return c.json({ success: true, data: [] });
    }
  } catch (err) {
    console.error('[gem-history]', err);
    return c.json({ success: true, data: [] });
  }
});

// ============================================================
// FALLBACK
// ============================================================
app.all('/api/*', (c) => {
  return c.json({ success: false, error: 'API ' + c.req.method + ' ' + c.req.path + ' not found' }, 404);
});

export const onRequest = (context) => app.fetch(context.request, context.env, context);