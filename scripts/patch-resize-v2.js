// ============================================================
// PATCH: Manual resize chart — all breakpoints
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'stock.html');
const BACKUP = FILE + '.bak-resize-v2-' + Date.now();

if (!fs.existsSync(FILE)) {
  console.error('❌ File tidak ditemukan:', FILE);
  process.exit(1);
}

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));
console.log('');

let html = fs.readFileSync(FILE, 'utf8');
const log = [];

// Patch semua #chart { height:XXXpx; ... } dengan regex global
// Cari pattern: #chart { ... height:XXXpx; ... } (tanpa resize)
const chartRegex = /(#chart\s*\{\s*\n\s*height:\s*\d+px;)(\s*\n\s*width:\s*100%;)?/g;

let matchCount = 0;
html = html.replace(chartRegex, (match, group1, group2) => {
  if (match.includes('resize:')) {
    log.push('⚠️ Sudah ada resize');
    return match;
  }
  matchCount++;
  const width = group2 || '';
  return `${group1}${width}
      resize: vertical;
      overflow: hidden;
      min-height: 300px;
      max-height: 1000px;`;
});

log.push(`✅ Patch resize di ${matchCount} breakpoint(s)`);

// ============================================================
// ResizeObserver — biar chart library tahu container berubah
// ============================================================
const roAnchor = `    chart = LightweightCharts.createChart(el, {`;
const roReplace = `    chart = LightweightCharts.createChart(el, {`;

// Cari tempat setelah chart dibuat untuk tambah ResizeObserver
const afterChartInit = 'chart.timeScale().fitContent();';
if (html.includes(afterChartInit) && !html.includes('ResizeObserver')) {
  const roCode = `${afterChartInit}

    // === AUTO RESIZE CHART ===
    new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && chart) {
          chart.applyOptions({ width, height });
        }
      }
    }).observe(el);`;
  
  html = html.replace(afterChartInit, roCode);
  log.push('✅ ResizeObserver ditambahkan');
} else {
  log.push('⚠️ ResizeObserver sudah ada atau anchor tidak match');
}

// ============================================================
// SAVE
// ============================================================
fs.writeFileSync(FILE, html, 'utf8');

console.log('=== PATCH REPORT ===');
log.forEach(l => console.log(l));
console.log('');

if (matchCount > 0) {
  console.log('🎉 Patch berhasil! Refresh browser.');
} else {
  console.log('⚠️ Tidak ada yang dipatch. Restore:');
  console.log(`  Copy-Item "${BACKUP}" "${FILE}" -Force`);
}
