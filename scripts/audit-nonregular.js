// audit-nonregular.js - Cek data Non-Regular di Supabase
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL atau SUPABASE_KEY tidak ada di .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  console.log('=== AUDIT DATA NON-REGULAR ===\n');
  
  // 1. Cek tanggal terakhir upload
  const { data: batches, error: bErr } = await supabase
    .from('upload_batches')
    .select('*')
    .order('trade_date', { ascending: false })
    .limit(10);
  
  if (bErr) {
    console.error('Error query upload_batches:', bErr.message);
  } else {
    console.log('📅 10 Upload Terakhir:');
    console.log('─'.repeat(70));
    batches.forEach(b => {
      console.log(`  ${b.trade_date} | ${b.filename} | ${b.row_count} rows`);
    });
    console.log('');
  }
  
  // 2. Cek data non-regular per tanggal (10 hari terakhir)
  console.log('📊 Data Non-Regular (10 hari terakhir):');
  console.log('─'.repeat(70));
  
  const { data: latest, error: lErr } = await supabase
    .from('daily_stock_data')
    .select('trade_date')
    .not('non_regular_volume', 'is', null)
    .order('trade_date', { ascending: false })
    .limit(1);
  
  if (lErr) {
    console.error('Error:', lErr.message);
  } else if (latest && latest.length) {
    console.log(`  Tanggal terakhir dengan non_regular_volume: ${latest[0].trade_date}`);
  } else {
    console.log('  ⚠️ TIDAK ADA data non_regular_volume di database!');
  }
  
  // 3. Cek per tanggal terakhir untuk melihat keberadaan data
  const { data: recentDates, error: rErr } = await supabase
    .from('daily_stock_data')
    .select('trade_date, non_regular_volume, non_regular_value')
    .gte('trade_date', '2026-09-01')
    .order('trade_date', { ascending: false })
    .limit(1000);
  
  if (rErr) {
    console.error('Error:', rErr.message);
  } else if (recentDates && recentDates.length) {
    // Group by date
    const byDate = {};
    recentDates.forEach(r => {
      if (!byDate[r.trade_date]) byDate[r.trade_date] = { total: 0, hasNR: 0 };
      byDate[r.trade_date].total++;
      if (r.non_regular_volume && Number(r.non_regular_volume) > 0) {
        byDate[r.trade_date].hasNR++;
      }
    });
    
    console.log('\n📋 Ringkasan per Tanggal (Sep 2026):');
    console.log('─'.repeat(70));
    console.log('  Tanggal       | Total | Ada NR | % Coverage');
    console.log('─'.repeat(70));
    
    Object.keys(byDate).sort().reverse().forEach(date => {
      const d = byDate[date];
      const pct = ((d.hasNR / d.total) * 100).toFixed(1);
      const flag = pct > 50 ? '✓' : pct > 0 ? '⚠' : '✗';
      console.log(`  ${date}  | ${String(d.total).padStart(5)} | ${String(d.hasNR).padStart(6)} | ${pct}% ${flag}`);
    });
  }
  
  // 4. Cek khusus BBCA untuk melihat gap
  console.log('\n🔍 Detail BBCA (Sep 2026):');
  console.log('─'.repeat(70));
  
  const { data: stockData } = await supabase
    .from('stocks')
    .select('id, code')
    .eq('code', 'BBCA')
    .single();
  
  if (stockData) {
    const { data: bbcaData } = await supabase
      .from('daily_stock_data')
      .select('trade_date, close, volume, non_regular_volume, non_regular_value')
      .eq('stock_id', stockData.id)
      .gte('trade_date', '2026-09-01')
      .order('trade_date', { ascending: false });
    
    console.log('  Tanggal    | Close  | Non-Reg Vol | Status');
    console.log('─'.repeat(70));
    bbcaData.forEach(r => {
      const nr = Number(r.non_regular_volume) || 0;
      const status = nr > 0 ? '✓ Ada' : '✗ Kosong';
      console.log(`  ${r.trade_date} | ${String(r.close).padStart(6)} | ${String(nr).padStart(11)} | ${status}`);
    });
  }
  
  console.log('\n=== SELESAI ===');
}

audit().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
