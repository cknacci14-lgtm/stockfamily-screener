// ============================================================
// PATCH: Admin Signals Tab + Fix Mojibake
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'admin.html');
const BACKUP = FILE + '.bak-signals-tab-' + Date.now();

if (!fs.existsSync(FILE)) {
  console.error('❌ File tidak ditemukan:', FILE);
  process.exit(1);
}

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));
console.log('');

let html = fs.readFileSync(FILE, 'utf8');
const log = [];

// ============================================================
// 1. FIX MOJIBAKE
// ============================================================
const mojibakeFixes = [
  ['âš™ï¸', '⚙️'],
  ['ðŸ“ˆ', '📈'],
  ['ðŸ“Š', '📊'],
  ['ðŸ“¡', '📡'],
  ['ðŸ“¤', '📤'],
  ['ðŸ“‹', '📋'],
  ['ðŸ”„', '🔄'],
  ['ðŸ—‘ï¸', '🗑️'],
  ['â—', '●'],
  ['<span class="icon">ðŸ </span>', '<span class="icon">🏠</span>'],
  ['<span class="icon">â</span>', '<span class="icon">⭐</span>'],
];

let fixCount = 0;
mojibakeFixes.forEach(([from, to]) => {
  if (html.includes(from)) {
    html = html.split(from).join(to);
    fixCount++;
  }
});
log.push(`✅ Fixed ${fixCount} mojibake patterns`);

// ============================================================
// 2. ADD CSS
// ============================================================
const tabCSS = `
    /* === Admin Tabs === */
    .admin-tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid #2a2f3e; }
    .admin-tab { background: transparent; border: none; color: #9ca3af; padding: 12px 22px; font-size: 14px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; font-family: inherit; }
    .admin-tab:hover { color: #fff; background: rgba(255,255,255,0.03); }
    .admin-tab.active { color: #f7971e; border-bottom-color: #f7971e; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .signal-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .signal-form-group label { display: block; font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 600; }
    .signal-form-group input, .signal-form-group select, .signal-form-group textarea { width: 100%; background: #0a0e17; border: 1px solid #2a2f3e; color: #e0e0e0; padding: 8px 12px; border-radius: 6px; font-family: inherit; font-size: 13px; box-sizing: border-box; }
    .signal-form-group input:focus, .signal-form-group select:focus, .signal-form-group textarea:focus { outline: none; border-color: #f7971e; }
    .signal-form-section { margin-bottom: 16px; padding: 12px; background: #0a0e17; border: 1px solid #2a2f3e; border-radius: 8px; }
    .signal-form-section-title { font-size: 11px; color: #f7971e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; font-weight: 700; }
    .signal-preview { display: flex; gap: 24px; padding: 10px 14px; background: #0a0e17; border: 1px solid #2a2f3e; border-radius: 6px; font-size: 12px; margin-bottom: 12px; }
    .signal-preview-item { display: flex; flex-direction: column; }
    .signal-preview-label { font-size: 10px; color: #6b7280; text-transform: uppercase; }
    .signal-preview-value { font-weight: 700; color: #f7971e; font-family: 'SF Mono', monospace; }
    .signal-list-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .signal-list-table th { text-align: left; padding: 10px 8px; color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #2a2f3e; font-weight: 600; }
    .signal-list-table td { padding: 10px 8px; border-bottom: 1px solid #1e222d; }
    .signal-list-table tr:hover td { background: rgba(255,255,255,0.02); }
    .signal-status-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .signal-status-badge.draft { background: #374151; color: #d1d5db; }
    .signal-status-badge.published { background: #1e3a5f; color: #60a5fa; }
    .signal-status-badge.active { background: #14532d; color: #86efac; }
    .signal-status-badge.closed { background: #4c1d95; color: #c4b5fd; }
    .signal-status-badge.tp1, .signal-status-badge.tp2, .signal-status-badge.tp3 { background: #14532d; color: #86efac; }
    .signal-status-badge.sl { background: #7f1d1d; color: #fca5a5; }
    .signal-action-btn { padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; border: 1px solid; margin-right: 4px; font-family: inherit; }
    .signal-action-btn.publish { background: #1e3a5f; border-color: #3b82f6; color: #60a5fa; }
    .signal-action-btn.publish:hover { background: #1e40af; color: #fff; }
    .signal-action-btn.delete { background: #7f1d1d22; border-color: #dc2626; color: #ef4444; }
    .signal-action-btn.delete:hover { background: #dc2626; color: #fff; }
    .signal-empty { text-align: center; padding: 30px; color: #6b7280; font-style: italic; }
`;

