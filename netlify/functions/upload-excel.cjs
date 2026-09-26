// ============================================================
// Netlify Function: Upload Excel
// Path: /.netlify/functions/upload-excel
// Method: POST (multipart/form-data)
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const Busboy = require('busboy');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper: number conversion
const num = (v, def = 0) => {
  if (v == null || v === '') return def;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? def : n;
};

// Helper: parse multipart/form-data dari base64 body
function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    const bb = Busboy({ headers: { 'content-type': contentType } });
    const files = [];

    bb.on('file', (fieldname, file, info) => {
      const chunks = [];
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('end', () => {
        files.push({
          fieldname,
          filename: info.filename,
          mimeType: info.mimeType,
          buffer: Buffer.concat(chunks)
        });
      });
    });

    bb.on('close', () => resolve(files));
    bb.on('error', (err) => reject(err));

    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'binary');
    bb.end(body);
  });
}

// Helper: upload ke Supabase Storage
async function archiveToStorage(fileBuffer, filename) {
  try {
    const match = filename.match(/(\d{8})/);
    if (!match) return { saved: false, reason: 'No date in filename' };

    const yyyymmdd = match[1];
    const year = yyyymmdd.slice(0, 4);
    const month = yyyymmdd.slice(4, 6);
    const archivePath = `${year}-${month}/${filename}`;

    const { data, error } = await supabase.storage
      .from('excel-archive')
      .upload(archivePath, fileBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: true
      });

    if (error) return { saved: false, reason: error.message };
    return { saved: true, path: data.path };
  } catch (err) {
    return { saved: false, reason: err.message };
  }
}

// Main handler
exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  console.log('[UPLOAD-FN] Request received');

  try {
    // 1. Parse multipart
    const files = await parseMultipart(event);
    console.log(`[UPLOAD-FN] ${files.length} file(s) received`);

    if (!files.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'No files received' })
      };
    }

    // 2. Get stocks map
    const { data: stocks, error: sErr } = await supabase.from('stocks').select('id,code');
    if (sErr) throw sErr;
    const stockMap = {};
    stocks.forEach(s => stockMap[s.code.trim().toUpperCase()] = s.id);
    console.log(`[UPLOAD-FN] Stock map: ${Object.keys(stockMap).length} stocks`);

    const allResults = [];
    let totalInserted = 0;

    // 3. Process each file
    for (const file of files) {
      const filename = file.filename;
      console.log(`[UPLOAD-FN] Processing: ${filename}`);

      // Extract date
      const match = filename.match(/(\d{8})/);
      const tradeDate = match
        ? `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`
        : new Date().toISOString().slice(0, 10);
      console.log(`[UPLOAD-FN] Trade date: ${tradeDate}`);

      // 3a. Archive to Supabase Storage
      const archiveResult = await archiveToStorage(file.buffer, filename);
      if (archiveResult.saved) {
        console.log(`[UPLOAD-FN] ✅ Archived: ${archiveResult.path}`);
      } else {
        console.warn(`[UPLOAD-FN] ⚠️ Archive failed: ${archiveResult.reason}`);
      }

      // 3b. Parse Excel
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);
      console.log(`[UPLOAD-FN] Raw rows: ${rows.length}`);

      // 3c. Build insert payload
      const toInsert = [];
      for (const r of rows) {
        const code = (r['Kode Saham'] || r['code'] || '').toString().trim().toUpperCase();
        if (!code) continue;
        const sid = stockMap[code];
        if (!sid) continue;

        toInsert.push({
          stock_id: sid,
          trade_date: tradeDate,
          previous_price: num(r['Sebelumnya']),
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

      // 3d. Upsert in batches
      let inserted = 0;
      const BATCH = 500;
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const batch = toInsert.slice(i, i + BATCH);
        const { error } = await supabase
          .from('daily_stock_data')
          .upsert(batch, { onConflict: 'stock_id,trade_date' });

        if (error) {
          console.error(`[UPLOAD-FN] Batch ${i} failed:`, error.message);
          // Fallback: individual
          for (const row of batch) {
            const { error: rowErr } = await supabase
              .from('daily_stock_data')
              .upsert(row, { onConflict: 'stock_id,trade_date' });
            if (!rowErr) inserted++;
          }
        } else {
          inserted += batch.length;
        }
      }

      // 3e. Log to upload_batches (upsert)
      const { error: logErr } = await supabase.from('upload_batches').upsert(
        { filename, trade_date: tradeDate, row_count: inserted },
        { onConflict: 'trade_date' }
      );
      if (logErr) console.warn('[UPLOAD-FN] Log error:', logErr.message);

      allResults.push({
        filename,
        trade_date: tradeDate,
        raw: rows.length,
        inserted,
        archived: archiveResult.saved
      });
      totalInserted += inserted;
      console.log(`[UPLOAD-FN] ${filename} DONE: ${inserted}/${rows.length}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        files: allResults,
        totalStocks: totalInserted
      })
    };
  } catch (err) {
    console.error('[UPLOAD-FN] FATAL:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
