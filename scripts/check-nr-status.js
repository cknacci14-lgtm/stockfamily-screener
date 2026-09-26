require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  // Cek NR untuk 24 Sep
  const { data: rows } = await supabase
    .from('daily_stock_data')
    .select('non_regular_volume, non_regular_value')
    .eq('trade_date', '2026-09-24');
  
  let hasNR = 0, zeroNR = 0;
  rows.forEach(r => {
    if (Number(r.non_regular_volume) > 0) hasNR++;
    else zeroNR++;
  });
  
  console.log(`Total rows 24 Sep: ${rows.length}`);
  console.log(`  ✅ Ada NR (>0): ${hasNR}`);
  console.log(`  ⚪ NR = 0     : ${zeroNR}`);
  
  // Cek 23 Sep juga
  const { data: rows23 } = await supabase
    .from('daily_stock_data')
    .select('non_regular_volume')
    .eq('trade_date', '2026-09-23');
  
  let hasNR23 = 0;
  rows23.forEach(r => { if (Number(r.non_regular_volume) > 0) hasNR23++; });
  console.log(`Total rows 23 Sep: ${rows23.length} | Ada NR: ${hasNR23}`);
}
check();