const styleCloseIdx = html.indexOf('</style>');
if (styleCloseIdx > 0) {
  html = html.substring(0, styleCloseIdx) + tabCSS + '\n  ' + html.substring(styleCloseIdx);
  log.push('✅ Tab CSS added');
}

// ============================================================
// 3. INSERT TAB NAV + WRAP DASHBOARD
// ============================================================
const h1Anchor = '<h1 style="margin-bottom:20px;">⚙️ Admin Panel</h1>';
if (!html.includes(h1Anchor)) {
  console.error('❌ H1 anchor not found');
  process.exit(1);
}

const tabNav = h1Anchor + `

    <!-- Admin Tabs -->
    <div class="admin-tabs">
      <button class="admin-tab active" data-tab="dashboard" onclick="switchAdminTab('dashboard')">📊 Dashboard</button>
      <button class="admin-tab" data-tab="signals" onclick="switchAdminTab('signals')">🎯 Signals</button>
    </div>

    <!-- Tab: Dashboard -->
    <div id="tab-dashboard" class="tab-panel active">`;

html = html.replace(h1Anchor, tabNav);
log.push('✅ Tab nav inserted');

// ============================================================
// 4. INSERT SIGNALS TAB BEFORE .main CLOSES
// ============================================================
// Find close of .main = last `  </div>` before first `<script>` after body
const bodyIdx = html.indexOf('<body>');
const mainStart = html.indexOf('<div class="main">', bodyIdx);
const firstScriptAfterMain = html.indexOf('<script>', mainStart);

if (firstScriptAfterMain < 0) {
  console.error('❌ First script not found');
  process.exit(1);
}

const beforeScript = html.substring(0, firstScriptAfterMain);
const lastMainCloseIdx = beforeScript.lastIndexOf('\n  </div>');

if (lastMainCloseIdx < 0) {
  console.error('❌ .main close not found');
  process.exit(1);
}

const signalsTabHTML = `    </div> <!-- /tab-dashboard -->

    <!-- Tab: Signals -->
    <div id="tab-signals" class="tab-panel">

      <!-- Create Signal Form -->
      <div class="admin-card">
        <h2>🎯 Create New Signal</h2>

        <div class="signal-form-section">
          <div class="signal-form-section-title">Basic Info</div>
          <div class="signal-form-grid">
            <div class="signal-form-group">
              <label>Ticker</label>
              <input type="text" id="sig-ticker" placeholder="ESIP" style="text-transform:uppercase;">
            </div>
            <div class="signal-form-group">
              <label>Timeframe</label>
              <select id="sig-timeframe">
                <option value="D1">D1 (Daily)</option>
                <option value="H1">H1 (1 Hour)</option>
                <option value="W1">W1 (Weekly)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="signal-form-section">
          <div class="signal-form-section-title">Entry Positions (Weighted)</div>
          <div class="signal-form-grid">
            <div class="signal-form-group">
              <label>Entry 1</label>
              <input type="number" id="sig-entry1" placeholder="1700" step="any">
            </div>
            <div class="signal-form-group">
              <label>Weight 1 (%)</label>
              <input type="number" id="sig-weight1" value="30" min="0" max="100">
            </div>
            <div class="signal-form-group">
              <label>Entry 2</label>
              <input type="number" id="sig-entry2" placeholder="1680" step="any">
            </div>
            <div class="signal-form-group">
              <label>Weight 2 (%)</label>
              <input type="number" id="sig-weight2" value="30" min="0" max="100">
            </div>
            <div class="signal-form-group">
              <label>Entry 3</label>
              <input type="number" id="sig-entry3" placeholder="1660" step="any">
            </div>
            <div class="signal-form-group">
              <label>Weight 3 (%)</label>
              <input type="number" id="sig-weight3" value="40" min="0" max="100">
            </div>
          </div>
        </div>

        <div class="signal-form-section">
          <div class="signal-form-section-title">Risk & Reward</div>
          <div class="signal-form-grid">
            <div class="signal-form-group">
              <label>Stop Loss</label>
              <input type="number" id="sig-sl" placeholder="1600" step="any">
            </div>
            <div class="signal-form-group">
              <label>Target 1</label>
              <input type="number" id="sig-tp1" placeholder="1780" step="any">
            </div>
            <div class="signal-form-group">
              <label>Target 2</label>
              <input type="number" id="sig-tp2" placeholder="1850" step="any">
            </div>
            <div class="signal-form-group">
              <label>Target 3</label>
              <input type="number" id="sig-tp3" placeholder="1950" step="any">
            </div>
          </div>
        </div>

        <div class="signal-form-section">
          <div class="signal-form-section-title">Notes</div>
          <div class="signal-form-group">
            <textarea id="sig-notes" rows="3" placeholder="Plan buy on retrace D1..."></textarea>
          </div>
        </div>

        <div class="signal-preview">
          <div class="signal-preview-item">
            <span class="signal-preview-label">Entry Avg</span>
            <span class="signal-preview-value" id="preview-entry-avg">—</span>
          </div>
          <div class="signal-preview-item">
            <span class="signal-preview-label">Risk / Reward</span>
            <span class="signal-preview-value" id="preview-rr">—</span>
          </div>
        </div>

        <button class="btn" onclick="createSignal()" id="createSignalBtn">💾 Save Draft</button>
      </div>

      <div class="admin-card">
        <h2>📋 Signals List</h2>
        <div id="signalsListContainer">
          <div class="signal-empty">Loading...</div>
        </div>
      </div>

    </div> <!-- /tab-signals -->
`;

