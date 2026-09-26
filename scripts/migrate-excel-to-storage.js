require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrate() {
  console.log('');
  console.log('===========================================');
  console.log('MIGRASI EXCEL KE SUPABASE STORAGE');
  console.log('===========================================');
  console.log('');

  const dataDir = './data';
  const files = fs.readdirSync(dataDir)
    .filter(f => /^Ringkasan Saham-\d{8}\.xlsx$/i.test(f))
    .sort();

  console.log(`📁 Total: ${files.length} file`);
  console.log(`📊 Target: bucket "excel-archive"`);
  console.log('');
  console.log('⏳ Memulai migrasi...\n');

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const failedFiles = [];
  const startTime = Date.now();

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const match = filename.match(/(\d{8})/);
    const yyyymmdd = match[1];
    const year = yyyymmdd.slice(0, 4);
    const month = yyyymmdd.slice(4, 6);
    const folder = `${year}-${month}`;
    const archivePath = `${folder}/${filename}`;

    // Progress indicator
    const progress = `[${String(i + 1).padStart(3)}/${files.length}]`;

    try {
      // Cek apakah sudah ada di Storage
      const { data: existing } = await supabase.storage
        .from('excel-archive')
        .list(folder, { search: filename, limit: 1 });

      const alreadyExists = existing && existing.some(f => f.name === filename);

      if (alreadyExists) {
        console.log(`  ${progress} ⏭️  ${filename} — sudah ada`);
        skipped++;
        continue;
      }

      // Upload file
      const filePath = path.join(dataDir, filename);
      const fileBuffer = fs.readFileSync(filePath);
      const sizeKB = (fileBuffer.length / 1024).toFixed(1);

      const { error } = await supabase.storage
        .from('excel-archive')
        .upload(archivePath, fileBuffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false
        });

      if (error) {
        console.log(`  ${progress} ❌ ${filename} — ${error.message}`);
        failed++;
        failedFiles.push({ filename, error: error.message });
      } else {
        console.log(`  ${progress} ✅ ${filename} (${sizeKB} KB) → ${archivePath}`);
        uploaded++;
      }

      // Rate limit: 100ms antar upload
      await new Promise(r => setTimeout(r, 100));

    } catch (err) {
      console.log(`  ${progress} ❌ ${filename} — ${err.message}`);
      failed++;
      failedFiles.push({ filename, error: err.message });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('===========================================');
  console.log('MIGRASI SELESAI');
  console.log('===========================================');
  console.log(`⏱️  Waktu      : ${elapsed} detik`);
  console.log(`✅ Uploaded   : ${uploaded} file`);
  console.log(`⏭️  Skipped    : ${skipped} file (sudah ada)`);
  console.log(`❌ Failed     : ${failed} file`);
  console.log('');

  if (failedFiles.length > 0) {
    console.log('=== FILE YANG GAGAL ===');
    failedFiles.forEach(f => {
      console.log(`  - ${f.filename}`);
      console.log(`    Error: ${f.error}`);
    });
    console.log('');
  }

  // Verifikasi final: hitung file di Storage
  console.log('=== VERIFIKASI STORAGE ===');
  const { data: folders } = await supabase.storage
    .from('excel-archive')
    .list('', { limit: 100 });

  let totalInStorage = 0;
  for (const f of folders) {
    const { data: filesInFolder } = await supabase.storage
      .from('excel-archive')
      .list(f.name, { limit: 1000 });
    if (filesInFolder) {
      totalInStorage += filesInFolder.length;
    }
  }

  console.log(`📊 Total file di bucket "excel-archive": ${totalInStorage}`);
  console.log('');
}

migrate().catch(err => {
  console.error('');
  console.error('❌ FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
