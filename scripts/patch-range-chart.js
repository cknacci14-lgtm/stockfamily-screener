// ============================================================
// PATCH: Fix range (6mo→1y) + rapikan chart + volume
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'stock.html');
const BACKUP = FILE + '.bak-range-chart-' + Date.now();

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
// PATCH 1: Ubah default range dari 6mo → 1y
// ============================================================
patch('Default range 1y',
  'let currentRange = "6mo";',
  'let currentRange = "1y";'
);

// ============================================================
// PATCH 2: Ubah label tombol 6M → 1Y
// ============================================================
patch('Label tombol 6M → 1Y',
  '<span class="range-tab active" style="cursor:default;">6M</span>',
  '<span class="range-tab active" style="cursor:default;">1Y</span>'
);

// ============================================================
// PATCH 3: Fix chart rightPriceScale — lebih agresif kasih ruang volume
// ============================================================
patch('Fix chart scaleMargins',
  `      rightPriceScale: {
        borderColor: "#20262a",
        scaleMargins: {
          top: 0.05,
          bottom: 0.22
        }
      },`,
  `      rightPriceScale: {
        borderColor: "#20262a",
        scaleMargins: {
          top: 0.08,
          bottom: 0.30
        }
      },`
);

// ============================================================
// PATCH 4: Fix volume — lebih kecil + rapi di bawah
// ============================================================
patch('Fix volume scale',
  `      priceScaleId: "volume_scale",
      scaleMargins: {
        top: 0.80,
        bottom: 0.02
      }`,
  `      priceScaleId: "volume_scale",
      scaleMargins: {
        top: 0.74,
        bottom: 0.02
      }`
);

// ============================================================
// PATCH 5: Hide TradingView watermark kecil (kiri bawah)
// Target: layout config, tambah attributionLogo: false
// ============================================================
const layoutOld = `      layout: {
        background: { color: "#0a0d0f" },
        textColor: "#7f8a91",
        attributionLogo: false
      },`;

// Cek apakah attributionLogo sudah ada
if (html.includes('attributionLogo: false')) {
  log.push('⚠️ attributionLogo sudah ada');
} else {
  patch('Hide attribution logo',
    `      layout: {
        background: { color: "#0a0d0f" },
        textColor: "#7f8a91"
      },`,
    `      layout: {
        background: { color: "#0a0d0f" },
        textColor: "#7f8a91",
        attributionLogo: false
      },`
  );
}

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
