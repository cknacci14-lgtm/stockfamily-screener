// ============================================================
// PATCH: Ticker Autocomplete
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'admin.html');
const BACKUP = FILE + '.bak-autocomplete-' + Date.now();

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
// 1. Tambah CSS untuk autocomplete
// ============================================================
const cssAdd = `
    /* === Ticker Autocomplete === */
    .ticker-wrap { position: relative; }
    .ticker-dropdown { position: absolute; top: 100%; left: 0; right: 0; background: #0a0e17; border: 1px solid #f7971e; border-top: none; border-radius: 0 0 6px 6px; max-height: 250px; overflow-y: auto; z-index: 1000; display: none; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    .ticker-dropdown.show { display: block; }
    .ticker-option { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #1e222d; display: flex; justify-content: space-between; align-items: center; transition: background 0.1s; }
    .ticker-option:last-child { border-bottom: none; }
    .ticker-option:hover, .ticker-option.active { background: rgba(247,151,30,0.12); }
    .ticker-option .t-code { font-weight: 700; color: #f7971e; font-family: 'SF Mono', monospace; font-size: 13px; }
    .ticker-option .t-name { font-size: 11px; color: #9ca3af; margin-left: 12px; flex: 1; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ticker-option .t-name mark { background: rgba(247,151,30,0.3); color: #f7971e; padding: 0 2px; border-radius: 2px; }
    .ticker-name-badge { display: block; margin-top: 6px; font-size: 11px; color: #10b981; font-weight: 600; }
    .ticker-loading { padding: 10px 12px; color: #6b7280; font-size: 11px; font-style: italic; text-align: center; }
    .ticker-empty { padding: 12px; color: #6b7280; font-size: 11px; font-style: italic; text-align: center; }
`;

const styleCloseIdx = html.indexOf('</style>');
if (styleCloseIdx > 0) {
  html = html.substring(0, styleCloseIdx) + cssAdd + '\n  ' + html.substring(styleCloseIdx);
  log.push('✅ CSS added');
}

// ============================================================
// 2. Wrap ticker input dengan dropdown container
// ============================================================
const tickerOld = `            <div class="signal-form-group">
              <label>Ticker</label>
              <input type="text" id="sig-ticker" placeholder="ESIP" style="text-transform:uppercase;">
            </div>`;

const tickerNew = `            <div class="signal-form-group ticker-wrap">
              <label>Ticker</label>
              <input type="text" id="sig-ticker" placeholder="Ketik kode saham..." autocomplete="off" style="text-transform:uppercase;">
              <div id="tickerDropdown" class="ticker-dropdown"></div>
              <span id="tickerNameBadge" class="ticker-name-badge" style="display:none;"></span>
            </div>`;

patch('Ticker HTML with dropdown', tickerOld, tickerNew);

