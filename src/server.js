// src/server.js - FIX V2.4 - Express v5 Safe Routing
const fs = require('fs');
const express = require('express');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { runQbsProductionSnapshot, clearProductionCache } = require('./services/qbsProductionService');
const { runStockScreenerV3 } = require('./engine/screenerV3');
const SCREENER_ENGINE = (process.env.SCREENER_ENGINE || 'v3').toLowerCase();
const gemScoreRoute = require('./routes/gemScoreRoute');
const { buildSmartwatchlist } = require('./services/smartwatchlistService');
const { buildSignalCenter } = require('./services/signalCenterService');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('Supabase:', process.env.SUPABASE_URL ? 'OK' : 'MISSING');

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use('/api/gem-score', gemScoreRoute);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

let backtestEngine = null;
try {
  backtestEngine = require('./engine/backtestEngine');
  console.log('[OK] Backtest Engine loaded');
} catch (e) { 
    console.error('â Backtest Engine:', e.message);
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) console.log(`[API] ${req.method} ${req.path}`);
  next();
});

app.get('/api/test', (req, res) => res.json({ ok: true }));
app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const accessToken = match[1];

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Supabase server configuration missing'
      });
    }

    const { createClient } = require('@supabase/supabase-js');

    const adminClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const {
      data: { user },
      error: userError
    } = await adminClient.auth.getUser(accessToken);

    if (userError || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session'
      });
    }

    const {
      data: profile,
      error: profileError
    } = await adminClient
      .from('profiles')
      .select('id, email, display_name, avatar_url, role, plan, created_at')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[AUTH ME] Profile query error:', profileError);

      return res.status(500).json({
        success: false,
        error: 'Failed to load user profile'
      });
    }

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'User profile not found'
      });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: profile.email || user.email || '',
        displayName: profile.display_name || '',
        avatarUrl: profile.avatar_url || '',
        role: profile.role || 'user',
        plan: profile.plan || 'free',
        createdAt: profile.created_at || null
      }
    });

  } catch (error) {
    console.error('[AUTH ME] Unexpected error:', error);

    return res.status(500).json({
      success: false,
      error: 'Authentication service error'
    });
  }
});
app.get('/api/auth/config', (req, res) => {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return res.status(500).json({
      success: false,
      error: 'Supabase Auth configuration missing'
    });
  }

  res.json({
    success: true,
    supabaseUrl: url,
    supabaseAnonKey: anonKey
  });
});

// QBS production surface: event intelligence only.
// No broker orders, capital execution, or production-trading approval is performed here.
//
// Engine switch (query param overrides env):
//   default    -> V3 (Supportive only, A/B FULL, C SKIP, exit T+10)
//   ?engine=v4 -> legacy V4.9.1 production snapshot
app.get('/api/qbs/production', async (req, res) => {
  const engine = (req.query.engine || SCREENER_ENGINE || 'v3').toLowerCase();
  try {
    if (engine === 'v4') {
      const snapshot = await runQbsProductionSnapshot({
        force: req.query.refresh === '1',
        targetDate: req.query.targetDate || null,
      });
      res.set('Cache-Control', 'no-store');
      return res.json({ success: true, engine: 'v4', ...snapshot });
    }

    // V3 default
    const result = await runStockScreenerV3({
      limitDays: Number(req.query.days) || 60,
      limit: Number(req.query.limit) || 50,
    });

    const now = new Date();
    const firstRow = (result.data && result.data[0]) || null;

    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      engine: 'v3',
      status: 'READY',
      regime: result.regime,
      regimeDetails: result.regimeDetails,
      targetDate: firstRow ? firstRow.date : null,
      events: result.data || [],
      total: result.total || 0,
      data: result.data || [],
      generatedAt: now.toISOString(),
      lastSync: now.toLocaleString('id-ID'),
    });
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
    const snapshot = await runQbsProductionSnapshot({
      force: req.query.refresh === '1',
      targetDate: req.query.targetDate || null,
    });
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
    const snapshot = await runQbsProductionSnapshot({
      force: true,
      targetDate: req.query.targetDate || req.body?.targetDate || null,
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, status: snapshot.status, targetDate: snapshot.targetDate, eventsDetected: snapshot.events.length });
  } catch (e) {
    console.error('[QBS Refresh Error]', e);
    res.status(503).json({ success: false, status: 'BLOCKED', error: e.message });
  }
});


/* ============================================================
   CHARTNALIST_PHASE6_4_REQUIRE_ADMIN
   Server-side role enforcement for /api/admin/*
   ============================================================ */
