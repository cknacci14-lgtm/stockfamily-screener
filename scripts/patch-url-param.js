// ============================================================
// PATCH: URL Param Handler untuk index.html
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'index.html');
const BACKUP = FILE + '.bak-url-param-' + Date.now();

if (!fs.existsSync(FILE)) {
  console.error('❌ File not found:', FILE);
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
// PATCH 1: activeCode init baca URL param
// ============================================================
const activeOld = 'let activeCode = "BBCA";';
const activeNew = `// === URL PARAM HANDLER ===
  let activeCode = (function() {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('code');
      if (urlCode) return String(urlCode).toUpperCase().trim();
    } catch (e) {}
    return "BBCA";
  })();`;

patch('activeCode from URL', activeOld, activeNew);

// ============================================================
// PATCH 2: Tambah URL code ke watchlist kalau belum ada
// ============================================================
const watchlistOld = 'let watchlistCodes = loadWatchlistCodesFromStorage();';
const watchlistNew = `let watchlistCodes = loadWatchlistCodesFromStorage();
  // Auto-add URL code ke watchlist kalau belum ada
  (function() {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('code');
      if (urlCode) {
        const c = String(urlCode).toUpperCase().trim();
        if (c && !watchlistCodes.includes(c)) {
          watchlistCodes.push(c);
          try { localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlistCodes)); } catch(e) {}
        }
      }
    } catch (e) {}
  })();`;

patch('Auto-add URL code to watchlist', watchlistOld, watchlistNew);

// SAVE
fs.writeFileSync(FILE, html, 'utf8');

console.log('=== PATCH REPORT ===');
log.forEach(l => console.log(l));
console.log('');
console.log('🎉 Selesai! Refresh: http://localhost:3000/?code=ESIP');