// ============================================================
// 3. Tambah JS untuk autocomplete
// ============================================================
const jsAdd = `
    // ============================================================
    // TICKER AUTOCOMPLETE
    // ============================================================
    (function() {
      const tickerInput = document.getElementById('sig-ticker');
      const dropdown = document.getElementById('tickerDropdown');
      const nameBadge = document.getElementById('tickerNameBadge');
      if (!tickerInput || !dropdown) return;

      let debounceTimer = null;
      let currentResults = [];
      let activeIdx = -1;

      function highlightMatch(text, query) {
        if (!query) return text;
        const idx = text.toUpperCase().indexOf(query.toUpperCase());
        if (idx < 0) return text;
        return text.substring(0, idx) + '<mark>' + text.substring(idx, idx + query.length) + '</mark>' + text.substring(idx + query.length);
      }

      function renderDropdown(results, query) {
        if (!results.length) {
          dropdown.innerHTML = '<div class="ticker-empty">Tidak ada hasil untuk "' + query + '"</div>';
          dropdown.classList.add('show');
          return;
        }
        dropdown.innerHTML = results.map((r, i) =>
          '<div class="ticker-option" data-idx="' + i + '" data-code="' + r.code + '" data-name="' + (r.name || '').replace(/"/g, '&quot;') + '">' +
            '<span class="t-code">' + highlightMatch(r.code, query) + '</span>' +
            '<span class="t-name">' + highlightMatch(r.name || '', query) + '</span>' +
          '</div>'
        ).join('');
        dropdown.classList.add('show');
        activeIdx = -1;

        // Attach click handlers
        dropdown.querySelectorAll('.ticker-option').forEach(opt => {
          opt.addEventListener('click', () => selectTicker(opt));
        });
      }

      function selectTicker(opt) {
        const code = opt.getAttribute('data-code');
        const name = opt.getAttribute('data-name');
        tickerInput.value = code;
        nameBadge.textContent = '✓ ' + name;
        nameBadge.style.display = 'block';
        dropdown.classList.remove('show');
        tickerInput.dataset.selectedCode = code;
        tickerInput.dataset.selectedName = name;
      }

      function clearSelection() {
        nameBadge.style.display = 'none';
        nameBadge.textContent = '';
        delete tickerInput.dataset.selectedCode;
        delete tickerInput.dataset.selectedName;
      }

      async function searchTicker(q) {
        if (q.length < 1) {
          dropdown.classList.remove('show');
          return;
        }
        dropdown.innerHTML = '<div class="ticker-loading">Mencari...</div>';
        dropdown.classList.add('show');
        try {
          const res = await fetch('/api/public/search?q=' + encodeURIComponent(q));
          const data = await res.json();
          if (data.success && data.results) {
            currentResults = data.results;
            renderDropdown(data.results, q);
          } else {
            dropdown.innerHTML = '<div class="ticker-empty">Tidak ada hasil</div>';
          }
        } catch (err) {
          console.error('Ticker search error:', err);
          dropdown.innerHTML = '<div class="ticker-empty">Error: ' + err.message + '</div>';
        }
      }

      tickerInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const q = e.target.value.trim().toUpperCase();
        clearSelection();
        if (!q) {
          dropdown.classList.remove('show');
          return;
        }
        debounceTimer = setTimeout(() => searchTicker(q), 250);
      });

      // Arrow key navigation
      tickerInput.addEventListener('keydown', (e) => {
        const opts = dropdown.querySelectorAll('.ticker-option');
        if (!opts.length || !dropdown.classList.contains('show')) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIdx = Math.min(activeIdx + 1, opts.length - 1);
          opts.forEach((o, i) => o.classList.toggle('active', i === activeIdx));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIdx = Math.max(activeIdx - 1, 0);
          opts.forEach((o, i) => o.classList.toggle('active', i === activeIdx));
        } else if (e.key === 'Enter' && activeIdx >= 0) {
          e.preventDefault();
          selectTicker(opts[activeIdx]);
        } else if (e.key === 'Escape') {
          dropdown.classList.remove('show');
        }
      });

      // Close on click outside
      document.addEventListener('click', (e) => {
        if (!tickerInput.contains(e.target) && !dropdown.contains(e.target)) {
          dropdown.classList.remove('show');
        }
      });

      // Reset on create success (dipanggil dari createSignal)
      window.resetTickerAutocomplete = function() {
        tickerInput.value = '';
        clearSelection();
        dropdown.classList.remove('show');
      };
    })();
`;

// Insert sebelum "loadSettings();"
const jsAnchor = '    loadSettings();';
if (html.includes(jsAnchor)) {
  html = html.replace(jsAnchor, jsAdd + '\n\n' + jsAnchor);
  log.push('✅ Autocomplete JS added');
}

// ============================================================
// 4. Update createSignal() — reset autocomplete setelah sukses
// ============================================================
const createAnchor = `          addLog('✅ Signal created: ' + data.signal.ticker + ' (DRAFT)', 'success');
          ['sig-ticker','sig-entry1','sig-entry2','sig-entry3','sig-sl','sig-tp1','sig-tp2','sig-tp3','sig-notes'].forEach(id => document.getElementById(id).value = '');`;

const createReplace = `          addLog('✅ Signal created: ' + data.signal.ticker + ' (DRAFT)', 'success');
          ['sig-entry1','sig-entry2','sig-entry3','sig-sl','sig-tp1','sig-tp2','sig-tp3','sig-notes'].forEach(id => document.getElementById(id).value = '');
          if (window.resetTickerAutocomplete) window.resetTickerAutocomplete();`;

if (html.includes(createAnchor)) {
  html = html.replace(createAnchor, createReplace);
  log.push('✅ createSignal reset autocomplete');
}

// SAVE
fs.writeFileSync(FILE, html, 'utf8');

console.log('=== PATCH REPORT ===');
log.forEach(l => console.log(l));
console.log('');
console.log('🎉 Selesai! Refresh: http://localhost:3000/admin.html');
