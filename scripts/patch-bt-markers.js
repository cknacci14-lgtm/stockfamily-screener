// ============================================================
// PATCH: Block Trade Markers di stock.html
// - Tambah marker berlian ungu di atas candle
// - 5 marker terbesar
// - Data dari history.nonRegular
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'stock.html');
const BACKUP = FILE + '.bak-bt-markers-' + Date.now();

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
// PATCH: Tambah Block Trade markers setelah SMA calculation
// ============================================================
const anchorOld = `    if (sma20Series && closeData.length >= 20) {
      sma20Series.setData(calcSMA(closeData, 20));
    }
    if (sma50Series && closeData.length >= 50) {
      sma50Series.setData(calcSMA(closeData, 50));
    }`;

const anchorNew = `    if (sma20Series && closeData.length >= 20) {
      sma20Series.setData(calcSMA(closeData, 20));
    }
    if (sma50Series && closeData.length >= 50) {
      sma50Series.setData(calcSMA(closeData, 50));
    }

    // === BLOCK TRADE MARKERS ===
    const _btRows = Array.isArray(data.nonRegular) ? data.nonRegular.slice() : [];
    const _btMarkers = _btRows
      .filter(bt => Number(bt.volume) > 0)
      .sort((a, b) => Number(b.volume) - Number(a.volume))
      .slice(0, 5)
      .map(bt => {
        const vol = Number(bt.volume);
        const volText = vol >= 1e9 ? (vol/1e9).toFixed(1) + 'B'
                       : vol >= 1e6 ? (vol/1e6).toFixed(0) + 'M'
                       : vol >= 1e3 ? (vol/1e3).toFixed(0) + 'K'
                       : String(vol);
        return {
          time: bt.time,
          position: 'aboveBar',
          color: '#A855F7',
          shape: 'arrowDown',
          text: volText,
          size: 1
        };
      });

    if (candleSeries) {
      candleSeries.setMarkers(_btMarkers);
    }`;

patch('Block Trade markers', anchorOld, anchorNew);

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
