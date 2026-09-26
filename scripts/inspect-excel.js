// inspect-excel.js - Cek kolom & data NR di file Excel
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Cari file Excel terbaru
const dataDir = './data';
const files = fs.readdirSync(dataDir)
  .filter(f => f.startsWith('Ringkasan Saham-') && f.endsWith('.xlsx'))
  .sort()
  .reverse();

if (!files.length) {
  console.error('❌ Tidak ada file Excel ditemukan di ./data');
  process.exit(1);
}

const latestFile = path.join(dataDir, files[0]);
console.log('📁 File terbaru:', latestFile);
console.log('');

const wb = XLSX.readFile(latestFile);
const sheetName = wb.SheetNames[0];
const ws = wb.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(ws);

console.log(`📋 Sheet: ${sheetName}`);
console.log(`📊 Total rows: ${data.length}`);
console.log('');

// Tampilkan semua nama kolom
console.log('=== DAFTAR KOLOM ===');
const headers = Object.keys(data[0] || {});
headers.forEach((h, i) => {
  console.log(`  ${i + 1}. ${h}`);
});

console.log('');

// Cari kolom yang berkaitan dengan Non Regular
console.log('=== KOLOM TERKAIT NON-REGULAR ===');
const nrKeys = headers.filter(h => 
  h.toLowerCase().includes('non') || 
  h.toLowerCase().includes('regular') ||
  h.toLowerCase().includes('nra') ||
  h.toLowerCase().includes('nr')
);
if (nrKeys.length) {
  nrKeys.forEach(k => console.log(`  ✓ ${k}`));
} else {
  console.log('  ⚠️ TIDAK ADA kolom Non-Regular di file ini!');
}

console.log('');

// Cek data BBCA
console.log('=== SAMPLE DATA BBCA ===');
const bbcaRow = data.find(r => {
  const code = r['Kode Saham'] || r['Code'] || r['Stock Code'] || r['kode'] || '';
  return String(code).toUpperCase() === 'BBCA';
});

if (bbcaRow) {
  console.log('Row ditemukan. Semua nilai:');
  Object.entries(bbcaRow).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });
} else {
  console.log('⚠️ BBCA tidak ditemukan. Coba 5 kode saham pertama:');
  data.slice(0, 3).forEach((r, i) => {
    const code = r['Kode Saham'] || r['Code'] || r['Stock Code'] || '?';
    console.log(`  Row ${i + 1}: ${code}`);
    console.log('    Keys:', Object.keys(r).slice(0, 10).join(', '));
  });
}

console.log('');
console.log('=== BANDINGKAN DENGAN FILE LAMA (8 Sep) ===');
const oldFile = files.find(f => f.includes('20260908'));
if (oldFile) {
  console.log(`File lama: ${oldFile}`);
  const wbOld = XLSX.readFile(path.join(dataDir, oldFile));
  const dataOld = XLSX.utils.sheet_to_json(wbOld.Sheets[wbOld.SheetNames[0]]);
  const bbcaOld = dataOld.find(r => {
    const code = r['Kode Saham'] || r['Code'] || '';
    return String(code).toUpperCase() === 'BBCA';
  });
  if (bbcaOld) {
    console.log('BBCA di file 8 Sep:');
    Object.entries(bbcaOld).forEach(([k, v]) => {
      console.log(`  ${k}: ${v}`);
    });
  }
} else {
  console.log('File 8 Sep tidak ditemukan di ./data');
}
