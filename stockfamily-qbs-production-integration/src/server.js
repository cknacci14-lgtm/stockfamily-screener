// src/server.js - FIX V2.4 - Express v5 Safe Routing
const express = require('express');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { runQbsProductionSnapshot, clearProductionCache } = require('./services/qbsProductionService');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('Supabase:', process.env.SUPABASE_URL ? 'OK' : 'MISSING');

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

let backtestEngine = null;
try {
  backtestEngine = require('./engine/backtestEngine');
  console.log('✅ Backtest Engine loaded');
} catch (e) { 
  console.error('❌ Backtest Engine:', e.message); 
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) console.log(`[API] ${req.method} ${req.path}`);
  next();
});

app.get('/api/test', (req, res) => res.json({ ok: true }));

// QBS production surface: event intelligence only.
// No broker orders, capital execution, or production-trading approval is performed here.
app.get('/api/qbs/production', async (req, res) => {
  try {
    const snapshot = await runQbsProductionSnapshot({ force: req.query.refresh === '1' });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, ...snapshot });
  } catch (e) {
    console.error('[QBS Production Error]', e);
    res.status(503).json({
      success: false,
      status: 'BLOCKED',
      productionReady: false,
      error: e.message,
    });
  }
});

app.get('/api/qbs/events', async (req, res) => {
  try {
    const snapshot = await runQbsProductionSnapshot({ force: req.query.refresh === '1' });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '100', 10) || 100, 1), 500);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      status: snapshot.status,
      targetDate: snapshot.targetDate,
      events: snapshot.events.slice(0, limit),
      total: snapshot.events.length,
    });
  } catch (e) {
    console.error('[QBS Events Error]', e);
    res.status(503).json({ success: false, status: 'BLOCKED', events: [], error: e.message });
  }
});

app.post('/api/qbs/refresh', async (req, res) => {
  try {
    clearProductionCache();
    const snapshot = await runQbsProductionSnapshot({ force: true });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, status: snapshot.status, targetDate: snapshot.targetDate, eventsDetected: snapshot.events.length });
  } catch (e) {
    console.error('[QBS Refresh Error]', e);
    res.status(503).json({ success: false, status: 'BLOCKED', error: e.message });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const { data: lastBatch } = await supabase.from('upload_batches').select('*').order('trade_date', { ascending: false }).limit(1).maybeSingle();
    const { count } = await supabase.from('daily_stock_data').select('id', { count: 'exact', head: true });
    const { data: allDates } = await supabase.from('daily_stock_data').select('trade_date');
    const uniq = allDates ? [...new Set(allDates.map(r => r.trade_date))].sort() : [];
    res.json({ server: 'online', lastUpdate: lastBatch?.trade_date || uniq[uniq.length - 1] || null, totalStocks: count || 0, totalDays: uniq.length });
  } catch (e) { 
    res.json({ server: 'online', error: e.message }); 
  }
});

