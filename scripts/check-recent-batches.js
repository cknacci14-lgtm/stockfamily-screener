require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: batches } = await supabase
    .from('upload_batches')
    .select('*')
    .order('uploaded_at', { ascending: false })
    .limit(5);
  
  console.log('5 Upload terakhir:');
  batches.forEach(b => {
    console.log(`  ${b.trade_date} | ${b.filename} | ${b.row_count} rows | ${b.uploaded_at}`);
  });
}
check();
