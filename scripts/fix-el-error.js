// ============================================================
// FIX: ResizeObserver scope issue
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'stock.html');
const BACKUP = FILE + '.bak-fix-el-' + Date.now();

if (!fs.existsSync(FILE)) {
  console.error('❌ File tidak ditemukan:', FILE);
  process.exit(1);
}

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));
console.log('');

let html = fs.readFileSync(FILE, 'utf8');
const log = [];

// Cari ResizeObserver yang bermasalah
const brokenRO = `    // === AUTO RESIZE CHART ===
    new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && chart) {
          chart.applyOptions({ width, height });
        }
      }
    }).observe(el);`;

const fixedRO = `    // === AUTO RESIZE CHART ===
    const chartContainer = document.getElementById("chart");
    if (chartContainer) {
      new ResizeObserver(entries => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0 && chart) {
            chart.applyOptions({ width, height });
          }
        }
      }).observe(chartContainer);
    }`;

if (html.includes(brokenRO)) {
  html = html.replace(brokenRO, fixedRO);
  log.push('✅ Fixed ResizeObserver (pakai getElementById)');
} else {
  // Coba pattern lain
  const simplerPattern = /\}\)\.observe\(el\);/g;
  const count = (html.match(simplerPattern) || []).length;
  if (count > 0) {
    html = html.replace(simplerPattern, '}).observe(document.getElementById("chart"));');
    log.push(`✅ Fixed ${count} ResizeObserver (fallback)`);
  } else {
    log.push('⚠️ ResizeObserver pattern tidak ditemukan');
  }
}

// SAVE
fs.writeFileSync(FILE, html, 'utf8');

console.log('=== PATCH REPORT ===');
log.forEach(l => console.log(l));
console.log('');

console.log('🎉 Patch selesai! Refresh browser.');