html = html.substring(0, lastMainCloseIdx) + '\n' + signalsTabHTML + html.substring(lastMainCloseIdx + '\n  </div>'.length);
log.push('✅ Signals tab inserted');

// ============================================================
// 5. ADD JS FUNCTIONS
// ============================================================
const jsCode = `
    // ============================================================
    // ADMIN TABS
    // ============================================================
    function switchAdminTab(tabName) {
      document.querySelectorAll('.admin-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
      });
      document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.toggle('active', p.id === 'tab-' + tabName);
      });
      if (tabName === 'signals') loadSignalsList();
    }

    // ============================================================
    // SIGNAL MANAGEMENT
    // ============================================================
    function calcEntryAvgFromForm() {
      const e1 = parseFloat(document.getElementById('sig-entry1').value) || 0;
      const e2 = parseFloat(document.getElementById('sig-entry2').value) || 0;
      const e3 = parseFloat(document.getElementById('sig-entry3').value) || 0;
      const w1 = parseInt(document.getElementById('sig-weight1').value) || 0;
      const w2 = parseInt(document.getElementById('sig-weight2').value) || 0;
      const w3 = parseInt(document.getElementById('sig-weight3').value) || 0;
      const items = [{p:e1,w:w1},{p:e2,w:w2},{p:e3,w:w3}].filter(x => x.p > 0 && x.w > 0);
      if (!items.length) return null;
      const totalW = items.reduce((s,x) => s+x.w, 0);
      const sum = items.reduce((s,x) => s+x.p*x.w, 0);
      return totalW > 0 ? sum/totalW : null;
    }

    function updateSignalPreview() {
      const avg = calcEntryAvgFromForm();
      const sl = parseFloat(document.getElementById('sig-sl').value);
      const tp1 = parseFloat(document.getElementById('sig-tp1').value);
      const avgEl = document.getElementById('preview-entry-avg');
      const rrEl = document.getElementById('preview-rr');
      avgEl.textContent = avg ? 'Rp ' + avg.toLocaleString('id-ID',{maximumFractionDigits:2}) : '—';
      if (avg && sl && tp1 && sl < avg && tp1 > avg) {
        rrEl.textContent = ((tp1-avg)/(avg-sl)).toFixed(2) + ' R';
      } else {
        rrEl.textContent = '—';
      }
    }

    async function createSignal() {
      const btn = document.getElementById('createSignalBtn');
      const payload = {
        ticker: document.getElementById('sig-ticker').value.trim().toUpperCase(),
        timeframe: document.getElementById('sig-timeframe').value,
        entry_1: parseFloat(document.getElementById('sig-entry1').value) || null,
        entry_2: parseFloat(document.getElementById('sig-entry2').value) || null,
        entry_3: parseFloat(document.getElementById('sig-entry3').value) || null,
        entry_1_pct: parseInt(document.getElementById('sig-weight1').value) || 30,
        entry_2_pct: parseInt(document.getElementById('sig-weight2').value) || 30,
        entry_3_pct: parseInt(document.getElementById('sig-weight3').value) || 40,
        stop_loss: parseFloat(document.getElementById('sig-sl').value) || null,
        target_1: parseFloat(document.getElementById('sig-tp1').value) || null,
        target_2: parseFloat(document.getElementById('sig-tp2').value) || null,
        target_3: parseFloat(document.getElementById('sig-tp3').value) || null,
        notes: document.getElementById('sig-notes').value.trim() || null
      };
      if (!payload.ticker) return addLog('❌ Ticker wajib', 'error');
      if (!payload.entry_1) return addLog('❌ Entry 1 wajib', 'error');
      if (!payload.stop_loss) return addLog('❌ SL wajib', 'error');
      if (!payload.target_1) return addLog('❌ TP1 wajib', 'error');
      btn.disabled = true;
      btn.textContent = '⏳ Saving...';
      try {
        const res = await adminFetch('/api/admin/signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.success) {
          addLog('❌ ' + data.error, 'error');
        } else {
          addLog('✅ Signal created: ' + data.signal.ticker + ' (DRAFT)', 'success');
          ['sig-ticker','sig-entry1','sig-entry2','sig-entry3','sig-sl','sig-tp1','sig-tp2','sig-tp3','sig-notes'].forEach(id => document.getElementById(id).value = '');
          document.getElementById('sig-weight1').value = 30;
          document.getElementById('sig-weight2').value = 30;
          document.getElementById('sig-weight3').value = 40;
          updateSignalPreview();
          loadSignalsList();
        }
      } catch (err) {
        addLog('❌ ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Save Draft';
      }
    }

    async function loadSignalsList() {
      const container = document.getElementById('signalsListContainer');
      if (!container) return;
      container.innerHTML = '<div class="signal-empty">Loading...</div>';
      try {
        const res = await adminFetch('/api/admin/signals');
        const data = await res.json();
        if (!data.success || !data.signals.length) {
          container.innerHTML = '<div class="signal-empty">Belum ada signal. Buat signal pertama di atas.</div>';
          return;
        }
        const rows = data.signals.map(s => {
          const statusClass = (s.status || 'draft').toLowerCase();
          const outcomeClass = (s.outcome || '').toLowerCase();
          const dateStr = s.created_at ? new Date(s.created_at).toLocaleDateString('id-ID',{day:'2-digit',month:'short'}) : '—';
          return '<tr>' +
            '<td><strong>' + s.ticker + '</strong></td>' +
            '<td>' + (s.timeframe||'—') + '</td>' +
            '<td>' + (s.entry_avg ? 'Rp '+Number(s.entry_avg).toLocaleString('id-ID') : '—') + '</td>' +
            '<td>' + (s.stop_loss ? Number(s.stop_loss).toLocaleString('id-ID') : '—') + '</td>' +
            '<td>' + (s.target_1 ? Number(s.target_1).toLocaleString('id-ID') : '—') + '</td>' +
            '<td>' + (s.risk_reward ? Number(s.risk_reward).toFixed(2)+'R' : '—') + '</td>' +
            '<td><span class="signal-status-badge ' + statusClass + '">' + s.status + '</span></td>' +
            '<td>' + (s.outcome ? '<span class="signal-status-badge ' + outcomeClass + '">' + s.outcome + '</span>' : '—') + '</td>' +
            '<td>' + dateStr + '</td>' +
            '<td>' +
              (s.status === 'DRAFT' ? '<button class="signal-action-btn publish" onclick="publishSignal(' + s.id + ')">Publish</button>' : '') +
              (s.status === 'DRAFT' ? '<button class="signal-action-btn delete" onclick="deleteSignal(' + s.id + ')">Delete</button>' : '') +
            '</td>' +
          '</tr>';
        }).join('');
        container.innerHTML = '<table class="signal-list-table"><thead><tr><th>Ticker</th><th>TF</th><th>Entry Avg</th><th>SL</th><th>TP1</th><th>RR</th><th>Status</th><th>Outcome</th><th>Created</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table>';
      } catch (err) {
        container.innerHTML = '<div class="signal-empty">Error: ' + err.message + '</div>';
      }
    }

    async function publishSignal(id) {
      if (!confirm('Publish signal ini?')) return;
      try {
        const res = await adminFetch('/api/admin/signals/'+id+'/publish', { method: 'POST' });
        const data = await res.json();
        if (!data.success) return addLog('❌ ' + data.error, 'error');
        addLog('✅ Signal published!', 'success');
        loadSignalsList();
      } catch (err) { addLog('❌ ' + err.message, 'error'); }
    }

    async function deleteSignal(id) {
      if (!confirm('Hapus signal ini?')) return;
      try {
        const res = await adminFetch('/api/admin/signals/'+id, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) return addLog('❌ ' + data.error, 'error');
        addLog('🗑️ Signal deleted', 'info');
        loadSignalsList();
      } catch (err) { addLog('❌ ' + err.message, 'error'); }
    }

    ['sig-entry1','sig-entry2','sig-entry3','sig-weight1','sig-weight2','sig-weight3','sig-sl','sig-tp1'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateSignalPreview);
    });
`;

const jsAnchor = '    loadSettings();';
if (html.includes(jsAnchor)) {
  html = html.replace(jsAnchor, jsCode + '\n\n' + jsAnchor);
  log.push('✅ JS functions inserted');
} else {
  console.error('❌ JS anchor not found');
  process.exit(1);
}

// SAVE
fs.writeFileSync(FILE, html, 'utf8');

console.log('=== PATCH REPORT ===');
log.forEach(l => console.log(l));
console.log('');
console.log('🎉 Selesai! Refresh: http://localhost:3000/admin.html');
