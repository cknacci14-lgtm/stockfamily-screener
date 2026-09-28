// ============================================================
// PATCH: Price label + manual resize
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'stock.html');
const BACKUP = FILE + '.bak-price-resize-' + Date.now();

if (!fs.existsSync(FILE)) {
  console.error('❌ File tidak ditemukan:', FILE);
  process.exit(1);
}

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));
console.log('');

let html = fs.readFileSync(FILE, 'utf8');
const log = [];

const patch = (name, find, replace) => {
  if (html.includes(find)) {
    html = html.replace(find, replace);
    log.push('✅ ' + name);
    return true;
  } else {
    log.push('❌ ' + name);
    return false;
  }
};

// ============================================================
// PATCH 1: Fix rightPriceScale — visible labels
// ============================================================
patch('Price label visible',
  `      rightPriceScale: {
        borderColor: "#20262a",
        scaleMargins: {
          top: 0.05,
          bottom: 0.38
        }
      },`,
  `      rightPriceScale: {
        borderColor: "#20262a",
        visible: true,
        borderVisible: true,
        scaleMargins: {
          top: 0.05,
          bottom: 0.38
        }
      },`
);

// ============================================================
// PATCH 2: Manual resize CSS
// ============================================================
patch('Manual resize chart',
  `  #chart {
    height:570px;`,
  `  #chart {
    height:570px;
    resize: vertical;
    overflow: auto;
    min-height: 300px;
    max-height: 1000px;`
);

// ============================================================
// SAVE
// ============================================================
fs.writeFileSync(FILE, html, 'utf8');

console.log('=== PATCH REPORT ===');
log.forEach(l => console.log(l));
const ok = log.filter(l => l.startsWith('✅')).length;
const fail = log.filter(l => l.startsWith('❌')).length;
console.log('');
console.log(`✅ Berhasil : ${ok}`);
console.log(`❌ Gagal    : ${fail}`);
console.log('');

if (fail > 0) {
  console.log('⚠️ Kalau ❌, kirim output-nya ke chat — kita cek manual.');
}
