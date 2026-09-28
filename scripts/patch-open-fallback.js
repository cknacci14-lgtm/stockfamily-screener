// ============================================================
// PATCH: Fallback open → previous close
// Tujuan: Semua saham tampil candlestick
// Data asli di Supabase TIDAK diubah
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'stock.html');
const BACKUP = FILE + '.bak-open-fallback-' + Date.now();

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
// PATCH 1: Fallback open di candleData
// ============================================================
const candleDataOld = `    const candleData = rows
      .filter(validCandle)
      .map(r => ({
        time: r.time,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close)
      }));`;

const candleDataNew = `    // === FALLBACK OPEN: pakai previous close kalau open=0 ===
    const getFallbackOpen = (idx) => {
      // Cari previous close yang valid
      for (let i = idx - 1; i >= 0; i--) {
        const pc = Number(rows[i].close);
        if (Number.isFinite(pc) && pc > 0) return pc;
      }
      return null;
    };

    const candleData = rows
      .filter(validCandle)
      .map((r, idx) => {
        let open = Number(r.open);
        if (!Number.isFinite(open) || open <= 0) {
          const fallback = getFallbackOpen(idx);
          open = fallback || Number(r.close);
        }
        return {
          time: r.time,
          open: open,
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close)
        };
      });`;

patch('Fallback open di candleData', candleDataOld, candleDataNew);

// ============================================================
// PATCH 2: Disable HLCMode (karena open selalu ada)
// ============================================================
const hlcOld = `    const hasUnavailableOpen = rows.some(r => {
      const open = Number(r.open);
      return !Number.isFinite(open) || open <= 0;
    });`;

const hlcNew = `    // === HLCMode disabled — open selalu di-fallback ===
    const hasUnavailableOpen = false;`;

patch('Disable HLCMode', hlcOld, hlcNew);

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
