// ============================================================
// PATCH: stock.html Chart Enhancement (SAFE)
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'stock.html');
const BACKUP = FILE + '.bak-chart-' + Date.now();

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
// PATCH 1: Layout + Watermark (tambahkan sebelum closing });)
// Target: baris 990-993 (layout config)
// ============================================================
const layoutOld = `      layout: {
        background: { color: "#0a0d0f" },
        textColor: "#7f8a91"
      },`;

const layoutNew = `      layout: {
        background: { color: "#0a0d0f" },
        textColor: "#7f8a91",
        attributionLogo: false
      },
      
      watermark: {
        visible: true,
        text: "CHARTNALIST",
        fontSize: 28,
        color: "rgba(127, 138, 145, 0.06)",
        horzAlign: "center",
        vertAlign: "center"
      },`;

patch('Layout + Watermark', layoutOld, layoutNew);

// ============================================================
// PATCH 2: Tambah SMA20 & SMA50 setelah volumeSeries
// Target: baris 1057-1064 (volumeSeries config)
// ============================================================
const volumeOld = `    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      scaleMargins: {
        top: 0.82,
        bottom: 0
      }
    });`;

const volumeNew = `    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      scaleMargins: {
        top: 0.82,
        bottom: 0
      }
    });

    // === SMA20 & SMA50 LINES ===
    sma20Series = chart.addLineSeries({
      color: "#00E5FF",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });

    sma50Series = chart.addLineSeries({
      color: "#FFB300",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });`;

patch('SMA20 + SMA50 series', volumeOld, volumeNew);

// ============================================================
// PATCH 3: Tambah variable declaration untuk sma series
// Cari deklarasi variable yang ada
// ============================================================
// Cari pattern "let chart" atau "var chart" untuk tambah setelahnya
const varPattern = /((?:let|var|const)\s+volumeSeries[^;]*;)/;
const varMatch = html.match(varPattern);

if (varMatch) {
  const oldDecl = varMatch[1];
  const newDecl = oldDecl + '\n  let sma20Series = null;\n  let sma50Series = null;';
  html = html.replace(oldDecl, newDecl);
  log.push('✅ Variable declaration');
} else {
  // Coba cari pattern lain
  const altPattern = /((?:let|var|const)\s+chart\s*=\s*null;)/;
  if (altPattern.test(html)) {
    html = html.replace(altPattern, '$1\n  let sma20Series = null;\n  let sma50Series = null;');
    log.push('✅ Variable declaration (via chart)');
  } else {
    log.push('⚠️ Variable declaration — skip (cari pattern manual)');
  }
}

// ============================================================
// PATCH 4: SMA calculation & setData
// Target: setelah "volumeSeries.setData(volumeData);"
// ============================================================
const setDataOld = `    candleSeries.setData(candleData);
    closeSeries.setData(closeData);
    highSeries.setData(highData);
    lowSeries.setData(lowData);
    volumeSeries.setData(volumeData);`;

const setDataNew = `    candleSeries.setData(candleData);
    closeSeries.setData(closeData);
    highSeries.setData(highData);
    lowSeries.setData(lowData);
    volumeSeries.setData(volumeData);

    // === SMA CALCULATION ===
    const calcSMA = (data, period) => {
      const out = [];
      for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].value;
        out.push({ time: data[i].time, value: sum / period });
      }
      return out;
    };

    if (sma20Series && closeData.length >= 20) {
      sma20Series.setData(calcSMA(closeData, 20));
    }
    if (sma50Series && closeData.length >= 50) {
      sma50Series.setData(calcSMA(closeData, 50));
    }`;

patch('SMA calculation + setData', setDataOld, setDataNew);

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
