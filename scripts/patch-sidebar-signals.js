// ============================================================
// PATCH: Add Signals link to sidebar (all pages)
// ============================================================

const fs = require('fs');
const path = require('path');

const files = [
  'public/index.html',
  'public/stock.html',
  'public/admin.html',
  'public/signals.html',
  'public/screener.html',
  'public/backtest.html',
  'public/watchlist.html'
];

let totalPatch = 0;
let totalSkip = 0;
const report = [];

files.forEach(relPath => {
  const FILE = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(FILE)) {
    report.push('⚠️ Skip (tidak ada): ' + relPath);
    totalSkip++;
    return;
  }

  let html = fs.readFileSync(FILE, 'utf8');

  // Skip kalau sudah ada link signals
  if (html.includes('/signals.html') && html.includes('Signals')) {
    report.push('⏭️ Sudah ada: ' + relPath);
    totalSkip++;
    return;
  }

  // Cari pattern Watchlist nav-item
  // Bisa format: <a class="nav-item" href="/watchlist.html">...</a>
  // Atau: <a class="nav-item" href="watchlist.html">...</a>
  const patterns = [
    // Pattern 1: href="/watchlist.html" (stock.html, admin.html)
    /(<a\s+class="nav-item"[^>]*href="\/watchlist\.html"[^>]*>.*?<\/a>)/s,
    // Pattern 2: href="watchlist.html" (maybe)
    /(<a\s+class="nav-item"[^>]*href="watchlist\.html"[^>]*>.*?<\/a>)/s,
  ];

  let patched = false;
  let matched = '';

  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      matched = m[1];
      break;
    }
  }

  if (!matched) {
    report.push('⚠️ Pattern watchlist tidak ketemu: ' + relPath);
    totalSkip++;
    return;
  }

  // Buat link signals
  const signalsLink = matched.replace(/watchlist\.html/g, 'signals.html')
                           .replace(/Watchlist/g, 'Signals')
                           .replace(/⭐/g, '🎯')
                           .replace(/â/g, '🎯');

  // Insert signals link SEBELUM watchlist link (urutan: Dashboard, Screener, Signals, Backtest, Watchlist, Admin)
  const newHtml = html.replace(matched, signalsLink + '\n' + matched);
  fs.writeFileSync(FILE, newHtml, 'utf8');

  report.push('✅ Patched: ' + relPath);
  totalPatch++;
});

console.log('=== PATCH REPORT ===');
report.forEach(r => console.log(r));
console.log('');
console.log('✅ Patched :', totalPatch);
console.log('⏭️ Skipped :', totalSkip);
console.log('');
console.log('🎉 Selesai! Refresh browser untuk cek sidebar.');