app.get('/api/admin/daily-summary', async (req, res) => {
  try {
    const { data: latestRow, error: dErr } = await supabase
      .from('daily_stock_data')
      .select('trade_date')
      .order('trade_date', { ascending: false })
      .limit(1)
      .single();
    if (dErr && dErr.code !== 'PGRST116') throw dErr;
    if (!latestRow) {
      return res.json({
        success: true,
        hasData: false,
        totalStocks: 0,
        activeStocks: 0,
        totalValue: 0,
        totalVolume: 0,
        files: [],
        stocks: []
      });
    }
    const latestDate = latestRow.trade_date;
    const { data: rows, error: rErr } = await supabase
      .from('daily_stock_data')
      .select('stock_id,trade_date,close,volume,value')
      .eq('trade_date', latestDate)
      .order('value', { ascending: false });
    if (rErr) throw rErr;
    const { data: stockRows, error: sErr } = await supabase
      .from('stocks')
      .select('id,code');
    if (sErr) throw sErr;
    const codeMap = {};
    (stockRows || []).forEach(s => {
      codeMap[s.id] = s.code;
    });
    const stocks = (rows || []).map(r => ({
      code: codeMap[r.stock_id] || '-',
      close: Number(r.close) || 0,
      volume: Number(r.volume) || 0,
      value: Number(r.value) || 0
    }));
    const totalStocks = stocks.length;
    const activeStocks = stocks.filter(s => s.volume > 0).length;
    const totalValue = stocks.reduce((sum, s) => sum + s.value, 0);
    const totalVolume = stocks.reduce((sum, s) => sum + s.volume, 0);
    const { data: batches, error: bErr } = await supabase
      .from('upload_batches')
      .select('*')
      .order('trade_date', { ascending: false })
      .limit(20);
    if (bErr) throw bErr;
    const files = (batches || []).map(b => ({
      name: b.filename,
      count: b.row_count,
      date: b.trade_date
    }));
    res.json({
      success: true,
      hasData: true,
      lastUpdated: latestDate,
      totalStocks,
      activeStocks,
      totalValue,
      totalVolume,
      files,
      stocks,
      totalDays: [...new Set((rows || []).map(r => r.trade_date))].length,
      totalRows: totalStocks,
      firstDate: latestDate,
      lastDate: latestDate,
      recentBatches: batches || []
    });
  } catch (e) {
    console.error('[DAILY SUMMARY ERROR]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/settings', (req, res) => res.json({ success: true, settings: {} }));
app.post('/api/admin/settings', (req, res) => res.json({ success: true }));
app.post('/api/admin/scrape', (req, res) => res.json({ success: true, message: 'Scrape disabled in FIX mode' }));
app.delete('/api/admin/cache', (req, res) => res.json({ success: true, message: 'Cache cleared' }));

app.get('/api/backtest/dates', async (req, res) => {
  try {
    if (!backtestEngine) return res.json({ dates: [] });
    const dates = await backtestEngine.getAvailableDates();
    res.json({ dates, count: dates.length });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.get('/api/backtest', async (req, res) => {
  try {
    const results = await backtestEngine.runBacktest(req.query.date || null);
    let stats = { total: results.length, avg1: 0, avg2: 0, avg3: 0, winrate: 0 };
    if (results.length) { 
      let a = 0, b = 0, c = 0, w = 0; 
      results.forEach(r => { 
        a += r.d1_pct || 0; 
        b += r.d2_pct || 0; 
        c += r.d3_pct || 0; 
        if ((r.max3_pct || 0) > 3) w++; 
      }); 
      stats.avg1 = a / results.length; 
      stats.avg2 = b / results.length; 
      stats.avg3 = c / results.length; 
      stats.winrate = (w / results.length) * 100; 
    }
    res.json({ date: req.query.date || 'latest', stats, results });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/admin/upload-multiple', upload.array('excelFiles'), async (req, res) => {
  console.log(`[UPLOAD] hit ${req.files?.length || 0} files`);
  try {
    if (!req.files?.length) return res.status(400).json({ success: false, error: 'No files received, field must be excelFiles' });

    const { data: stocks, error: sErr } = await supabase.from('stocks').select('id,code');
    if (sErr) throw sErr;
    const map = {}; stocks.forEach(s => map[s.code.trim().toUpperCase()] = s.id);
    console.log(`[UPLOAD] stocks map ${Object.keys(map).length}`);

    let allResults = [];
    let totalInserted = 0;

    for (let file of req.files) {
      const filename = file.originalname;
      const m = filename.match(/(\d{8})/);
      let trade_date = m ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}` : new Date().toISOString().slice(0, 10);
      console.log(`[UPLOAD] process ${filename} -> ${trade_date}`);

      const wb = xlsx.read(file.buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json(sheet);
      console.log(`[UPLOAD] ${filename} raw rows ${rows.length}`);

      let toInsert = [];
      for (let r of rows) {
        const code = (r['Kode Saham'] || r['code'] || '').toString().trim().toUpperCase();
        if (!code) continue;
        const sid = map[code];
        if (!sid) continue;
        const previousPrice = r['Sebelumnya'] ?? r['Harga Penutupan Hari Sebelumnya'] ?? r['Previous'] ?? 0;
        toInsert.push({
          stock_id: sid,
          trade_date: trade_date,
          previous_price: Number(previousPrice) || 0,
          open: r['Open Price'] || 0,
          high: r['Tertinggi'] || 0,
          low: r['Terendah'] || 0,
          close: r['Penutupan'] || 0,
          volume: r['Volume'] ? parseInt(r['Volume']) : 0,
          value: r['Nilai'] || 0,
          frequency: r['Frekuensi'] ? parseInt(r['Frekuensi']) : 0,
          foreign_sell: r['Foreign Sell'] ? parseInt(r['Foreign Sell']) : 0,
          foreign_buy: r['Foreign Buy'] ? parseInt(r['Foreign Buy']) : 0
        });
      }

      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += 500) {
        const batch = toInsert.slice(i, i + 500); 
        if (i === 0) { console.log('[DEBUG BATCH]', JSON.stringify(batch.slice(0, 3))); }
        const { error } = await supabase.from('daily_stock_data').upsert(batch, { onConflict: 'stock_id,trade_date' });
        if (error) { console.error(`[UPLOAD] upsert err ${filename} ${i}:`, JSON.stringify(error, null, 2)); }
        else inserted += batch.length;
      }

      const { error: logErr } = await supabase.from('upload_batches').insert({ filename, trade_date, row_count: inserted });
      if (logErr) console.error('[UPLOAD] log err', logErr.message);

      allResults.push({ filename, trade_date, raw: rows.length, inserted });
      totalInserted += inserted;
      console.log(`[UPLOAD] ${filename} DONE ${inserted}/${rows.length}`);
    }

    res.json({ success: true, files: allResults, totalStocks: totalInserted });
  } catch (e) {
    console.error('[UPLOAD ERROR]', e);
    res.status(500).json({ success: false, error: e.message, stack: e.stack });
  }
});

function rangeToStartDate(range, latestDateStr) {
  if (!latestDateStr) return null;
  const end = new Date(latestDateStr + 'T00:00:00Z');
  const start = new Date(end);
  switch (range) {
    case '1mo': start.setUTCMonth(start.getUTCMonth() - 1); break;
    case '3mo': start.setUTCMonth(start.getUTCMonth() - 3); break;
    case '6mo': start.setUTCMonth(start.getUTCMonth() - 6); break;
    case '1y':  start.setUTCFullYear(start.getUTCFullYear() - 1); break;
    default:    start.setUTCMonth(start.getUTCMonth() - 1);
  }
  return start.toISOString().slice(0, 10);
}

async function getLatestTradeDate() {
  const { data, error } = await supabase
    .from('daily_stock_data')
    .select('trade_date')
    .order('trade_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.trade_date || null;
}

app.get('/api/public/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ success: true, results: [] });

    const safeQ = q.replace(/[%,()]/g, '');
    const { data, error } = await supabase
      .from('stocks')
      .select('id,code,name')
      .or(`code.ilike.%${safeQ}%,name.ilike.%${safeQ}%`)
      .order('code', { ascending: true })
      .limit(15);

    if (error) throw error;
    res.json({ success: true, results: data });
  } catch (e) {
    console.error('[Public Search Error]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/public/watchlist', async (req, res) => {
  try {
    const codes = (req.query.codes || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
    const latestDate = await getLatestTradeDate();
    if (!latestDate) return res.json({ success: true, date: null, stocks: [] });

    let stockQuery = supabase.from('stocks').select('id,code,name');
    if (codes.length) stockQuery = stockQuery.in('code', codes);
    const { data: stocks, error: sErr } = await stockQuery;
    if (sErr) throw sErr;
    if (!stocks.length) return res.json({ success: true, date: latestDate, stocks: [] });

    const stockIds = stocks.map(s => s.id);
    const { data: dailyRows, error: dErr } = await supabase
      .from('daily_stock_data')
      .select('stock_id,close,change_price,previous_price,volume')
      .eq('trade_date', latestDate)
      .in('stock_id', stockIds);
    if (dErr) throw dErr;

    const dailyMap = new Map(dailyRows.map(r => [r.stock_id, r]));

    const result = stocks.map(s => {
      const d = dailyMap.get(s.id) || {};
      const close = Number(d.close) || 0;
      const prev = Number(d.previous_price) || 0;
      return {
        code: s.code,
        name: s.name,
        close,
        change: Number(d.change_price) || 0,
        changePercent: prev ? Number((((close - prev) / prev) * 100).toFixed(2)) : 0,
        volume: Number(d.volume) || 0
      };
    });

    res.json({ success: true, date: latestDate, stocks: result });
  } catch (e) {
    console.error('[Public Watchlist Error]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/public/history/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const range = req.query.range || '3mo';

    const { data: stock, error: sErr } = await supabase
      .from('stocks').select('id,code,name').eq('code', code).maybeSingle();
    if (sErr) throw sErr;
    if (!stock) return res.status(404).json({ success: false, error: `Ticker ${code} tidak ditemukan di database.` });

    const latestDate = await getLatestTradeDate();
    const startDate = rangeToStartDate(range, latestDate);

    let query = supabase
      .from('daily_stock_data')
      .select('trade_date,open,high,low,close,volume')
      .eq('stock_id', stock.id)
      .order('trade_date', { ascending: true });
    if (startDate) query = query.gte('trade_date', startDate);
    if (latestDate) query = query.lte('trade_date', latestDate);

    const { data: rows, error: rErr } = await query;
    if (rErr) throw rErr;

    const candles = rows
      .filter(r => r.open != null && r.close != null)
      .map(r => ({
        time: r.trade_date,
        open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close)
      }));

    const volumes = rows.map(r => ({
      time: r.trade_date,
      value: Number(r.volume) || 0,
      color: (Number(r.close) >= Number(r.open)) ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'
    }));

    res.json({
      success: true, code: stock.code, name: stock.name,
      range, startDate, endDate: latestDate, candles, volumes
    });
  } catch (e) {
    console.error('[Public History Error]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/public/summary/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();

    const { data: stock, error: sErr } = await supabase
      .from('stocks').select('id,code,name').eq('code', code).maybeSingle();
    if (sErr) throw sErr;
    if (!stock) return res.status(404).json({ success: false, error: `Ticker ${code} tidak ditemukan di database.` });

    const latestDate = await getLatestTradeDate();
    if (!latestDate) return res.json({ success: true, hasData: false, message: 'Belum ada data historis.' });

    const startDate = rangeToStartDate('1y', latestDate);

    const { data: rows, error: rErr } = await supabase
      .from('daily_stock_data')
      .select('trade_date,close,previous_price,volume,value,bid,bid_volume,offer,offer_volume,foreign_buy,foreign_sell')
      .eq('stock_id', stock.id)
      .gte('trade_date', startDate)
      .lte('trade_date', latestDate)
      .order('trade_date', { ascending: true });
    if (rErr) throw rErr;

    if (!rows.length) return res.json({ success: true, hasData: false, message: `Belum ada data historis untuk ${code}.` });

    const last = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : last;

    const closes = rows.map(r => Number(r.close)).filter(v => !isNaN(v));
    const low52 = closes.length ? Math.min(...closes) : null;
    const high52 = closes.length ? Math.max(...closes) : null;

    const trailing = rows.slice(-20);
    const netForeign20d = trailing.reduce(
      (s, r) => s + ((Number(r.foreign_buy) || 0) - (Number(r.foreign_sell) || 0)), 0
    );
    const grossForeign20d = trailing.reduce(
      (s, r) => s + (Number(r.foreign_buy) || 0) + (Number(r.foreign_sell) || 0), 0
    );
    const bandarScoreRaw = grossForeign20d > 0 ? 50 + 50 * (netForeign20d / grossForeign20d) : 50;

    res.json({
      success: true,
      hasData: true,
      code: stock.code,
      name: stock.name,
      date: last.trade_date,
      close: Number(last.close),
      change: Number(last.close) - Number(prev.close),
      changePercent: prev.close
        ? Number((((Number(last.close) - Number(prev.close)) / Number(prev.close)) * 100).toFixed(2))
        : 0,
      volume: Number(last.volume) || 0,
      value: Number(last.value) || 0,
      bid: last.bid != null ? Number(last.bid) : null,
      bidVolume: last.bid_volume != null ? Number(last.bid_volume) : null,
      offer: last.offer != null ? Number(last.offer) : null,
      offerVolume: last.offer_volume != null ? Number(last.offer_volume) : null,
      foreignBuyToday: Number(last.foreign_buy) || 0,
      foreignSellToday: Number(last.foreign_sell) || 0,
      netForeignToday: (Number(last.foreign_buy) || 0) - (Number(last.foreign_sell) || 0),
      netForeign20d,
      bandarScore: Math.max(0, Math.min(100, Math.round(bandarScoreRaw))),
      low52,
      high52
    });
  } catch (e) {
    console.error('[Public Summary Error]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

async function fetchYahoo(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  return res.json();
}

async function fetchQuoteViaChartMeta(symbol) {
  const json = await fetchYahoo(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`
  );
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || meta.regularMarketPrice == null) return null;

  const price = meta.regularMarketPrice;

  let prevClose = null;
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter(c => c != null);
  if (closes.length >= 2) {
    prevClose = closes[closes.length - 2];
  } else {
    prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
  }

  const change = prevClose != null ? price - prevClose : null;
  const changePercent = prevClose ? (change / prevClose) * 100 : null;

  return {
    symbol: meta.symbol || symbol,
    longName: meta.longName || null,
    shortName: meta.shortName || null,
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: changePercent,
    regularMarketVolume: meta.regularMarketVolume ?? null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
    bid: null, bidSize: null, ask: null, askSize: null
  };
}

app.get('/api/yahoo/quote', async (req, res) => {
  try {
    const symbols = (req.query.symbols || '').trim();
    if (!symbols) return res.json({ success: true, result: [] });

    const symbolList = symbols.split(',').map(s => s.trim()).filter(Boolean);
    const settled = await Promise.allSettled(symbolList.map(fetchQuoteViaChartMeta));

    const result = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) result.push(r.value);
      else console.error(`[Yahoo Quote] gagal untuk ${symbolList[i]}:`, r.reason?.message || r.reason);
    });

    res.json({ success: true, result });
  } catch (e) {
    console.error('[Yahoo Quote Error]', e.message);
    res.status(502).json({ success: false, error: `Yahoo Finance tidak bisa diakses: ${e.message}` });
  }
});

app.get('/api/yahoo/chart/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const range = req.query.range || '3mo';
    const interval = req.query.interval || '1d';
    const json = await fetchYahoo(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`
    );
    const result = json?.chart?.result?.[0] || null;
    if (!result) return res.status(404).json({ success: false, error: `Tidak ada data chart untuk ${symbol}` });
    res.json({ success: true, result });
  } catch (e) {
    console.error('[Yahoo Chart Error]', e.message);
    res.status(502).json({ success: false, error: `Yahoo Finance tidak bisa diakses: ${e.message}` });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: `API ${req.method} ${req.originalUrl} not found` });
  }
  next();
});

// ROUTE CATCH-ALL UNTUK FRONTEND (Aman Express v5)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => console.log(`🚀 FIX V2.4 running http://localhost:${PORT}`));