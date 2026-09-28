// ============================================================
// PATCH: Sidebar nav — Hapus Backtest, Tambah Signals
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'assets', 'stockfamily-sidebar.js');
const BACKUP = FILE + '.bak-signals-nav-' + Date.now();

if (!fs.existsSync(FILE)) {
  console.error('❌ File not found:', FILE);
  process.exit(1);
}

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));
console.log('');

let code = fs.readFileSync(FILE, 'utf8');
const log = [];

const patch = (name, find, replace) => {
  if (code.includes(find)) {
    code = code.replace(find, replace);
    log.push('✅ ' + name);
    return true;
  } else {
    log.push('❌ ' + name);
    return false;
  }
};

// ============================================================
// 1. Hapus BACKTEST dari NAV + Tambah SIGNALS setelah screener
// ============================================================
const backtestNavOld = `    {
      key: "backtest",
      label: "Backtest",
      href: "/backtest.html",
      icon: \`
        <svg viewBox="0 0 24 24">
          <path d="M4 19V5"></path>
          <path d="M4 19h16"></path>
          <path d="m7 15 3-4 3 2 4-6"></path>
        </svg>
      \`
    },
    {
      key: "watchlist",`;

const signalsNavNew = `    {
      key: "signals",
      label: "Signals",
      href: "/signals.html",
      icon: \`
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9"></circle>
          <circle cx="12" cy="12" r="5"></circle>
          <circle cx="12" cy="12" r="1.5" fill="currentColor"></circle>
        </svg>
      \`
    },
    {
      key: "watchlist",`;

if (code.includes(backtestNavOld)) {
  code = code.replace(backtestNavOld, signalsNavNew);
  log.push('✅ Backtest dihapus, Signals ditambahkan');
} else {
  // Fallback: cari pattern backtest saja
  const backtestOnly = /    \{\s*key:\s*"backtest",[\s\S]*?\},\s*(?=\{\s*key:\s*"watchlist")/;
  if (backtestOnly.test(code)) {
    const signalsBlock = `    {
      key: "signals",
      label: "Signals",
      href: "/signals.html",
      icon: \`
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9"></circle>
          <circle cx="12" cy="12" r="5"></circle>
          <circle cx="12" cy="12" r="1.5" fill="currentColor"></circle>
        </svg>
      \`
    },
    `;
    code = code.replace(backtestOnly, signalsBlock);
    log.push('✅ Fallback: Backtest dihapus, Signals ditambahkan');
  } else {
    log.push('❌ NAV backtest pattern tidak ketemu');
  }
}

// ============================================================
// 2. Update PATH DETECTION
// ============================================================
const pathOld = `    if (path.endsWith("/backtest.html")) {
      return "backtest";
    }

    if (path.endsWith("/watchlist.html")) {
      return "watchlist";
    }`;

const pathNew = `    if (path.endsWith("/signals.html")) {
      return "signals";
    }

    if (path.endsWith("/watchlist.html")) {
      return "watchlist";
    }`;

patch('Path detection updated', pathOld, pathNew);

// ============================================================
// 3. Update KEY ARRAY (untuk deteksi sidebar)
// ============================================================
const keyOld = `          hrefText.includes(
            "backtest"
          ),
          hrefText.includes(
            "watchlist"
          ),`;

const keyNew = `          hrefText.includes(
            "signals"
          ),
          hrefText.includes(
            "watchlist"
          ),`;

patch('Key array updated', keyOld, keyNew);

// SAVE
fs.writeFileSync(FILE, code, 'utf8');

console.log('=== PATCH REPORT ===');
log.forEach(l => console.log(l));
console.log('');
console.log('🎉 Selesai! Refresh browser untuk cek sidebar.');
