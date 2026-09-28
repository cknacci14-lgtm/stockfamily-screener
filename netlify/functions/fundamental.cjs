// ============================================================
// Netlify Function: Fundamental dari Supabase
// Path: /.netlify/functions/fundamental/:code
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 menit

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Extract code dari path atau query
    let code = '';
    if (event.queryStringParameters?.code) {
      code = event.queryStringParameters.code;
    } else if (event.path) {
      const parts = event.path.split('/').filter(Boolean);
      code = parts[parts.length - 1];
    }
    
    code = String(code || '').trim().toUpperCase();
    if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Code required' }) };

    // Cache check
    const cached = CACHE.get(code);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      console.log(`[fundamental] ${code} — CACHE HIT`);
      return { statusCode: 200, headers, body: JSON.stringify({ ...cached.data, cached: true }) };
    }

    console.log(`[fundamental] ${code} — query Supabase`);

    const { data: stock, error: sErr } = await supabase
      .from('stocks').select('id, code, name').eq('code', code).maybeSingle();
    if (sErr) throw sErr;
    if (!stock) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Stock not found' }) };

    const { data: rows, error: rErr } = await supabase
      .from('daily_stock_data')
      .select('trade_date, close, volume, value, listed_shares, tradeable_shares')
      .eq('stock_id', stock.id)
      .order('trade_date', { ascending: false })
      .limit(1);
    if (rErr) throw rErr;
    if (!rows || !rows.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'No data' }) };

    const row = rows[0];
    const close = Number(row.close) || 0;
    const listed = Number(row.listed_shares) || 0;
    const tradeable = Number(row.tradeable_shares) || 0;
    const volume = Number(row.volume) || 0;
    const value = Number(row.value) || 0;

    const result = {
      success: true,
      code: stock.code,
      name: stock.name,
      trade_date: row.trade_date,
      close: close,
      volume: volume,
      value: value,
      listed_shares: listed,
      tradeable_shares: tradeable,
      market_cap: close * listed,
      free_float_pct: listed > 0 ? (tradeable / listed) * 100 : 0,
      turnover_pct: listed > 0 ? (volume / listed) * 100 : 0,
      avg_price: volume > 0 ? value / volume : close,
      source: 'IDX EOD',
      cached: false
    };

    CACHE.set(code, { data: result, ts: Date.now() });
    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    console.error('[fundamental] FATAL:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
