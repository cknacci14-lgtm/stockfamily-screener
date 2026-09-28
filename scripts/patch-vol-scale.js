// ============================================================
// FIX: Volume scale applyOptions + chart margins
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'stock.html');
const BACKUP = FILE + '.bak-vol-scale-' + Date.now();

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
// PATCH 1: Chart right scale - beri ruang bawah lebih besar (chart sampai 62%)
// ============================================================
patch('Chart right scale margins',
  `      rightPriceScale: {
        borderColor: "#20262a",
        scaleMargins: {
          top: 0.08,
          bottom: 0.30
        }
      },`,
  `      rightPriceScale: {
        borderColor: "#20262a",
        scaleMargins: {
          top: 0.05,
          bottom: 0.38
        }
      },`
);

// ============================================================
// PATCH 2: Tambah chart.priceScale('volume_scale').applyOptions setelah series dibuat
// Ini yang BIKIN volume ada di scale sendiri
// ============================================================
const anchorOld = `    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume_scale",
      scaleMargins: {
        top: 0.74,
        bottom: 0.02
      }
    });`;

const anchorNew = `    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume_scale",
      priceLineVisible: false,
      lastValueVisible: false
    });

    // === APPLY VOLUME SCALE MARGINS (buat volume terpisah dari chart) ===
    chart.priceScale('volume_scale').applyOptions({
      scaleMargins: {
        top: 0.68,
        bottom: 0.02
      }
    });`;

patch('Volume scale applyOptions', anchorOld, anchorNew);

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
  console.log('⚠️ Restore:');
  console.log(`  Copy-Item "${BACKUP}" "${FILE}" -Force`);
} else {
  console.log('🎉 Patch berhasil! Refresh browser.');
}
