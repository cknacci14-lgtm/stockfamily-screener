// compare-excel-files.js - Bandingkan file 8 Sep vs 9-24 Sep
const XLSX = require('xlsx');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const dataDir = './data';
const files = fs.readdirSync(dataDir)
  .filter(f => f.startsWith('Ringkasan Saham-') && f.endsWith('.xlsx'))
  .sort()
  .slice(-20); // Ambil 20 file terakhir

console.log('=== PERBANDINGAN FILE EXCEL (20 TERAKHIR) ===\n');
console.log('File                              | Hash       | Tgl Terakhir | BBCA NR Vol');
console.log('─'.repeat(95));

files.forEach(f => {
  try {
    const wb = XLSX.readFile(path.join(dataDir, f));
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws);
    
    // Hitung hash dari data (bukan file mentah)
    const jsonStr = JSON.stringify(data);
    const hash = crypto.createHash('md5').update(jsonStr).digest('hex').slice(0, 8);
    
    // Cari BBCA
    const bbca = data.find(r => String(r['Kode Saham'] || '').toUpperCase() === 'BBCA');
    const tglAkhir = bbca ? bbca['Tanggal Perdagangan Terakhir'] : '?';
    const nrVol = bbca ? bbca['Non Regular Volume'] : '?';
    
    const flag = hash === (files[0] && 'CHECK') ? '' : '';
    console.log(`${f.substring(0, 33).padEnd(33)} | ${hash} | ${String(tglAkhir).padEnd(12)} | ${nrVol}`);
  } catch (e) {
    console.log(`${f.substring(0, 33).padEnd(33)} | ERROR: ${e.message}`);
  }
});

// Deteksi file duplikat
console.log('\n=== ANALISIS DUPLIKAT ===');
const hashGroups = {};
files.forEach(f => {
  try {
    const wb = XLSX.readFile(path.join(dataDir, f));
    const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const hash = crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
    if (!hashGroups[hash]) hashGroups[hash] = [];
    hashGroups[hash].push(f);
  } catch (e) {}
});

let duplicateCount = 0;
Object.entries(hashGroups).forEach(([hash, fileList]) => {
  if (fileList.length > 1) {
    duplicateCount++;
    console.log(`\n📁 Group ${duplicateCount} (${fileList.length} file identik):`);
    fileList.forEach(f => console.log(`   - ${f}`));
  }
});

if (duplicateCount === 0) {
  console.log('✅ Tidak ada file duplikat. Semua file unik.');
} else {
  console.log(`\n⚠️ Ditemukan ${duplicateCount} grup file duplikat!`);
}

// Cek data BBCA di setiap file terbaru secara detail
console.log('\n=== DETAIL BBCA PER FILE (10 TERAKHIR) ===');
console.log('─'.repeat(80));
files.slice(-10).forEach(f => {
  const wb = XLSX.readFile(path.join(dataDir, f));
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const bbca = data.find(r => String(r['Kode Saham'] || '').toUpperCase() === 'BBCA');
  if (bbca) {
    console.log(`${f}`);
    console.log(`  Tgl Terakhir: ${bbca['Tanggal Perdagangan Terakhir']} | Close: ${bbca['Penutupan']} | NR Vol: ${bbca['Non Regular Volume']}`);
  }
});
