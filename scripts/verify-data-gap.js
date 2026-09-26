require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const START = '2026-09-01';
const END   = '2026-09-30';

async function countRowsByDate(date) {
  const { count, error } = await supabase
    .from('daily_stock_data')
    .select('stock_id', { count: 'exact', head: true })
    .eq('trade_date', date);

  if (error) throw error;

  return count || 0;
}

async function getUploadBatches() {
  const { data, error } = await supabase
    .from('upload_batches')
    .select('trade_date,filename,row_count')
    .gte('trade_date', START)
    .lte('trade_date', END)
    .order('trade_date');

  if (error) throw error;

  return data || [];
}

async function auditOHLC(date) {
  const { data, error } = await supabase
    .from('daily_stock_data')
    .select('open,high,low,close')
    .eq('trade_date', date);

  if (error) throw error;

  let valid = 0;
  let invalid = 0;
  let openZero = 0;
  let highZero = 0;
  let lowZero = 0;
  let closeZero = 0;

  for (const r of data || []) {
    const open = Number(r.open);
    const high = Number(r.high);
    const low = Number(r.low);
    const close = Number(r.close);

    if (open === 0) openZero++;
    if (high === 0) highZero++;
    if (low === 0) lowZero++;
    if (close === 0) closeZero++;

    const ok =
      Number.isFinite(open) &&
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      Number.isFinite(close) &&
      open > 0 &&
      high > 0 &&
      low > 0 &&
      close > 0;

    if (ok) valid++;
    else invalid++;
  }

  return {
    rows: data?.length || 0,
    valid,
    invalid,
    openZero,
    highZero,
    lowZero,
    closeZero
  };
}

async function main() {
  console.log('');
  console.log('============================================================');
  console.log('CHARTNALIST — DATA GAP VERIFICATION v2');
  console.log('Server-side row count + OHLC quality audit');
  console.log('============================================================');
  console.log('');

  // ----------------------------------------------------------
  // 1. ACTUAL DATABASE ROW COUNT
  // ----------------------------------------------------------

  console.log('📊 ACTUAL DAILY_STOCK_DATA');
  console.log('');

  const dates = [];

  const start = new Date(`${START}T00:00:00Z`);
  const end   = new Date(`${END}T00:00:00Z`);

  for (
    let d = new Date(start);
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const counts = {};

  for (const date of dates) {
    const count = await countRowsByDate(date);

    if (count > 0) {
      counts[date] = count;

      const status =
        count >= 900 ? '✓' :
        count > 0 ? '⚠️' :
        '✗';

      console.log(
        `  ${date} | ${String(count).padStart(4)} rows | ${status}`
      );
    }
  }

  // ----------------------------------------------------------
  // 2. UPLOAD BATCH VS ACTUAL DATABASE
  // ----------------------------------------------------------

  console.log('');
  console.log('📦 UPLOAD BATCH VS ACTUAL TABLE');
  console.log('');

  const batches = await getUploadBatches();

  for (const b of batches) {
    const actual = counts[b.trade_date] || 0;

    const mismatch =
      actual !== Number(b.row_count)
        ? ' ⚠️ MISMATCH'
        : ' ✓';

    console.log(
      `  ${b.trade_date} | ` +
      `${String(b.row_count).padStart(4)} batch | ` +
      `${String(actual).padStart(4)} table${mismatch}`
    );
  }

  // ----------------------------------------------------------
  // 3. OHLC QUALITY — 24 SEP
  // ----------------------------------------------------------

  console.log('');
  console.log('🔍 OHLC QUALITY — 2026-09-24');
  console.log('');

  const quality = await auditOHLC('2026-09-24');

  console.log(`  Total rows : ${quality.rows}`);
  console.log(`  Valid OHLC : ${quality.valid}`);
  console.log(`  Invalid    : ${quality.invalid}`);
  console.log('');
  console.log(`  Open  = 0 : ${quality.openZero}`);
  console.log(`  High  = 0 : ${quality.highZero}`);
  console.log(`  Low   = 0 : ${quality.lowZero}`);
  console.log(`  Close = 0 : ${quality.closeZero}`);

  console.log('');
  console.log('============================================================');
  console.log('AUDIT SELESAI');
  console.log('============================================================');
}

main().catch(err => {
  console.error('');
  console.error('❌ AUDIT ERROR');
  console.error(err);
  process.exit(1);
});
