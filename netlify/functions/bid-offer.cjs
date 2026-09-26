// ============================================================
// Netlify Function: Bid/Offer dari Supabase
// Path: /.netlify/functions/bid-offer?code=BBCA
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// In-memory cache (survives antar invocation di instance sama)
const CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 menit

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60'  // Browser cache 60s
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const code = (event.queryStringParameters?.code || '').trim().toUpperCase();
    
    if (!code) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Code required' }) };
    }

    // === CEK CACHE ===
    const cached = CACHE.get(code);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      console.log(`[bid-offer] ${code} — CACHE HIT`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ...cached.data, cached: true })
      };
    }

    console.log(`[bid-offer] ${code} — CACHE MISS, query Supabase`);

    // === QUERY SUPABASE ===
    const { data: stock, error: sErr } = await supabase
      .from('stocks')
      .select('id, code, name')
      .eq('code', code)
      .maybeSingle();

    if (sErr) throw sErr;
    if (!stock) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Stock not found' }) };
    }

    const { data: rows, error: rErr } = await supabase
      .from('daily_stock_data')
      .select('trade_date, bid, bid_volume, offer, offer_volume, close, previous_price, change_price')
      .eq('stock_id', stock.id)
      .order('trade_date', { ascending: false })
      .limit(1);

    if (rErr) throw rErr;
    if (!rows || !rows.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No data for ' + code }) };
    }

    const row = rows[0];
    const bidVol = Number(row.bid_volume) || 0;
    const offerVol = Number(row.offer_volume) || 0;
    const totalVol = bidVol + offerVol;
    const ratio = offerVol > 0 ? bidVol / offerVol : (bidVol > 0 ? 999 : 0);

    // Deteksi tekanan
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

    // Simpan ke cache
    CACHE.set(code, { data: result, ts: Date.now() });

    // Cleanup cache kalau terlalu besar
    if (CACHE.size > 500) {
      const now = Date.now();
      for (const [k, v] of CACHE.entries()) {
        if (now - v.ts > CACHE_TTL) CACHE.delete(k);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    console.error('[bid-offer] FATAL:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
