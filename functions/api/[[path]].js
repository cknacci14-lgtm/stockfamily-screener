// ============================================================
// Cloudflare Pages Function - API Router (Batch A: Chart)
// ============================================================

import { Hono } from 'hono';
import { sbFetch, getLatestTradeDate, rangeToStartDate } from '../_lib/supabase.js';
import { fetchPrice } from '../_lib/price.js';

const app = new Hono();

app.options('*', (c) => {
  return new Response('', {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
    }
  });
});

app.get('/api/test', (c) => {
  return c.json({ ok: true, batch: 'A', timestamp: new Date().toISOString() });
});

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
    let query = 'daily_stock_data?select=trade_date,open,high,low,close,volume,non_regular_volume,non_regular_value,non_regular_frequency&stock_id=eq.' + stock.id + '&order=trade_date.asc';
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

app.get('/api/yahoo/quote', async (c) => {
  try {
    const symbols = c.req.query('symbols') || '';
    if (!symbols) return c.json({ success: false, error: 'symbols required' }, 400);
    const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbols);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    if (!res.ok) return c.json({ success: false, error: 'Yahoo HTTP ' + res.status }, res.status);
    const data = await res.json();
    const results = data?.quoteResponse?.result || [];
    const mapped = results.map(q => ({
      symbol: q.symbol, longName: q.longName || q.shortName, shortName: q.shortName,
      regularMarketPrice: q.regularMarketPrice, regularMarketChange: q.regularMarketChange,
      regularMarketChangePercent: q.regularMarketChangePercent, regularMarketVolume: q.regularMarketVolume,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow, fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
      bid: q.bid, bidSize: q.bidSize, ask: q.ask, askSize: q.askSize
    }));
    return c.json({ success: true, result: mapped });
  } catch (err) {
    console.error('[yahoo-quote]', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

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

app.all('/api/*', (c) => {
  return c.json({ success: false, error: 'API ' + c.req.method + ' ' + c.req.path + ' not found (Batch A)' }, 404);
});

export const onRequest = (context) => app.fetch(context.request, context.env, context);
