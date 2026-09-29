const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'signals.html');
const BACKUP = FILE + '.bak-image-display-' + Date.now();

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));

let html = fs.readFileSync(FILE, 'utf8');

// === 1. CSS untuk image ===
const cssAdd = `
  .signal-image { margin: 12px 0; border-radius: 8px; overflow: hidden; border: 1px solid #2A2E39; background: #0a0e17; }
  .signal-image img { width: 100%; max-height: 400px; object-fit: contain; display: block; cursor: zoom-in; }
  .signal-image img:hover { opacity: 0.95; }
  .image-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.9); display: none; align-items: center; justify-content: center; z-index: 9999; cursor: zoom-out; }
  .image-modal.show { display: flex; }
  .image-modal img { max-width: 95vw; max-height: 95vh; object-fit: contain; }
`;

const styleCloseIdx = html.indexOf('</style>');
if (styleCloseIdx > 0) {
  html = html.substring(0, styleCloseIdx) + cssAdd + '\n  ' + html.substring(styleCloseIdx);
  console.log('✅ CSS ditambahkan');
}

// === 2. Tambah image di signal card ===
// Cari setelah price-grid close
const gridEnd = `      renderPLBlockWithWarning(s, priceData) +`;
const gridEndNew = `      (s.image_url ? '<div class="signal-image" onclick="openImageModal(this.querySelector(\\'img\\').src)"><img src="' + safeText(s.image_url) + '" loading="lazy" alt="Chart ' + ticker + '"></div>' : '') +

      renderPLBlockWithWarning(s, priceData) +`;

if (html.includes(gridEnd) && !html.includes('signal-image')) {
  html = html.replace(gridEnd, gridEndNew);
  console.log('✅ Image display ditambahkan ke card');
}

// === 3. Tambah image modal di body + JS ===
const modalHTML = `
<div class="image-modal" id="imageModal" onclick="closeImageModal()">
  <img id="imageModalImg" src="">
</div>
`;

// Insert sebelum </body>
html = html.replace('</body>', modalHTML + '\n</body>');

const modalJS = `
function openImageModal(src) {
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('imageModalImg');
  if (modal && img && src) {
    img.src = src;
    modal.classList.add('show');
  }
}
function closeImageModal() {
  const modal = document.getElementById('imageModal');
  if (modal) modal.classList.remove('show');
}
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeImageModal();
});
`;

// Insert sebelum </script> terakhir
const lastScriptIdx = html.lastIndexOf('</script>');
if (lastScriptIdx > 0) {
  html = html.substring(0, lastScriptIdx) + modalJS + '\n' + html.substring(lastScriptIdx);
  console.log('✅ Modal JS ditambahkan');
}

fs.writeFileSync(FILE, html, 'utf8');
console.log('');
console.log('🎉 Patch signals.html selesai!');
