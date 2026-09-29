const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'admin.html');
const BACKUP = FILE + '.bak-image-upload-v2-' + Date.now();

if (!fs.existsSync(FILE)) {
  console.error('❌ File not found:', FILE);
  process.exit(1);
}

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));
console.log('');

let html = fs.readFileSync(FILE, 'utf8');
const log = [];

// ============================================================
// 1. TAMBAH CSS
// ============================================================
const cssAdd = `
    /* Signal Image Upload */
    .signal-image-upload-area { padding: 24px; border: 2px dashed #2a2f3e; border-radius: 8px; text-align: center; cursor: pointer; transition: 0.2s; margin-top: 6px; }
    .signal-image-upload-area:hover { border-color: #f7971e; background: rgba(247,151,30,0.05); }
    .signal-image-upload-area.has-file { border-color: #10b981; background: rgba(16,185,129,0.05); }
    .signal-image-upload-area .icon { font-size: 32px; color: #4b5563; margin-bottom: 8px; }
    .signal-image-upload-area .text { font-size: 13px; color: #9ca3af; }
    .signal-image-upload-area .hint { font-size: 10px; color: #6b7280; margin-top: 4px; }
    .signal-image-preview { margin-top: 12px; padding: 12px; background: #0a0e17; border-radius: 8px; border: 1px solid #2a2f3e; }
    .signal-image-preview img { max-width: 100%; max-height: 280px; border-radius: 6px; display: block; margin: 0 auto; }
    .signal-image-preview .remove-img { display: block; margin: 10px auto 0; padding: 6px 14px; font-size: 11px; background: #7f1d1d; color: #fca5a5; border: 1px solid #dc2626; border-radius: 4px; cursor: pointer; font-weight: 600; }
    .signal-image-preview .remove-img:hover { background: #dc2626; color: #fff; }
`;

const styleClose = html.indexOf('</style>');
if (styleClose > 0) {
  html = html.substring(0, styleClose) + cssAdd + '\n  ' + html.substring(styleClose);
  log.push('✅ CSS added');
} else {
  log.push('❌ CSS anchor not found');
}

// ============================================================
// 2. TAMBAH HTML (after Notes section)
// ============================================================
const notesAnchor = `            <textarea id="sig-notes" rows="3" placeholder="Plan buy on retrace D1..."></textarea>
          </div>
        </div>`;

const imageHTML = `            <textarea id="sig-notes" rows="3" placeholder="Plan buy on retrace D1..."></textarea>
          </div>
        </div>

        <div class="signal-form-section">
          <div class="signal-form-section-title">Chart Image (optional)</div>
          <div class="signal-image-upload-area" id="sigImageArea" onclick="document.getElementById('sigImageInput').click()">
            <div class="icon">📸</div>
            <div class="text" id="sigImageText">Klik untuk pilih gambar chart</div>
            <div class="hint">PNG · JPG · WEBP · Max 5MB</div>
          </div>
          <input type="file" id="sigImageInput" accept="image/png,image/jpeg,image/jpg,image/webp" style="display: none;">
          <div class="signal-image-preview" id="sigImagePreview" style="display: none;">
            <img id="sigImagePreviewImg" src="" alt="Preview">
            <button class="remove-img" type="button" onclick="removeSignalImage()">🗑️ Hapus Gambar</button>
          </div>
        </div>`;

if (html.includes(notesAnchor)) {
  html = html.replace(notesAnchor, imageHTML);
  log.push('✅ HTML added');
} else {
  log.push('❌ Notes anchor not found');
}

// ============================================================
// 3. TAMBAH JS (before loadSettings())
// ============================================================
const jsAdd = `
    // ============================================================
    // SIGNAL IMAGE UPLOAD
    // ============================================================
    let currentSignalImage = { url: null, path: null };

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) { resolve(e.target.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    window.removeSignalImage = function() {
      const input = document.getElementById('sigImageInput');
      const area = document.getElementById('sigImageArea');
      const text = document.getElementById('sigImageText');
      const preview = document.getElementById('sigImagePreview');
      if (input) input.value = '';
      if (preview) preview.style.display = 'none';
      if (area) area.classList.remove('has-file');
      if (text) text.textContent = 'Klik untuk pilih gambar chart';
      currentSignalImage = { url: null, path: null };
    };

    (function initImageUpload() {
      const input = document.getElementById('sigImageInput');
      const area = document.getElementById('sigImageArea');
      const text = document.getElementById('sigImageText');
      const preview = document.getElementById('sigImagePreview');
      const previewImg = document.getElementById('sigImagePreviewImg');
      if (!input || !area) return;

      input.addEventListener('change', async function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        
        if (file.size > 5 * 1024 * 1024) {
          alert('Gambar max 5MB. File Anda: ' + (file.size/1024/1024).toFixed(1) + 'MB');
          input.value = '';
          return;
        }
        
        const reader = new FileReader();
        reader.onload = function(ev) {
          previewImg.src = ev.target.result;
          preview.style.display = 'block';
          area.classList.add('has-file');
          text.textContent = '⏳ Mengupload...';
        };
        reader.readAsDataURL(file);
        
        try {
          const base64 = await fileToBase64(file);
          const res = await adminFetch('/api/admin/signals/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, filename: file.name })
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || 'Upload gagal');
          
          currentSignalImage.url = data.url;
          currentSignalImage.path = data.path;
          text.textContent = '✅ ' + file.name + ' (' + (file.size/1024).toFixed(1) + ' KB)';
          addLog('✅ Image uploaded: ' + file.name, 'success');
        } catch (err) {
          alert('Upload gagal: ' + err.message);
          window.removeSignalImage();
        }
      });
    })();
`;

const jsAnchor = '    loadSettings();';
if (html.includes(jsAnchor)) {
  html = html.replace(jsAnchor, jsAdd + '\n\n' + jsAnchor);
  log.push('✅ JS added');
} else {
  log.push('❌ JS anchor not found');
}

// ============================================================
// 4. MODIFY createSignal() — include image_url
// ============================================================
const createAnchor = `        notes: document.getElementById('sig-notes').value.trim() || null
      };`;

const createNew = `        notes: document.getElementById('sig-notes').value.trim() || null,
        image_url: currentSignalImage.url || null
      };`;

if (html.includes(createAnchor)) {
  html = html.replace(createAnchor, createNew);
  log.push('✅ createSignal updated');
} else {
  log.push('❌ createSignal anchor not found');
}

// ============================================================
// 5. MODIFY reset after create — clear image
// ============================================================
const resetAnchor = `          if (window.resetTickerAutocomplete) window.resetTickerAutocomplete();`;
const resetNew = `          if (window.resetTickerAutocomplete) window.resetTickerAutocomplete();
          if (window.removeSignalImage) window.removeSignalImage();`;

if (html.includes(resetAnchor) && !html.includes('removeSignalImage()')) {
  html = html.replace(resetAnchor, resetNew);
  log.push('✅ Reset added after create');
} else if (html.includes('removeSignalImage()')) {
  log.push('⚠️ Reset already exists');
} else {
  log.push('❌ Reset anchor not found');
}

// SAVE
fs.writeFileSync(FILE, html, 'utf8');
console.log('=== PATCH REPORT ===');
log.forEach(l => console.log(l));
console.log('');
console.log('🎉 Refresh browser: http://localhost:3000/admin.html');
