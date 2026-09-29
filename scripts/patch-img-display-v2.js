const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'signals.html');
const BACKUP = FILE + '.bak-img-display-v2-' + Date.now();

if (!fs.existsSync(FILE)) {
  console.error('❌ File not found');
  process.exit(1);
}

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));

let html = fs.readFileSync(FILE, 'utf8');

if (html.includes("s.image_url ?")) {
  console.log('⚠️ Image display sudah ada, skip');
  process.exit(0);
}

const oldAnchor = "      renderPLBlockWithWarning(s, priceData) +";

const newBlock = `      (s.image_url ? '<div class="signal-image" onclick="openImageModal(this.querySelector(\\'img\\').src)"><img src="' + safeText(s.image_url) + '" loading="lazy" alt="Chart ' + ticker + '"></div>' : '') +

      renderPLBlockWithWarning(s, priceData) +`;

if (!html.includes(oldAnchor)) {
  console.error('❌ Anchor tidak match');
  process.exit(1);
}

html = html.replace(oldAnchor, newBlock);

fs.writeFileSync(FILE, html, 'utf8');
console.log('✅ Image display injected');
console.log('');
console.log('Refresh: http://localhost:3000/signals.html');
