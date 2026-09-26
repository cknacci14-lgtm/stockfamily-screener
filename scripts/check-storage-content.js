require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('=== FILES DI BUCKET excel-archive ===\n');
  
  const { data: folders, error } = await supabase.storage
    .from('excel-archive')
    .list('', { limit: 100 });
  
  if (error) { console.error('Error:', error.message); return; }
  
  console.log('Folder di root:');
  for (const f of folders) {
    console.log(`  📁 ${f.name}`);
    
    // List files di dalam folder
    const { data: files } = await supabase.storage
      .from('excel-archive')
      .list(f.name, { limit: 100 });
    
    if (files && files.length) {
      files.forEach(file => {
        const size = file.metadata?.size 
          ? (file.metadata.size / 1024).toFixed(1) + ' KB' 
          : 'N/A';
        console.log(`      📄 ${file.name} (${size})`);
      });
    }
  }
}
check();
