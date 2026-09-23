require('dotenv').config();

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

console.log(`[HistoricalDB] Mode: ${USE_SUPABASE ? 'Supabase/Postgres' : 'Local JSON'}`);

const LOCAL_DB = path.join(__dirname, '../../../data/historical-db.json');

function normalizeDate(date) {
  if (!date) return null;
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  return String(date).slice(0, 10);
}

function numOrNull(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ============================================================
// SUPABASE — READ
// ============================================================
async function supabaseFetch(table, query = '') {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}${query}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text}`);
  }

  return response.json();
}

async function supabaseFetchAll(table, select = '*', extraQuery = '') {
  const PAGE_SIZE = 1000;
  let offset = 0;
  const allRows = [];

  while (true) {
    const query =
      `?select=${encodeURIComponent(select)}` +
      `${extraQuery ? '&' + extraQuery : ''}` +
      `&limit=${PAGE_SIZE}&offset=${offset}`;

    const rows = await supabaseFetch(table, query);

    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
  }

  return allRows;
}

// ============================================================
// SUPABASE — WRITE (insert/delete, dipakai ingestSnapshot)
// ============================================================
async function supabaseWrite(table, method, body, query = '', extraHeaders = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...extraHeaders
    },
    body: body != null ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${method} ${table} ${response.status}: ${text}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// ============================================================
// STOCK MASTER
// ============================================================
async function getStockMap() {
  if (USE_SUPABASE) {
    const stocks = await supabaseFetchAll('stocks', 'id,code,name,remarks', 'order=id.asc');
    const map = new Map();
    for (const stock of stocks) map.set(Number(stock.id), stock);
    return map;
  }

  const db = loadLocal();
  const map = new Map();
  for (const stock of db.stocks || []) map.set(Number(stock.id), stock);
  return map;
}

async function getStockByCode(code) {
  const target = String(code || '').trim().toUpperCase();
  if (!target) return null;

  if (USE_SUPABASE) {
    const rows = await supabaseFetch(
      'stocks',
      `?select=id,code,name,remarks&code=eq.${encodeURIComponent(target)}&limit=1`
    );
    return rows[0] || null;
  }

  const db = loadLocal();
  return (db.stocks || []).find(s => String(s.code).toUpperCase() === target) || null;
}

async function searchStocks(query, limit = 15) {
  const q = String(query || '').trim();
  if (!q) return [];

  if (USE_SUPABASE) {
    const safeQ = q.replace(/[(),*]/g, '');
    if (!safeQ) return [];

    const orClause = `code.ilike.*${safeQ}*,name.ilike.*${safeQ}*`;

    const rows = await supabaseFetch(
      'stocks',
      `?select=id,code,name&or=(${encodeURIComponent(orClause)})&order=code.asc&limit=${limit}`
    );
    return rows;
  }

  const db = loadLocal();
  const lower = q.toLowerCase();

  return (db.stocks || [])
    .filter(s => String(s.code).toLowerCase().includes(lower) || String(s.name).toLowerCase().includes(lower))
    .slice(0, limit);
}

// Upsert stocks tanpa bergantung pada unique constraint di kolom code
// (ambil yang sudah ada dulu, baru insert yang belum ada)
async function upsertStocks(rows) {
  const uniqueMap = new Map();
  for (const r of rows) {
    const code = String(r.code || '').trim().toUpperCase();
    if (!code) continue;
    if (!uniqueMap.has(code)) {
      uniqueMap.set(code, { code, name: r.name || '', remarks: r.remarks || '' });
    }
  }

  const codes = [...uniqueMap.keys()];
  if (codes.length === 0) return new Map();

  if (!USE_SUPABASE) {
    const db = loadLocal();
    db.stocks = db.stocks || [];
    let nextId = db.stocks.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0) + 1;
    const map = new Map(db.stocks.map(s => [String(s.code).toUpperCase(), s]));

    for (const code of codes) {
      if (!map.has(code)) {
        const stock = { id: nextId++, ...uniqueMap.get(code) };
        db.stocks.push(stock);
        map.set(code, stock);
      }
    }

    fs.writeFileSync(LOCAL_DB, JSON.stringify(db, null, 2));
    return map;
  }

  // 1) Ambil stock yang sudah ada (pakai filter IN, bukan or=() panjang)
  const existing = await supabaseFetch(
    'stocks',
    `?select=id,code,name,remarks&code=in.(${codes.join(',')})`
  );
  const existingMap = new Map(existing.map(s => [String(s.code).toUpperCase(), s]));

  // 2) Insert yang belum ada
  const toInsert = codes.filter(c => !existingMap.has(c)).map(c => uniqueMap.get(c));
  let inserted = [];
  if (toInsert.length > 0) {
    inserted = await supabaseWrite('stocks', 'POST', toInsert, '', { Prefer: 'return=representation' });
  }

  const map = new Map(existingMap);
  for (const stock of inserted) {
    map.set(String(stock.code).toUpperCase(), stock);
  }
  return map;
}

// ============================================================
// INGEST SNAPSHOT (upload Excel harian — replace semantics)
// ============================================================
async function ingestSnapshot({ date, filename, rows }) {
  const targetDate = normalizeDate(date);
  if (!targetDate) throw new Error('Tanggal snapshot tidak valid');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Tidak ada baris data untuk di-ingest');

  if (!USE_SUPABASE) {
    const db = loadLocal();
    db.stocks = db.stocks || [];
    db.daily_stock_data = db.daily_stock_data || [];
    db.upload_batches = db.upload_batches || [];

    const stockMap = await upsertStocks(rows);

    db.daily_stock_data = db.daily_stock_data.filter(
      r => normalizeDate(r.trade_date || r.date) !== targetDate
    );

    let count = 0;
    for (const r of rows) {
      const code = String(r.code || '').trim().toUpperCase();
      const stock = stockMap.get(code);
      if (!stock) continue;
      db.daily_stock_data.push({ ...r, stock_id: stock.id, trade_date: targetDate });
      count++;
    }

    db.upload_batches.push({
      id: db.upload_batches.length + 1,
      filename: filename || null,
      trade_date: targetDate,
      row_count: count,
      uploaded_at: new Date().toISOString()
    });

    fs.writeFileSync(LOCAL_DB, JSON.stringify(db, null, 2));
    return { rows: count };
  }

  // 1) Upsert master data saham
  const stockMap = await upsertStocks(rows);

  // 2) Hapus data lama untuk tanggal ini (replace, bukan duplikat)
  await supabaseWrite('daily_stock_data', 'DELETE', null, `?trade_date=eq.${targetDate}`, { Prefer: 'return=minimal' });

  // 3) Susun baris baru
  const dailyRows = rows.map(r => {
    const code = String(r.code || '').trim().toUpperCase();
    const stock = stockMap.get(code);
    if (!stock) return null;
    return {
      stock_id: stock.id,
      trade_date: targetDate,
      previous_price: numOrNull(r.previous_price),
      open: numOrNull(r.open),
      first_trade: numOrNull(r.first_trade),
      high: numOrNull(r.high),
      low: numOrNull(r.low),
      close: numOrNull(r.close),
      change_price: numOrNull(r.change_price),
      volume: numOrNull(r.volume),
      value: numOrNull(r.value),
      frequency: numOrNull(r.frequency),
      index_individual: numOrNull(r.index_individual),
      offer: numOrNull(r.offer),
      offer_volume: numOrNull(r.offer_volume),
      bid: numOrNull(r.bid),
      bid_volume: numOrNull(r.bid_volume),
      listed_shares: numOrNull(r.listed_shares),
      tradeable_shares: numOrNull(r.tradeable_shares),
      weight_for_index: numOrNull(r.weight_for_index),
      foreign_sell: numOrNull(r.foreign_sell),
      foreign_buy: numOrNull(r.foreign_buy),
      non_regular_volume: numOrNull(r.non_regular_volume),
      non_regular_value: numOrNull(r.non_regular_value),
      non_regular_frequency: numOrNull(r.non_regular_frequency)
    };
  }).filter(Boolean);

  // 4) Insert per-batch (500 baris) biar aman dari limit payload
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < dailyRows.length; i += BATCH) {
    const chunk = dailyRows.slice(i, i + BATCH);
    await supabaseWrite('daily_stock_data', 'POST', chunk, '', { Prefer: 'return=minimal' });
    inserted += chunk.length;
  }

  // 5) Catat log upload
  await supabaseWrite('upload_batches', 'POST', [{
    filename: filename || null,
    trade_date: targetDate,
    row_count: inserted,
    uploaded_at: new Date().toISOString()
  }], '', { Prefer: 'return=minimal' });

  return { rows: inserted };
}

// ============================================================
// UPLOAD LOG (riwayat upload, dari tabel upload_batches)
// ============================================================
async function getUploadLog(limit = 100) {
  if (USE_SUPABASE) {
    const rows = await supabaseFetchAll(
      'upload_batches',
      'id,filename,trade_date,row_count,uploaded_at',
      'order=uploaded_at.desc'
    );
    return rows.slice(0, limit).map(r => ({ ...r, trade_date: normalizeDate(r.trade_date) }));
  }

  const db = loadLocal();
  return (db.upload_batches || [])
    .slice()
    .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
    .slice(0, limit);
}

// ============================================================
// LOCAL
// ============================================================
function loadLocal() {
  if (!fs.existsSync(LOCAL_DB)) {
    return { stocks: [], daily_stock_data: [], upload_batches: [] };
  }
  return JSON.parse(fs.readFileSync(LOCAL_DB, 'utf8'));
}

// ============================================================
// ENRICH DAILY ROW
// ============================================================
function enrichRow(row, stockMap) {
  const stock = stockMap.get(Number(row.stock_id));
  return {
    ...row,
    date: normalizeDate(row.trade_date || row.date),
    code: stock?.code || row.code || row.stock_code || '',
    name: stock?.name || row.name || '',
    remarks: stock?.remarks || row.remarks || '',
    stock_code: stock?.code || row.code || row.stock_code || ''
  };
}

// ============================================================
// GET DATES
// ============================================================
async function getDates() {
  if (USE_SUPABASE) {
    const rows = await supabaseFetchAll('daily_stock_data', 'trade_date', 'order=trade_date.asc');
    return [...new Set(rows.map(r => normalizeDate(r.trade_date)).filter(Boolean))];
  }

  const db = loadLocal();
  return [...new Set(
    (db.daily_stock_data || []).map(r => normalizeDate(r.trade_date || r.date)).filter(Boolean)
  )].sort();
}

// ============================================================
// GET LATEST DATE
// ============================================================
async function getLatestDate() {
  if (USE_SUPABASE) {
    const rows = await supabaseFetch('daily_stock_data', '?select=trade_date&order=trade_date.desc&limit=1');
    return rows[0]?.trade_date ? normalizeDate(rows[0].trade_date) : null;
  }

  const dates = await getDates();
  return dates.length ? dates[dates.length - 1] : null;
}

// ============================================================
// GET SNAPSHOT
// ============================================================
async function getSnapshot(date) {
  const targetDate = normalizeDate(date);

  const select = `
    id, stock_id, trade_date, previous_price, open, first_trade, high, low, close,
    change_price, volume, value, frequency, index_individual, offer, offer_volume,
    bid, bid_volume, listed_shares, tradeable_shares, weight_for_index,
    foreign_sell, foreign_buy, non_regular_volume, non_regular_value, non_regular_frequency
  `;

  if (USE_SUPABASE) {
    const [rows, stockMap] = await Promise.all([
      supabaseFetchAll('daily_stock_data', select, `trade_date=eq.${targetDate}`),
      getStockMap()
    ]);

    return rows
      .map(row => enrichRow(row, stockMap))
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }

  const db = loadLocal();
  const stockMap = new Map();
  for (const stock of db.stocks || []) stockMap.set(Number(stock.id), stock);

  return (db.daily_stock_data || [])
    .filter(row => normalizeDate(row.trade_date || row.date) === targetDate)
    .map(row => enrichRow(row, stockMap))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

// ============================================================
// GET ALL HISTORY (semua saham, dipakai getPeriodSummary & fitur lain)
// ============================================================
async function getAllHistory(startDate = null, endDate = null) {
  const start = startDate ? normalizeDate(startDate) : null;
  const end = endDate ? normalizeDate(endDate) : null;

  const select = `
    id, stock_id, trade_date, previous_price, open, first_trade, high, low, close,
    change_price, volume, value, frequency, index_individual, offer, offer_volume,
    bid, bid_volume, listed_shares, tradeable_shares, weight_for_index,
    foreign_sell, foreign_buy, non_regular_volume, non_regular_value, non_regular_frequency
  `;

  if (USE_SUPABASE) {
    let extraQuery = 'order=trade_date.asc';
    if (start && end) extraQuery += `&trade_date=gte.${start}&trade_date=lte.${end}`;
    else if (start) extraQuery += `&trade_date=gte.${start}`;
    else if (end) extraQuery += `&trade_date=lte.${end}`;

    const [rows, stockMap] = await Promise.all([
      supabaseFetchAll('daily_stock_data', select, extraQuery),
      getStockMap()
    ]);

    return rows.map(row => enrichRow(row, stockMap));
  }

  const db = loadLocal();
  const stockMap = new Map();
  for (const stock of db.stocks || []) stockMap.set(Number(stock.id), stock);

  return (db.daily_stock_data || [])
    .filter(row => {
      const date = normalizeDate(row.trade_date || row.date);
      if (start && date < start) return false;
      if (end && date > end) return false;
      return true;
    })
    .map(row => enrichRow(row, stockMap));
}

// ============================================================
// GET PERIOD SUMMARY (agregat per-saham untuk rentang tanggal)
// ============================================================
async function getPeriodSummary(startDate, endDate) {
  const rows = await getAllHistory(startDate, endDate);

  const grouped = new Map();
  for (const r of rows) {
    const code = String(r.code || '').trim().toUpperCase();
    if (!code) continue;
    if (!grouped.has(code)) grouped.set(code, { code, name: r.name || '', rows: [] });
    grouped.get(code).rows.push(r);
  }

  const summary = [];
  for (const [code, group] of grouped) {
    const sorted = group.rows.sort((a, b) =>
      String(a.trade_date || a.date).localeCompare(String(b.trade_date || b.date))
    );
    const last = sorted[sorted.length - 1];
    const volume = sorted.reduce((s, r) => s + (Number(r.volume) || 0), 0);
    const value = sorted.reduce((s, r) => s + (Number(r.value) || 0), 0);

    summary.push({
      code,
      name: group.name,
      latest_close: Number(last.close) || 0,
      volume,
      value,
      date: normalizeDate(last.trade_date || last.date)
    });
  }

  return summary.sort((a, b) => a.code.localeCompare(b.code));
}

// ============================================================
// GET HISTORY BY CODE (satu saham — dipakai chart real-time)
// ============================================================
async function getHistoryByCode(code, startDate = null, endDate = null) {
  const stock = await getStockByCode(code);
  if (!stock) return { stock: null, rows: [] };

  const start = startDate ? normalizeDate(startDate) : null;
  const end = endDate ? normalizeDate(endDate) : null;

  const select = 'trade_date,previous_price,open,first_trade,high,low,close,' +
    'change_price,volume,value,frequency,offer,offer_volume,bid,bid_volume,' +
    'foreign_sell,foreign_buy';

  if (USE_SUPABASE) {
    let extraQuery = `stock_id=eq.${stock.id}&order=trade_date.asc`;
    if (start) extraQuery += `&trade_date=gte.${start}`;
    if (end) extraQuery += `&trade_date=lte.${end}`;

    const rows = await supabaseFetchAll('daily_stock_data', select, extraQuery);
    return { stock, rows: rows.map(r => ({ ...r, trade_date: normalizeDate(r.trade_date) })) };
  }

  const db = loadLocal();
  const rows = (db.daily_stock_data || [])
    .filter(r => Number(r.stock_id) === Number(stock.id))
    .filter(r => {
      const d = normalizeDate(r.trade_date || r.date);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    })
    .map(r => ({ ...r, trade_date: normalizeDate(r.trade_date || r.date) }))
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

  return { stock, rows };
}

// ============================================================
// GET WATCHLIST SNAPSHOT
// ============================================================
async function getWatchlistSnapshot(codes = []) {
  const date = await getLatestDate();
  if (!date) return { date: null, stocks: [] };

  const snapshot = await getSnapshot(date);
  const wanted = codes.map(c => String(c).trim().toUpperCase()).filter(Boolean);

  const filtered = wanted.length
    ? snapshot.filter(row => wanted.includes(String(row.code).toUpperCase()))
    : snapshot;

  return { date, stocks: filtered };
}

module.exports = {
  useSupabase: USE_SUPABASE,
  normalizeDate,
  getDates,
  getLatestDate,
  getSnapshot,
  getAllHistory,
  getStockByCode,
  getHistoryByCode,
  getWatchlistSnapshot,
  searchStocks,
  ingestSnapshot,
  getPeriodSummary,
  getUploadLog
};