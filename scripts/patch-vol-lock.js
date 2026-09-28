// ============================================================
// PATCH: Volume overlap + Lock timeframe
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'stock.html');
const BACKUP = FILE + '.bak-vol-lock-' + Date.now();

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
// PATCH 1: Fix chart right price scale — beri ruang bawah untuk volume
// Target: rightPriceScale config (line 1016)
// ============================================================
const rpsOld = `      rightPriceScale: {
        borderColor: "#20262a"
      },`;

const rpsNew = `      rightPriceScale: {
        borderColor: "#20262a",
        scaleMargins: {
          top: 0.05,
          bottom: 0.22
        }
      },`;

patch('Fix chart scaleMargins (ruang untuk volume)', rpsOld, rpsNew);

// ============================================================
// PATCH 2: Fix volume scale margins
// Target: scaleMargins di volumeSeries (line 1071)
// ============================================================
const volMarginsOld = `      priceScaleId: "",
      scaleMargins: {
        top: 0.82,
        bottom: 0
      }`;

const volMarginsNew = `      priceScaleId: "volume_scale",
      scaleMargins: {
        top: 0.80,
        bottom: 0.02
      }`;

patch('Fix volume scaleMargins', volMarginsOld, volMarginsNew);

// ============================================================
// PATCH 3: Hapus tombol timeframe (3M/6M/1Y)
// ============================================================
const btnOld = `        <div class="range-tabs">
          <button class="range-tab" data-range="3mo">3M</button>
          <button class="range-tab active" data-range="6mo">6M</button>
          <button class="range-tab" data-range="1y">1Y</button>
        </div>`;

const btnNew = `        <div class="range-tabs">
          <span class="range-tab active" style="cursor:default;">6M</span>
        </div>`;

patch('Hapus tombol 3M/1Y (lock 6M)', btnOld, btnNew);

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
  console.log('⚠️ Ada yang gagal. Restore:');
  console.log(`  Copy-Item "${BACKUP}" "${FILE}" -Force`);
} else {
  console.log('🎉 Semua patch berhasil! Refresh browser.');
}