async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const accessToken = match[1];

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session'
      });
    }

    const {
      data: profile,
      error: profileError
    } = await supabase
      .from('profiles')
      .select('id, email, role, plan')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[ADMIN AUTH] Profile query error:', profileError);

      return res.status(500).json({
        success: false,
        error: 'Failed to verify admin profile'
      });
    }

    if (!profile) {
      return res.status(403).json({
        success: false,
        error: 'Profile not found'
      });
    }

    if (profile.role !== 'admin') {
      console.warn(
        `[ADMIN AUTH] Forbidden user ${user.id} (${profile.email || user.email || 'unknown'})`
      );

      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    req.authUser = user;
    req.authProfile = profile;

    next();
  } catch (error) {
    console.error('[ADMIN AUTH] Unexpected error:', error);

    return res.status(500).json({
      success: false,
      error: 'Admin authentication service error'
    });
  }
}
// === ADMIN MONITORING & FORWARD TEST ===
async function cnRpc(fn) {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc(fn);
  if (error) throw new Error(fn + ': ' + error.message);
  return { data: data, ms: Date.now() - t0 };
}
async function cnGetOne(table, col) {
  const { data, error } = await supabase.from(table).select(col).order(col, { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return data && data[0] ? data[0] : null;
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
app.get('/api/admin/monitor', requireAdmin, async (req, res) => {
  try {
    const [stats, eod, lastView, yahoo] = await Promise.all([
      cnRpc('admin_monitor_stats'),
      cnGetOne('daily_stock_data', 'trade_date'),
      cnGetOne('page_views', 'viewed_at'),
      cnYahooPing()
    ]);
    res.json({
      success: true,
      stats: stats.data,
      health: {
        db_ms: stats.ms,
        latest_trade_date: eod ? eod.trade_date : null,
        last_view_at: lastView ? lastView.viewed_at : null,
        yahoo: yahoo,
        server_time: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[admin-monitor]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('/api/admin/forward-test', requireAdmin, async (req, res) => {
  try {
    const r = await cnRpc('admin_forward_summary');
    res.json({ success: true, data: r.data });
  } catch (err) {
    console.error('[admin-forward-test]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
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

app.get('/api/admin/daily-summary', requireAdmin, async (req, res) => {
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

app.get('/api/admin/settings', requireAdmin, (req, res) => res.json({ success: true, settings: {} }));
app.post('/api/admin/settings', requireAdmin, (req, res) => res.json({ success: true }));
app.post('/api/admin/scrape', requireAdmin, (req, res) => res.json({ success: true, message: 'Scrape disabled in FIX mode' }));
app.delete('/api/admin/cache', requireAdmin, (req, res) => res.json({ success: true, message: 'Cache cleared' }));

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


// === HELPER: Simpan file Excel ke folder archive ===
function saveExcelToArchive(fileBuffer, originalName) {
  try {
    // Extract tanggal dari nama file (YYYYMMDD)
    const match = originalName.match(/(\d{8})/);
    if (!match) return { saved: false, reason: 'No date in filename' };
    
    const yyyymmdd = match[1];
    const year = yyyymmdd.slice(0, 4);
    const month = yyyymmdd.slice(4, 6);
    
    // Folder: data/archive/2026-09/
    const archiveDir = path.join(__dirname, '..', 'data', 'archive', `${year}-${month}`);
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    
    const archivePath = path.join(archiveDir, originalName);
    fs.writeFileSync(archivePath, fileBuffer);
    
    return { saved: true, path: archivePath };
  } catch (err) {
    console.error('[Archive] Error saving:', err.message);
    return { saved: false, reason: err.message };
  }
}

app.post('/api/admin/upload-multiple', requireAdmin, upload.array('excelFiles'), async (req, res) => {
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

      // === AUTO-BACKUP: Simpan file ke folder archive ===
      const archiveResult = saveExcelToArchive(file.buffer, filename);
      if (archiveResult.saved) {
        console.log(`[UPLOAD] Archived to: ${archiveResult.path}`);
      } else {
        console.warn(`[UPLOAD] Archive failed: ${archiveResult.reason}`);
      }

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
        // Helper: safe number conversion (handle string dengan koma/titik)
        const num = (v, def = 0) => {
          if (v == null || v === '') return def;
          const n = Number(String(v).replace(/[^0-9.-]/g, ''));
          return isNaN(n) ? def : n;
        };

        toInsert.push({
          stock_id: sid,
          trade_date: trade_date,
          previous_price: num(previousPrice),
          open: num(r['Open Price']),
          first_trade: num(r['First Trade']),
          high: num(r['Tertinggi']),
          low: num(r['Terendah']),
          close: num(r['Penutupan']),
          change_price: num(r['Selisih']),
          volume: num(r['Volume']),
          value: num(r['Nilai']),
          frequency: num(r['Frekuensi']),
          index_individual: num(r['Index Individual']),
          offer: num(r['Offer']),
          offer_volume: num(r['Offer Volume']),
          bid: num(r['Bid']),
          bid_volume: num(r['Bid Volume']),
          listed_shares: num(r['Listed Shares']),
          tradeable_shares: num(r['Tradeble Shares']),
          weight_for_index: num(r['Weight For Index']),
          foreign_sell: num(r['Foreign Sell']),
          foreign_buy: num(r['Foreign Buy']),
          non_regular_volume: num(r['Non Regular Volume']),
          non_regular_value: num(r['Non Regular Value']),
          non_regular_frequency: num(r['Non Regular Frequency'])
        });
      }

      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += 500) {
        const batch = toInsert.slice(i, i + 500); 
        if (i === 0) { console.log('[DEBUG BATCH]', JSON.stringify(batch.slice(0, 3))); }
        const { error } = await supabase.from('daily_stock_data').upsert(batch, { onConflict: 'stock_id,trade_date' });
        if (error) { 
          console.error(`[UPLOAD] Batch upsert err ${filename} ${i}:`, error.message);
          // Fallback: coba insert individual untuk batch yang gagal
          console.log(`[UPLOAD] Fallback individual insert for batch ${i}...`);
          for (const row of batch) {
            const { error: rowErr } = await supabase.from('daily_stock_data').upsert(row, { onConflict: 'stock_id,trade_date' });
            if (rowErr) {
              console.error(`[UPLOAD] Row failed (stock_id=${row.stock_id}, date=${row.trade_date}):`, rowErr.message);
            } else {
              inserted++;
            }
          }
        }
        else inserted += batch.length;
      }

      // UPSERT upload_batches (tolerate duplicate)
      const { error: logErr } = await supabase.from('upload_batches').upsert(
        { filename, trade_date, row_count: inserted },
        { onConflict: 'trade_date' }
      );
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


/*
 * CHARTNALIST — Signal Center
 *
 * Adapter/view endpoint only.
 * Signal Engine remains authoritative.
 */
app.get('/api/public/signal-center', async (req, res) => {
  try {
    const rawCodes = String(req.query.codes || '').trim();

    const codes = rawCodes
      ? rawCodes
          .split(',')
          .map(code => code.trim().toUpperCase())
          .filter(Boolean)
      : [];

    /*
     * buildSmartwatchlist() intentionally treats an empty code list
     * as an empty watchlist. Signal Center therefore needs the
     * universe explicitly when no codes are supplied.
     *
     * Fetch the stock universe here, then pass the codes into the
     * existing authoritative adapter.
     */
    let universe = codes;

    if (!universe.length) {
      const { data, error } = await supabase
        .from('stocks')
        .select('code')
        .order('code', { ascending: true });

      if (error) {
        throw error;
      }

      universe = (data || [])
        .map(row => String(row.code || '').trim().toUpperCase())
        .filter(Boolean);
    }

    const result = await buildSignalCenter(
      universe,
      {
        fullUniverse: !rawCodes,
      }
    );

    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    console.error('[Signal Center] error:', error);

    res.status(500).json({
      success: false,
      error: 'SIGNAL_CENTER_ERROR',
      message: error?.message || String(error),
    });
  }
});
app.get('/api/public/smartwatchlist', async (req, res) => {
  try {
    const codes = (req.query.codes || '')
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean);

    const result = await buildSmartwatchlist(codes);

    res.json(result);
  } catch (error) {
    console.error('[Smartwatchlist]', error);

    res.status(500).json({
      success: false,
      error: 'SMARTWATCHLIST_FAILED',
      message: error?.message || 'Unable to build Smartwatchlist',
      stocks: [],
      count: 0,
    });
  }
});

// === BID/OFFER endpoint (dari Supabase) ===
const bidOfferCache = new Map();
const BID_OFFER_CACHE_TTL = 5 * 60 * 1000; // 5 menit

app.get('/api/bid-offer', async (req, res) => {
  try {
    const code = String(req.query.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Code required' });

    // Cek cache
    const cached = bidOfferCache.get(code);
    if (cached && Date.now() - cached.ts < BID_OFFER_CACHE_TTL) {
      return res.json({ ...cached.data, cached: true });
    }

    const { data: stock, error: sErr } = await supabase
      .from('stocks').select('id, code, name').eq('code', code).maybeSingle();
    if (sErr) throw sErr;
    if (!stock) return res.status(404).json({ error: 'Stock not found' });

    const { data: rows, error: rErr } = await supabase
      .from('daily_stock_data')
      .select('trade_date, bid, bid_volume, offer, offer_volume, close, previous_price, change_price')
      .eq('stock_id', stock.id)
      .order('trade_date', { ascending: false })
      .limit(1);
    if (rErr) throw rErr;
    if (!rows || !rows.length) return res.status(404).json({ error: 'No data' });

    const row = rows[0];
    const bidVol = Number(row.bid_volume) || 0;
    const offerVol = Number(row.offer_volume) || 0;
    const totalVol = bidVol + offerVol;
    const ratio = offerVol > 0 ? bidVol / offerVol : (bidVol > 0 ? 999 : 0);

    let pressure = 'BALANCED';
    let pressureColor = '#64748B';
    if (ratio >= 5) { pressure = 'STRONG BUY'; pressureColor = '#00E676'; }
    else if (ratio >= 2) { pressure = 'BUY'; pressureColor = '#00E676'; }
    else if (ratio >= 1.2) { pressure = 'SLIGHT BUY'; pressureColor = '#88E676'; }
    else if (ratio > 0 && ratio <= 0.2) { pressure = 'STRONG SELL'; pressureColor = '#FF5252'; }
    else if (ratio > 0 && ratio <= 0.5) { pressure = 'SELL'; pressureColor = '#FF5252'; }
    else if (ratio > 0 && ratio <= 0.8) { pressure = 'SLIGHT SELL'; pressureColor = '#FF8888'; }

    const result = {
      success: true,
      code: stock.code,
      name: stock.name,
      trade_date: row.trade_date,
      bid: Number(row.bid) || 0,
      bid_volume: bidVol,
      offer: Number(row.offer) || 0,
      offer_volume: offerVol,
      close: Number(row.close) || 0,
      previous_price: Number(row.previous_price) || 0,
      change_price: Number(row.change_price) || 0,
      bid_pct: totalVol > 0 ? (bidVol / totalVol) * 100 : 50,
      offer_pct: totalVol > 0 ? (offerVol / totalVol) * 100 : 50,
      ratio: ratio,
      pressure: pressure,
      pressure_color: pressureColor,
      source: 'IDX EOD',
      cached: false
    };

    bidOfferCache.set(code, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    console.error('[bid-offer]', err);
    res.status(500).json({ error: err.message });
  }
});

// === FUNDAMENTAL endpoint (dari Supabase) ===

// === SCREENER BLOCK TRADE (v2 - with Quality Score) ===
app.get('/api/screener/block-trade', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const minVol = parseInt(req.query.minVol) || 5000000;
    const phaseFilter = (req.query.phase || 'all').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const latestDate = await getLatestTradeDate();
    if (!latestDate) return res.status(404).json({ error: 'No data' });

    const endDate = new Date(latestDate);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString().slice(0, 10);

    const { data: btRows, error: btErr } = await supabase
      .from('daily_stock_data')
      .select('stock_id, trade_date, close, high, low, open, volume, value, non_regular_volume, non_regular_value, non_regular_frequency')
      .gte('trade_date', startStr)
      .lte('trade_date', latestDate)
      .gt('non_regular_volume', 0)
      .order('trade_date', { ascending: false });
    if (btErr) throw btErr;

    const { data: stocks } = await supabase.from('stocks').select('id, code, name');
    const stockMap = {};
    stocks.forEach(s => stockMap[s.id] = s);

    const byStock = {};
    btRows.forEach(r => {
      const sid = r.stock_id;
      if (!byStock[sid]) byStock[sid] = {
        stock_id: sid, bt_volume: 0, bt_value: 0, bt_count: 0, dates: [],
        latest_close: Number(r.close), latest_date: r.trade_date
      };
      const btVol = Number(r.non_regular_volume) || 0;
      if (btVol >= minVol) {
        byStock[sid].bt_volume += btVol;
        byStock[sid].bt_value += Number(r.non_regular_value) || 0;
        byStock[sid].bt_count++;
        byStock[sid].dates.push({ date: r.trade_date, volume: btVol, value: Number(r.non_regular_value) || 0, close: Number(r.close) });
        if (r.trade_date > byStock[sid].latest_date) {
          byStock[sid].latest_close = Number(r.close);
          byStock[sid].latest_date = r.trade_date;
        }
      }
    });

    const stockIds = Object.keys(byStock).map(Number);
    if (!stockIds.length) return res.json({ success: true, filter: { days, minVol, phase: phaseFilter }, totalMatched: 0, returned: 0, stocks: [] });

    const { data: candles } = await supabase
      .from('daily_stock_data')
      .select('stock_id, trade_date, close, high, low, volume')
      .in('stock_id', stockIds)
      .gte('trade_date', startStr)
      .lte('trade_date', latestDate)
      .order('trade_date', { ascending: true });

    const candlesByStock = {};
    (candles || []).forEach(c => {
      if (!candlesByStock[c.stock_id]) candlesByStock[c.stock_id] = [];
      candlesByStock[c.stock_id].push(c);
    });

    function detectPhase(stockData, candles) {
      if (!candles || candles.length < 3) return { phase: 'NEUTRAL', color: '#64748B', detail: 'Data kurang', weight: 0 };
      const closes = candles.map(c => Number(c.close));
      const highs = candles.map(c => Number(c.high));
      const lows = candles.map(c => Number(c.low));
      const firstClose = closes[0];
      const lastClose = closes[closes.length - 1];
      const priceChange = (lastClose - firstClose) / firstClose;
      const hi = Math.max(...highs);
      const lo = Math.min(...lows);
      const range = hi - lo;
      const pos = range > 0 ? (lastClose - lo) / range : 0.5;
      
      if (priceChange > 0.05) return { phase: 'MARKUP', color: '#00E5FF', detail: 'Harga naik tajam', weight: 80 };
      if (priceChange < -0.05) return { phase: 'MARKDOWN', color: '#FFB300', detail: 'Harga turun tajam', weight: 10 };
      if (pos > 0.65 && Math.abs(priceChange) < 0.05) return { phase: 'DISTRIBUSI', color: '#FF5252', detail: 'BT tinggi @ puncak', weight: 60 };
      if (pos < 0.35 && Math.abs(priceChange) < 0.05) return { phase: 'AKUMULASI', color: '#00E676', detail: 'BT tinggi @ dasar', weight: 100 };
      return { phase: 'KONSOLIDASI', color: '#64748B', detail: 'Mixed signal', weight: 20 };
    }

    // === QUALITY SCORE ===
    function calculateScore(volume, phaseWeight, count) {
      const volScore = Math.min(Math.log10(volume + 1) * 12, 100);
      const countBonus = Math.min(count * 5, 30);
      const score = (volScore * 0.3) + (phaseWeight * 0.5) + (countBonus * 0.2);
      return Math.round(score);
    }

    const results = [];
    for (const sid of stockIds) {
      const sd = byStock[sid];
      const stock = stockMap[sid];
      if (!stock) continue;
      const phaseInfo = detectPhase(sd, candlesByStock[sid] || []);
      if (phaseFilter !== 'all' && phaseInfo.phase.toLowerCase() !== phaseFilter) continue;
      
      const score = calculateScore(sd.bt_volume, phaseInfo.weight, sd.bt_count);
      
      results.push({
        code: stock.code, name: stock.name,
        phase: phaseInfo.phase, phase_color: phaseInfo.color, phase_detail: phaseInfo.detail,
        score: score,
        bt_volume: sd.bt_volume, bt_value: sd.bt_value, bt_count: sd.bt_count,
        latest_close: sd.latest_close, latest_date: sd.latest_date,
        latest_bt: sd.dates[0] || null
      });
    }

    // Sort by SCORE (bukan volume)
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, limit);

    res.json({
      success: true,
      filter: { days, minVol, phase: phaseFilter },
      totalMatched: results.length,
      returned: top.length,
      stocks: top
    });
  } catch (err) {
    console.error('[screener-bt]', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/fundamental/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Code required' });

    const { data: stock, error: sErr } = await supabase
      .from('stocks').select('id, code, name').eq('code', code).maybeSingle();
    if (sErr) throw sErr;
    if (!stock) return res.status(404).json({ error: 'Stock not found' });

    const { data: rows, error: rErr } = await supabase
      .from('daily_stock_data')
      .select('trade_date, close, volume, value, listed_shares, tradeable_shares, weight_for_index')
      .eq('stock_id', stock.id)
      .order('trade_date', { ascending: false })
      .limit(1);
    if (rErr) throw rErr;
    if (!rows || !rows.length) return res.status(404).json({ error: 'No data' });

    const row = rows[0];
    const close = Number(row.close) || 0;
    const listed = Number(row.listed_shares) || 0;
    const tradeable = Number(row.tradeable_shares) || 0;
    const volume = Number(row.volume) || 0;
    const value = Number(row.value) || 0;

    const marketCap = close * listed;
    const freeFloat = listed > 0 ? (tradeable / listed) * 100 : 0;
    const turnover = listed > 0 ? (volume / listed) * 100 : 0;
    const avgPrice = volume > 0 ? value / volume : close;

    res.json({
      success: true,
      code: stock.code,
      name: stock.name,
      trade_date: row.trade_date,
      close: close,
      volume: volume,
      value: value,
      listed_shares: listed,
      tradeable_shares: tradeable,
      market_cap: marketCap,
      free_float_pct: freeFloat,
      turnover_pct: turnover,
      avg_price: avgPrice,
      source: 'IDX EOD'
    });
  } catch (err) {
    console.error('[fundamental]', err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// SIGNAL MANAGEMENT API
// ============================================================

// Helper: hitung status signal berdasarkan event timestamps
function computeOutcome(signal) {
  if (signal.tp3_hit_at) return 'TP3';
  if (signal.tp2_hit_at) return 'TP2';
  if (signal.tp1_hit_at) return 'TP1';
  if (signal.sl_hit_at) return 'SL';
  return null;
}

// Helper: validasi signal input
function validateSignalInput(body) {
  const errors = [];
  if (!body.ticker) errors.push('Ticker wajib');
  if (!body.stop_loss) errors.push('Stop loss wajib');
  if (!body.entry_1) errors.push('Entry 1 wajib');
  if (!body.target_1) errors.push('Target 1 wajib');
  
  const e1 = Number(body.entry_1);
  const e2 = Number(body.entry_2) || e1;
  const e3 = Number(body.entry_3) || e1;
  const sl = Number(body.stop_loss);
  const tp1 = Number(body.target_1);
  
  // Entry harus konsisten (buy signal): entry < SL
  if (sl >= e1) errors.push('Stop loss harus lebih rendah dari entry');
  // Target harus lebih tinggi dari entry
  if (tp1 <= e1) errors.push('Target 1 harus lebih tinggi dari entry');
  
  return errors;
}

// Helper: hitung entry average (weighted)
function calcEntryAvg(s) {
  const p1 = s.entry_1_pct || 30;
  const p2 = s.entry_2_pct || 30;
  const p3 = s.entry_3_pct || 40;
  const total = p1 + p2 + p3;
  
  let sum = 0, weightSum = 0;
  if (s.entry_1) { sum += Number(s.entry_1) * p1; weightSum += p1; }
  if (s.entry_2) { sum += Number(s.entry_2) * p2; weightSum += p2; }
  if (s.entry_3) { sum += Number(s.entry_3) * p3; weightSum += p3; }
  
  return weightSum > 0 ? sum / weightSum : null;
}

// Helper: hitung risk/reward
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

// === GET ALL SIGNALS (admin) ===

// === UPLOAD SIGNAL IMAGE ===
app.post('/api/admin/signals/upload-image', requireAdmin, express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { image, filename } = req.body || {};
    if (!image || !filename) {
      return res.status(400).json({ success: false, error: 'image dan filename wajib' });
    }
    const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ success: false, error: 'Format image tidak valid' });
    }
    const ext = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image max 5MB' });
    }
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const safeName = String(filename).replace(/[^a-z0-9._-]/gi, '_').substring(0, 50);
    const storagePath = timestamp + '_' + random + '_' + safeName;
    const { data, error } = await supabase.storage
      .from('signal-images')
      .upload(storagePath, buffer, { contentType: 'image/' + ext, upsert: false });
    if (error) throw error;
    const { data: urlData } = supabase.storage
      .from('signal-images')
      .getPublicUrl(storagePath);
    res.json({ success: true, url: urlData.publicUrl, path: storagePath, size: buffer.length });
  } catch (err) {
    console.error('[upload-signal-image]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === DELETE SIGNAL IMAGE ===
app.delete('/api/admin/signals/delete-image', requireAdmin, express.json(), async (req, res) => {
  try {
    const { path: storagePath } = req.body || {};
    if (!storagePath) return res.status(400).json({ success: false, error: 'path wajib' });
    const { error } = await supabase.storage.from('signal-images').remove([storagePath]);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[delete-signal-image]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/signals', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, signals: data || [] });
  } catch (err) {
    console.error('[signals-list]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === GET SIGNAL DETAIL ===
app.get('/api/admin/signals/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { data: signal, error: sErr } = await supabase
      .from('signals').select('*').eq('id', id).maybeSingle();
    if (sErr) throw sErr;
    if (!signal) return res.status(404).json({ success: false, error: 'Signal not found' });

    const { data: events, error: eErr } = await supabase
      .from('signal_events')
      .select('*')
      .eq('signal_id', id)
      .order('created_at', { ascending: true });
    if (eErr) throw eErr;

    res.json({ success: true, signal, events: events || [] });
  } catch (err) {
    console.error('[signals-detail]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === CREATE SIGNAL (draft) ===
app.post('/api/admin/signals', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const errors = validateSignalInput(body);
    if (errors.length) {
      return res.status(400).json({ success: false, error: errors.join(', ') });
    }
    
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
    
    const { data, error } = await supabase
      .from('signals').insert(insertData).select().single();
    if (error) throw error;

    // Log event
    await supabase.from('signal_events').insert({
      signal_id: data.id,
      event_type: 'CREATED',
      note: 'Signal dibuat sebagai draft'
    });

    res.json({ success: true, signal: data });
  } catch (err) {
    console.error('[signals-create]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === UPDATE SIGNAL ===
app.patch('/api/admin/signals/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = req.body || {};
    
    // Cek signal exists
    const { data: existing } = await supabase
      .from('signals').select('*').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ success: false, error: 'Signal not found' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ success: false, error: 'Hanya signal DRAFT yang bisa diubah' });
    }
    
    const updateData = {};
    const allowed = ['ticker','timeframe','notes','image_url','entry_1','entry_2','entry_3',
                     'entry_1_pct','entry_2_pct','entry_3_pct','stop_loss','target_1','target_2','target_3'];
    allowed.forEach(k => {
      if (body[k] !== undefined) updateData[k] = body[k];
    });
    
    // Recompute avg & RR
    const merged = { ...existing, ...updateData };
    updateData.entry_avg = calcEntryAvg(merged);
    updateData.risk_reward = calcRR(merged);
    
    const { data, error } = await supabase
      .from('signals').update(updateData).eq('id', id).select().single();
    if (error) throw error;

    res.json({ success: true, signal: data });
  } catch (err) {
    console.error('[signals-update]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === PUBLISH SIGNAL ===
app.post('/api/admin/signals/:id/publish', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { data: existing } = await supabase
      .from('signals').select('*').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ success: false, error: 'Signal not found' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ success: false, error: 'Hanya DRAFT yang bisa publish' });
    }

    const { data, error } = await supabase
      .from('signals')
      .update({ status: 'PUBLISHED', published_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;

    await supabase.from('signal_events').insert({
      signal_id: id,
      event_type: 'PUBLISHED',
      note: 'Signal dipublikasikan'
    });

    // TODO: Kirim notif Telegram di sini

    res.json({ success: true, signal: data });
  } catch (err) {
    console.error('[signals-publish]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === DELETE SIGNAL (only draft) ===
app.delete('/api/admin/signals/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { data: existing } = await supabase
      .from('signals').select('*').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ success: false, error: 'Signal not found' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ success: false, error: 'Hanya DRAFT yang bisa dihapus' });
    }

    const { error } = await supabase.from('signals').delete().eq('id', id);
    if (error) throw error;

    res.json({ success: true, message: 'Signal deleted' });
  } catch (err) {
    console.error('[signals-delete]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === PUBLIC: LIST SIGNALS ===
app.get('/api/public/signals', async (req, res) => {
  try {
    const statusFilter = req.query.status;  // optional
    let query = supabase
      .from('signals')
      .select('*')
      .in('status', ['PUBLISHED', 'ACTIVE', 'CLOSED', 'EXPIRED'])
      .order('published_at', { ascending: false })
      .limit(100);
    
    if (statusFilter) query = query.eq('status', statusFilter);
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json({ success: true, signals: data || [] });
  } catch (err) {
    console.error('[signals-public]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================

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
      .select('trade_date,open,high,low,close,volume,non_regular_volume,non_regular_value,non_regular_frequency')
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

    // === NON-REGULAR / BLOCK TRADE DATA ===
    const nonRegular = rows
      .filter(r => Number(r.non_regular_volume) > 0)
      .map(r => ({
        time: r.trade_date,
        volume: Number(r.non_regular_volume) || 0,
        value: Number(r.non_regular_value) || 0,
        frequency: Number(r.non_regular_frequency) || 0
      }));

    res.json({
      success: true, code: stock.code, name: stock.name,
      range, startDate, endDate: latestDate, candles, volumes, nonRegular
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
      .from('stocks')
      .select('id,code,name')
      .eq('code', code)
      .maybeSingle();

    if (sErr) throw sErr;

    if (!stock) {
      return res.status(404).json({
        success: false,
        error: `Ticker ${code} tidak ditemukan di database.`
      });
    }

    const marketLatestDate = await getLatestTradeDate();

    if (!marketLatestDate) {
      return res.json({
        success: true,
        hasData: false,
        message: 'Belum ada data historis.'
      });
    }

    const startDate = rangeToStartDate('1y', marketLatestDate);

    const { data: rows, error: rErr } = await supabase
      .from('daily_stock_data')
      .select(
        'trade_date,close,previous_price,volume,value,bid,bid_volume,offer,offer_volume,foreign_buy,foreign_sell,high,low,non_regular_volume,non_regular_value'
      )
      .eq('stock_id', stock.id)
      .gte('trade_date', startDate)
      .lte('trade_date', marketLatestDate)
      .order('trade_date', { ascending: true });

    if (rErr) throw rErr;

    if (!rows.length) {
      return res.json({
        success: true,
        hasData: false,
        message: `Belum ada data historis untuk ${code}.`
      });
    }

    const last = rows[rows.length - 1];
    const prev = rows.length > 1
      ? rows[rows.length - 2]
      : last;

    /*
     * Freshness:
     * ticker harus benar-benar memiliki row pada marketLatestDate
     */
    const isCurrentSession =
      String(last.trade_date) === String(marketLatestDate);

    /*
     * 20 observasi terbaru milik ticker.
     * Ini tetap valid meskipun ticker tidak aktif pada sesi terbaru.
     */
    const trailing20 = rows.slice(-20);

    const netForeign20d = trailing20.reduce(
      (sum, r) =>
        sum +
        ((Number(r.foreign_buy) || 0) -
         (Number(r.foreign_sell) || 0)),
      0
    );

    const grossForeign20d = trailing20.reduce(
      (sum, r) =>
        sum +
        (Number(r.foreign_buy) || 0) +
        (Number(r.foreign_sell) || 0),
      0
    );

    /*
     * Bandar Score:
     * tetap formula lama.
     */
    const bandarScoreRaw =
      grossForeign20d > 0
        ? 50 + 50 * (netForeign20d / grossForeign20d)
        : 50;

    /*
     * 52-week range:
     * gunakan high/low aktual harian, bukan close.
     */
    const validHighs = rows
      .map(r => Number(r.high))
      .filter(Number.isFinite)
      .filter(v => v > 0);

    const validLows = rows
      .map(r => Number(r.low))
      .filter(Number.isFinite)
      .filter(v => v > 0);

    const low52 = validLows.length
      ? Math.min(...validLows)
      : null;

    const high52 = validHighs.length
      ? Math.max(...validHighs)
      : null;

    /*
     * Today's foreign data:
     * jika ticker tidak punya data pada sesi terbaru,
     * jangan klaim row terakhir sebagai "hari ini".
     */
    const foreignBuyToday = isCurrentSession
      ? (Number(last.foreign_buy) || 0)
      : null;

    const foreignSellToday = isCurrentSession
      ? (Number(last.foreign_sell) || 0)
      : null;

    const netForeignToday =
      isCurrentSession
        ? foreignBuyToday - foreignSellToday
        : null;

    /*
     * Change/price tetap berdasarkan row terakhir ticker.
     * Tambahkan metadata freshness agar frontend bisa membedakan
     * CURRENT dari STALE.
     */
    const lastClose = Number(last.close);
    const prevClose = Number(prev.close);

    const change =
      Number.isFinite(lastClose) && Number.isFinite(prevClose)
        ? lastClose - prevClose
        : null;

    const changePercent =
      Number.isFinite(change) && prevClose > 0
        ? Number(((change / prevClose) * 100).toFixed(2))
        : null;

    res.json({
      success: true,
      hasData: true,

      code: stock.code,
      name: stock.name,

      /*
       * Date milik ticker
       */
      date: last.trade_date,

      /*
       * Date pasar global terbaru
       */
      marketLatestDate,

      /*
       * Explicit freshness flag
       */
      isCurrentSession,

      dataStatus: isCurrentSession
        ? 'CURRENT'
        : 'STALE',

      close: Number.isFinite(lastClose)
        ? lastClose
        : null,

      change,
      changePercent,

      volume: Number(last.volume) || 0,
      value: Number(last.value) || 0,

      bid:
        last.bid != null
          ? Number(last.bid)
          : null,

      bidVolume:
        last.bid_volume != null
          ? Number(last.bid_volume)
          : null,

      offer:
        last.offer != null
          ? Number(last.offer)
          : null,

      offerVolume:
        last.offer_volume != null
          ? Number(last.offer_volume)
          : null,

      foreignBuyToday,
      foreignSellToday,
      netForeignToday,

      netForeign20d,
      foreignRatio20d: grossForeign20d > 0 ? netForeign20d / grossForeign20d : 0,
      avgValue20d: trailing20.reduce((s, r) => s + (Number(r.value) || 0), 0) / Math.max(1, trailing20.length),

      bandarScore:
        Math.max(
          0,
          Math.min(
            100,
            Math.round(bandarScoreRaw)
          )
        ),

      low52,
      high52,

      /*
       * Audit metadata
       */
      trailing20Rows: trailing20.length,
      rangeDays: rows.length,
      rangeStart: startDate,
      rangeEnd: marketLatestDate
    });

  } catch (e) {
    console.error('[Public Summary Error]', e);

    res.status(500).json({
      success: false,
      error: e.message
    });
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
// === STOCKFAMILY AUTH / ENTRY ROUTES ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/landing.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/register.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/forgot-password.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});


// ============================================================
// GEM Score Auto Refresh (setiap hari jam 18:30 WIB)
// ============================================================
const { computeAndCacheAllGemScores } = require('./services/gemScoreService');

function scheduleGemRefresh() {
  const run = async () => {
    try {
      console.log('[GEM Auto] Mulai refresh harian...');
      const result = await computeAndCacheAllGemScores();
      console.log(`[GEM Auto] Selesai. ${result.count} saham di-update @ ${result.updated_at}`);
    } catch (err) {
      console.error('[GEM Auto] Gagal:', err.message);
    }
  };

  // Cek setiap 1 menit apakah sudah jam 18:30 WIB
  setInterval(() => {
    const now = new Date();
    // WIB = UTC+7
    const wibHour = (now.getUTCHours() + 7) % 24;
    const wibMin = now.getUTCMinutes();
    if (wibHour === 18 && wibMin === 30) {
      run();
    }
  }, 60 * 1000);

  console.log('[GEM Auto] Scheduler aktif - refresh setiap hari jam 18:30 WIB');
}

if (require.main === module) {
  scheduleGemRefresh();
  app.listen(PORT, () => console.log(`[START] FIX V2.4 running http://localhost:${PORT}`));
}

module.exports = app;
