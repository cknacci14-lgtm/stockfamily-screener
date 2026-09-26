require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: folders } = await supabase.storage.from('excel-archive').list('', { limit: 100 });
  console.log('Folder di excel-archive:');
  for (const f of folders) {
    console.log(`  📁 ${f.name}`);
    const { data: files } = await supabase.storage.from('excel-archive').list(f.name, { limit: 100 });
    if (files) files.forEach(file => {
      console.log(`      📄 ${file.name} | ${file.metadata?.size ? (file.metadata.size/1024).toFixed(1)+' KB' : 'N/A'}`);
    });
  }
}
check();
