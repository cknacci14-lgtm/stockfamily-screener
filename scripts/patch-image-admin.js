const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'admin.html');
const BACKUP = FILE + '.bak-image-input-' + Date.now();

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));

let html = fs.readFileSync(FILE, 'utf8');

// === 1. Tambah CSS untuk image preview ===
const cssAdd = `
    .signal-image-preview { margin-top: 10px; display: none; }
    .signal-image-preview.show { display: block; }
    .signal-image-preview img { max-width: 100%; max-height: 300px; border-radius: 8px; border: 1px solid #2a2f3e; }
    .signal-image-preview .remove-img { margin-top: 6px; padding: 4px 10px; font-size: 11px; background: #7f1d1d; color: #fca5a5; border: 1px solid #dc2626; border-radius: 4px; cursor: pointer; }
    .signal-image-preview .remove-img:hover { background: #dc2626; color: #fff; }
    .signal-image-upload-area { padding: 20px; border: 2px dashed #2a2f3e; border-radius: 8px; text-align: center; cursor: pointer; transition: 0.15s; margin-top: 6px; }
    .signal-image-upload-area:hover { border-color: #f7971e; background: rgba(247,151,30,0.05); }
    .signal-image-upload-area.has-file { border-color: #10b981; }
    .signal-image-upload-area .icon { font-size: 32px; color: #4b5563; margin-bottom: 8px; }
    .signal-image-upload-area .text { font-size: 12px; color: #9ca3af; }
    .signal-image-upload-area .hint { font-size: 10px; color: #6b7280; margin-top: 4px; }
`;

const styleCloseIdx = html.indexOf('</style>');
if (styleCloseIdx > 0) {
  html = html.substring(0, styleCloseIdx) + cssAdd + '\n  ' + html.substring(styleCloseIdx);
  console.log('✅ CSS ditambahkan');
}

// === 2. Tambah file input setelah Notes ===
const notesOld = `        <div class="signal-form-section">
          <div class="signal-form-section-title">Notes</div>
          <div class="signal-form-group">
            <textarea id="sig-notes" rows="3" placeholder="Plan buy on retrace D1..."></textarea>
          </div>
        </div>`;

const notesNew = `        <div class="signal-form-section">
          <div class="signal-form-section-title">Notes</div>
          <div class="signal-form-group">
            <textarea id="sig-notes" rows="3" placeholder="Plan buy on retrace D1..."></textarea>
          </div>
        </div>

        <div class="signal-form-section">
          <div class="signal-form-section-title">Chart Image (optional)</div>
          <div class="signal-image-upload-area" id="sigImageArea" onclick="document.getElementById('sigImageInput').click()">
            <div class="icon"><i class="fa-solid fa-image"></i></div>
            <div class="text">Klik untuk pilih gambar chart</div>
            <div class="hint">PNG / JPG / WEBP · Max 5MB</div>
          </div>
          <input type="file" id="sigImageInput" accept="image/png,image/jpeg,image/jpg,image/webp" style="display: none;">
          <div class="signal-image-preview" id="sigImagePreview">
            <img id="sigImagePreviewImg" src="">
            <button class="remove-img" onclick="removeSignalImage()">🗑️ Hapus Gambar</button>
          </div>
        </div>`;

if (html.includes(notesOld)) {
  html = html.replace(notesOld, notesNew);
  console.log('✅ File input HTML ditambahkan');
} else {
  console.log('❌ Notes section tidak match');
}

// === 3. Tambah JS logic ===
const jsAdd = `
    // ============================================================
    // SIGNAL IMAGE UPLOAD
    // ============================================================
    let currentImageUrl = null;
    let currentImagePath = null;

    (function() {
      const input = document.getElementById('sigImageInput');
      const area = document.getElementById('sigImageArea');
      const preview = document.getElementById('sigImagePreview');
      const previewImg = document.getElementById('sigImagePreviewImg');
      if (!input) return;

      input.addEventListener('change', async function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        
        if (file.size > 5 * 1024 * 1024) {
          alert('Gambar max 5MB');
          input.value = '';
          return;
        }
        
        // Show local preview immediately
        const reader = new FileReader();
        reader.onload = function(ev) {
          previewImg.src = ev.target.result;
          preview.classList.add('show');
          area.classList.add('has-file');
          area.querySelector('.text').textContent = '⏳ Mengupload...';
        };
        reader.readAsDataURL(file);
        
        // Upload to server
        try {
          const base64 = await fileToBase64(file);
          const res = await adminFetch('/api/admin/signals/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, filename: file.name })
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error);
          
          currentImageUrl = data.url;
          currentImagePath = data.path;
          area.querySelector('.text').textContent = '✅ ' + file.name + ' (' + (file.size/1024).toFixed(1) + ' KB)';
          addLog('✅ Image uploaded: ' + file.name, 'success');
        } catch (err) {
          alert('Upload gagal: ' + err.message);
          removeSignalImage();
        }
      });
    })();

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) { resolve(e.target.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function removeSignalImage() {
      const input = document.getElementById('sigImageInput');
      const area = document.getElementById('sigImageArea');
      const preview = document.getElementById('sigImagePreview');
      if (input) input.value = '';
      if (preview) preview.classList.remove('show');
      if (area) {
        area.classList.remove('has-file');
        area.querySelector('.text').textContent = 'Klik untuk pilih gambar chart';
      }
      currentImageUrl = null;
      currentImagePath = null;
    }
`;

// Insert before "loadSettings();"
const jsAnchor = '    loadSettings();';
if (html.includes(jsAnchor)) {
  html = html.replace(jsAnchor, jsAdd + '\n\n' + jsAnchor);
  console.log('✅ JS logic ditambahkan');
}

// === 4. Update createSignal() untuk include image_url ===
const createOld = `        notes: document.getElementById('sig-notes').value.trim() || null
      };`;

const createNew = `        notes: document.getElementById('sig-notes').value.trim() || null,
        image_url: currentImageUrl || null
      };`;

if (html.includes(createOld)) {
  html = html.replace(createOld, createNew);
  console.log('✅ createSignal include image_url');
}

// === 5. Reset image setelah create sukses ===
const resetOld = `          if (window.resetTickerAutocomplete) window.resetTickerAutocomplete();`;
const resetNew = `          if (window.resetTickerAutocomplete) window.resetTickerAutocomplete();
          if (window.removeSignalImage) window.removeSignalImage();`;
if (html.includes(resetOld) && !html.includes('removeSignalImage()')) {
  html = html.replace(resetOld, resetNew);
  console.log('✅ Reset image after create');
}

// Expose removeSignalImage ke window
html = html.replace('function removeSignalImage() {', 'window.removeSignalImage = function() {');

fs.writeFileSync(FILE, html, 'utf8');
console.log('');
console.log('🎉 Patch admin.html selesai!');
