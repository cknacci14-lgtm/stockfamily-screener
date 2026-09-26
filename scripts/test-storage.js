require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testUpload() {
  console.log('');
  console.log('===========================================');
  console.log('TEST UPLOAD KE SUPABASE STORAGE');
  console.log('===========================================');
  console.log('');
  
  // Cari file Excel pertama di folder data
  const dataDir = './data';
  const files = fs.readdirSync(dataDir)
    .filter(f => f.startsWith('Ringkasan Saham-') && f.endsWith('.xlsx'))
    .sort()
    .reverse();
  
  if (!files.length) {
    console.error('❌ Tidak ada file Excel di folder data/');
    return;
  }
  
  const testFile = files[0];
  const filePath = path.join(dataDir, testFile);
  const fileBuffer = fs.readFileSync(filePath);
  
  console.log(`📁 File: ${testFile}`);
  console.log(`📊 Size: ${(fileBuffer.length / 1024).toFixed(1)} KB`);
  console.log('');
  
  // Extract tanggal
  const match = testFile.match(/(\d{8})/);
  const tradeDate = `${match[1].slice(0,4)}-${match[1].slice(4,6)}-${match[1].slice(6,8)}`;
  const archivePath = `${tradeDate.slice(0, 7)}/${testFile}`;
  
  console.log(`📅 Trade Date: ${tradeDate}`);
  console.log(`📂 Archive Path: ${archivePath}`);
  console.log('');
  console.log('⏳ Uploading...');
  
  // Upload
  const { data, error } = await supabase.storage
    .from('excel-archive')
    .upload(archivePath, fileBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true
    });
  
  if (error) {
    console.log('');
    console.error('❌ Upload FAILED');
    console.error('   Message:', error.message);
    console.error('   Status:', error.statusCode || 'N/A');
    console.error('   Details:', JSON.stringify(error, null, 2));
    return;
  }
  
  console.log('');
  console.log('✅ Upload SUCCESS!');
  console.log(`   Path: ${data.path}`);
  console.log(`   ID: ${data.id}`);
  console.log('');
  
  // Verify: list files di bucket
  const { data: list, error: listErr } = await supabase.storage
    .from('excel-archive')
    .list(tradeDate.slice(0, 7));
  
  if (listErr) {
    console.error('❌ List error:', listErr.message);
    return;
  }
  
  console.log(`📋 Files di bucket (folder ${tradeDate.slice(0, 7)}):`);
  list.forEach(f => {
    const size = f.metadata?.size ? (f.metadata.size / 1024).toFixed(1) + ' KB' : 'N/A';
    console.log(`   - ${f.name} (${size})`);
  });
  console.log('');
  
  // Cleanup: hapus file test
  console.log('🧹 Cleanup: Menghapus file test...');
  const { error: delErr } = await supabase.storage
    .from('excel-archive')
    .remove([archivePath]);
  
  if (delErr) {
    console.warn('⚠️ Cleanup gagal:', delErr.message);
  } else {
    console.log('✅ Cleanup berhasil. File test dihapus.');
  }
  
  console.log('');
  console.log('===========================================');
  console.log('TEST SELESAI');
  console.log('===========================================');
}

testUpload().catch(err => {
  console.error('');
  console.error('❌ FATAL ERROR:', err.message);
  console.error(err.stack);
});
