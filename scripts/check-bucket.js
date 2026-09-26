require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) { console.error('Error:', error.message); return; }
  console.log('=== BUCKET LIST ===');
  data.forEach(b => {
    console.log(`  ${b.name} | Public: ${b.public} | Created: ${b.created_at}`);
  });
  
  const hasExcel = data.some(b => b.name === 'excel-archive');
  console.log('');
  if (hasExcel) {
    console.log('✅ Bucket "excel-archive" sudah ada!');
  } else {
    console.log('❌ Bucket "excel-archive" BELUM ada. Buat dulu di dashboard Supabase.');
  }
}
check();
