// validate-html-js.js - Cek syntax JS di index.html
const fs = require('fs');
const path = require('path');

const htmlPath = './public/index.html';
console.log('=== VALIDASI index.html ===\n');

if (!fs.existsSync(htmlPath)) {
  console.error('❌ File index.html tidak ditemukan');
  process.exit(1);
}

const content = fs.readFileSync(htmlPath, 'utf8');
console.log(`📄 File size: ${(content.length / 1024).toFixed(1)} KB`);

// Extract semua <script> inline
const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
const scripts = [];
let match;
let scriptIndex = 0;

while ((match = scriptRegex.exec(content)) !== null) {
  scriptIndex++;
  scripts.push({
    index: scriptIndex,
    code: match[1],
    length: match[1].length
  });
}

console.log(`📊 Total inline <script> tags: ${scripts.length}\n`);

// Validate setiap script
let totalErrors = 0;
for (const s of scripts) {
  if (s.code.trim().length < 10) {
    console.log(`  [Script #${s.index}] SKIP (terlalu pendek: ${s.length} chars)`);
    continue;
  }
  
  try {
    // Coba parse dengan Function constructor (syntax check)
    new Function(s.code);
    console.log(`  [Script #${s.index}] ✅ VALID (${s.length} chars)`);
  } catch (err) {
    console.error(`  [Script #${s.index}] ❌ SYNTAX ERROR (${s.length} chars)`);
    console.error(`     ${err.message}`);
    
    // Cari baris error
    const lineMatch = err.stack.match(/<anonymous>:(\d+)/);
    if (lineMatch) {
      const errLine = parseInt(lineMatch[1]);
      const lines = s.code.split('\n');
      console.error(`     Sekitar baris ${errLine} dalam script:`);
      for (let i = Math.max(0, errLine - 3); i < Math.min(lines.length, errLine + 2); i++) {
        const marker = i === errLine - 1 ? '>>> ' : '    ';
        console.error(`     ${marker}${lines[i].substring(0, 100)}`);
      }
    }
    totalErrors++;
  }
}

console.log('');
if (totalErrors > 0) {
  console.log(`❌ TOTAL SYNTAX ERRORS: ${totalErrors}`);
  console.log('');
  console.log('BACKUP index.html yang ada:');
} else {
  console.log('✅ SEMUA SCRIPT VALID!');
  console.log('   Masalah chart kosong kemungkinan dari:');
  console.log('   1. Cache browser (Ctrl+Shift+R)');
  console.log('   2. Runtime error (cek F12 Console)');
  console.log('   3. Logic error di fetch/rendering');
}

// List backup
console.log('');
console.log('=== BACKUP index.html ===');
const publicDir = './public';
const backups = fs.readdirSync(publicDir)
  .filter(f => f.startsWith('index.html.bak'))
  .map(f => ({
    name: f,
    time: fs.statSync(path.join(publicDir, f)).mtime,
    size: fs.statSync(path.join(publicDir, f)).size
  }))
  .sort((a, b) => b.time - a.time);

if (backups.length === 0) {
  console.log('  (tidak ada backup)');
} else {
  backups.slice(0, 10).forEach(b => {
    console.log(`  ${b.time.toISOString().slice(0, 19)} | ${(b.size/1024).toFixed(1)} KB | ${b.name}`);
  });
}
