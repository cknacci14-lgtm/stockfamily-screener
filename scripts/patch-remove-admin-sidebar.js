// ============================================================
// PATCH: Remove hardcoded sidebar from admin.html
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'admin.html');
const BACKUP = FILE + '.bak-remove-sidebar-' + Date.now();

if (!fs.existsSync(FILE)) {
  console.error('❌ File not found:', FILE);
  process.exit(1);
}

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));
console.log('');

let html = fs.readFileSync(FILE, 'utf8');

// Cari sidebar hardcoded (nav.sidebar)
// Format typical:
// <nav class="sidebar">
//   <div class="brand">...</div>
//   <a class="nav-item" href="/">...</a>
//   ...
// </nav>

const sidebarRegex = /<nav\s+class="sidebar"[^>]*>[\s\S]*?<\/nav>/;
const match = html.match(sidebarRegex);

if (!match) {
  console.log('⚠️ Sidebar hardcoded tidak ditemukan (mungkin sudah dihapus)');
  process.exit(0);
}

console.log('  Found sidebar (' + match[0].length + ' chars)');
console.log('  Preview: ' + match[0].substring(0, 100).replace(/\n/g, ' ') + '...');
console.log('');

// Hapus sidebar
html = html.replace(sidebarRegex, '<!-- Sidebar di-inject oleh stockfamily-sidebar.js -->');

fs.writeFileSync(FILE, html, 'utf8');
console.log('✅ Sidebar hardcoded dihapus dari admin.html');
console.log('');
console.log('🎉 Selesai! Refresh browser.');
