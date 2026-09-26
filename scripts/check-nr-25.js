require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: rows } = await supabase
    .from('daily_stock_data')
    .select('non_regular_volume')
    .eq('trade_date', '2026-09-25');
  
  let hasNR = 0, zeroNR = 0;
  rows.forEach(r => {
    if (Number(r.non_regular_volume) > 0) hasNR++;
    else zeroNR++;
  });
  
  console.log(`Total rows 25 Sep: ${rows.length}`);
  console.log(`  ✅ Ada NR (>0): ${hasNR}`);
  console.log(`  ⚪ NR = 0     : ${zeroNR}`);
  console.log('');
  if (hasNR > 100) {
    console.log('✅ NR 25 Sep BAIK — Kemungkinan upload via endpoint baru (sudah fix)');
  } else if (hasNR > 0) {
    console.log('⚠️ NR 25 Sep parsial');
  } else {
    console.log('❌ NR 25 Sep = 0 — Production masih pakai endpoint LAMA (bug)');
  }
}
check();
