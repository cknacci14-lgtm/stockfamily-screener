// ============================================================
// BUILD: Public Signals Page (signals.html)
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'signals.html');

// Backup if exists
if (fs.existsSync(FILE)) {
  const BACKUP = FILE + '.bak-' + Date.now();
  fs.copyFileSync(FILE, BACKUP);
  console.log('📁 Backup:', path.basename(BACKUP));
  console.log('');
}

const html = `<!DOCTYPE html>
<html lang="id" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Signals | CHARTNALIST</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<script>
tailwind.config = { darkMode:'class', theme:{ extend:{ colors:{
  idx:{ bg:'#0B0E14', card:'#131722', panel:'#1E222D', border:'#2A2E39',
        green:'#00E676', red:'#FF5252', amber:'#FFB300', cyan:'#00E5FF', purple:'#A855F7' }}}}}
</script>
<style>
  body { font-family: 'Inter', system-ui, sans-serif; background: #0B0E14; color: #e0e0e0; }
  .mono { font-family: 'JetBrains Mono', Consolas, monospace; }
  
  .signal-card {
    background: #131722;
    border: 1px solid #2A2E39;
    border-radius: 12px;
    padding: 20px 22px;
    margin-bottom: 14px;
    transition: all 0.2s;
    border-left: 4px solid #2A2E39;
  }
  .signal-card:hover { border-color: #00E5FF; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,229,255,0.08); }
  .signal-card.published { border-left-color: #3b82f6; }
  .signal-card.active { border-left-color: #10b981; }
  .signal-card.closed { border-left-color: #8b5cf6; }
  .signal-card.expired { border-left-color: #6b7280; }
  
  .status-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .status-badge.published { background: #1e3a5f; color: #60a5fa; }
  .status-badge.active { background: #14532d; color: #86efac; }
  .status-badge.closed { background: #4c1d95; color: #c4b5fd; }
  .status-badge.expired { background: #374151; color: #d1d5db; }
  .status-badge.tp1, .status-badge.tp2, .status-badge.tp3 { background: #14532d; color: #86efac; }
  .status-badge.sl { background: #7f1d1d; color: #fca5a5; }
  
  .outcome-badge {
    padding: 3px 10px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    margin-left: 6px;
  }
  .outcome-badge.tp1, .outcome-badge.tp2, .outcome-badge.tp3 { background: rgba(16,185,129,0.2); color: #10b981; }
  .outcome-badge.sl { background: rgba(239,68,68,0.2); color: #ef4444; }
  .outcome-badge.mixed { background: rgba(251,191,36,0.2); color: #fbbf24; }
  
  .price-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 16px;
    margin: 16px 0;
    padding: 16px;
    background: #0a0e17;
    border-radius: 8px;
  }
  .price-item { display: flex; flex-direction: column; }
  .price-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 600; }
  .price-value { font-size: 14px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
  .price-value.entry { color: #00E5FF; }
  .price-value.sl { color: #ef4444; }
  .price-value.tp { color: #10b981; }
  
  .progress-bar {
    height: 8px;
    background: #1e222d;
    border-radius: 4px;
    position: relative;
    overflow: hidden;
    margin: 12px 0 6px 0;
  }
  .progress-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.5s;
  }
  .progress-label { font-size: 11px; color: #6b7280; text-align: center; }
  
  .filter-btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid #2A2E39;
    background: #1E222D;
    color: #9ca3af;
  }
  .filter-btn:hover { border-color: #00E5FF; color: #fff; }
  .filter-btn.active { background: rgba(0,229,255,0.15); border-color: #00E5FF; color: #00E5FF; }
  
  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: #6b7280;
  }
  .empty-state i { font-size: 48px; margin-bottom: 16px; opacity: 0.3; }
  
  .loading-spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 2px solid #2A2E39;
    border-top-color: #00E5FF;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  
  @media (max-width: 768px) {
    .price-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 12px; }
    .signal-card { padding: 16px; }
  }
</style>
</head>
<body>

<!-- Sidebar akan di-inject oleh stockfamily-sidebar.js -->

<div class="min-h-screen">
  <!-- Header -->
  <header class="border-b border-idx-border bg-idx-card/80 sticky top-0 z-40 backdrop-blur">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-idx-green to-idx-cyan flex items-center justify-center">
          <i class="fa-solid fa-bullseye text-black"></i>
        </div>
        <div>
          <div class="font-black text-base tracking-wide">CHART<span class="text-idx-cyan">NALIST</span> SIGNALS</div>
          <div class="text-[10px] text-slate-500">LIVE TRADING SIGNALS</div>
        </div>
      </div>
      <button onclick="loadSignals()" class="filter-btn">
        <i class="fa-solid fa-rotate mr-1"></i> Refresh
      </button>
    </div>
  </header>

  <!-- Main -->
  <main class="max-w-5xl mx-auto px-4 py-6">

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div class="p-3 rounded-lg bg-idx-card border border-idx-border">
        <div class="text-[10px] text-slate-500 uppercase mb-1">Total Signals</div>
        <div id="statTotal" class="mono text-2xl font-bold text-idx-cyan">--</div>
      </div>
      <div class="p-3 rounded-lg bg-idx-card border border-idx-border">
        <div class="text-[10px] text-slate-500 uppercase mb-1">Active</div>
        <div id="statActive" class="mono text-2xl font-bold text-idx-green">--</div>
      </div>
      <div class="p-3 rounded-lg bg-idx-card border border-idx-border">
        <div class="text-[10px] text-slate-500 uppercase mb-1">Win Rate</div>
        <div id="statWinRate" class="mono text-2xl font-bold text-idx-amber">--</div>
      </div>
      <div class="p-3 rounded-lg bg-idx-card border border-idx-border">
        <div class="text-[10px] text-slate-500 uppercase mb-1">Updated</div>
        <div id="statUpdated" class="mono text-sm font-bold text-slate-400">--</div>
      </div>
    </div>

    <!-- Filter -->
    <div class="flex flex-wrap gap-2 mb-6">
      <button class="filter-btn active" data-filter="all" onclick="setFilter('all', this)">
        <i class="fa-solid fa-list mr-1"></i> Semua
      </button>
      <button class="filter-btn" data-filter="PUBLISHED" onclick="setFilter('PUBLISHED', this)">
        <i class="fa-solid fa-paper-plane mr-1"></i> Published
      </button>
      <button class="filter-btn" data-filter="ACTIVE" onclick="setFilter('ACTIVE', this)">
        <i class="fa-solid fa-bolt mr-1"></i> Active
      </button>
      <button class="filter-btn" data-filter="TP" onclick="setFilter('TP', this)">
        <i class="fa-solid fa-check mr-1"></i> TP Hit
      </button>
      <button class="filter-btn" data-filter="SL" onclick="setFilter('SL', this)">
        <i class="fa-solid fa-xmark mr-1"></i> SL Hit
      </button>
    </div>

    <!-- Signals list -->
    <div id="signalsList">
      <div class="empty-state">
        <div class="loading-spinner"></div>
        <div class="mt-3">Memuat signals...</div>
      </div>
    </div>

  </main>

  <footer class="max-w-5xl mx-auto px-4 py-6 text-center text-[10px] text-slate-600 border-t border-idx-border mt-8">
    <div class="mb-1">⚠️ Bukan rekomendasi beli/jual. Lakukan analisis sendiri.</div>
    <div>© 2026 CHARTNALIST · Powered by StockFamily</div>
  </footer>
</div>

<script src="/assets/stockfamily-sidebar.js"></script>
<script>
let allSignals = [];
let currentFilter = 'all';

const fmtRp = (n) => n == null ? '—' : 'Rp ' + Number(n).toLocaleString('id-ID');
const fmtRpShort = (n) => {
  if (n == null) return '—';
  n = Number(n);
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return n.toString();
};

function getStatusClass(s) {
  if (s.outcome === 'TP1' || s.outcome === 'TP2' || s.outcome === 'TP3') return 'closed';
  if (s.outcome === 'SL') return 'sl';
  return (s.status || 'draft').toLowerCase();
}

function renderStatusBadge(s) {
  let display = s.status;
  if (s.outcome) display = s.outcome;
  return '<span class="status-badge ' + getStatusClass(s) + '">' + display + '</span>';
}

function computeProgress(s) {
  // Return { pct, label, color }
  if (s.status === 'DRAFT') return { pct: 0, label: 'Draft belum dipublikasi', color: '#6b7280' };
  if (s.outcome === 'TP3') return { pct: 100, label: '🎉 Semua target tercapai!', color: '#10b981' };
  if (s.outcome === 'TP2') return { pct: 80, label: '🎯 TP2 hit — TP3 menunggu', color: '#10b981' };
  if (s.outcome === 'TP1') return { pct: 60, label: '✅ TP1 hit — menuju TP2', color: '#10b981' };
  if (s.outcome === 'SL') return { pct: 100, label: '🛑 Stop Loss hit', color: '#ef4444' };
  if (s.status === 'ACTIVE') return { pct: 40, label: '⚡ Harga di area entry', color: '#fbbf24' };
  if (s.status === 'PUBLISHED') return { pct: 20, label: '⏳ Menunggu harga masuk area entry', color: '#3b82f6' };
  return { pct: 0, label: 'Status: ' + s.status, color: '#6b7280' };
}

function renderSignalCard(s) {
  const cardClass = getStatusClass(s);
  const progress = computeProgress(s);
  const ticker = s.ticker || '—';
  const timeframe = s.timeframe || 'D1';
  
  // Entry range
  const entries = [s.entry_1, s.entry_2, s.entry_3].filter(x => x != null);
  const entryRange = entries.length > 1 
    ? fmtRp(Math.min(...entries)) + ' - ' + fmtRp(Math.max(...entries))
    : (entries.length === 1 ? fmtRp(entries[0]) : '—');
  
  // Targets
  const targets = [s.target_1, s.target_2, s.target_3].filter(x => x != null);
  const targetRange = targets.map(t => fmtRpShort(t)).join(' / ') || '—';
  
  return \`
  <div class="signal-card \${cardClass}">
    <div class="flex items-start justify-between flex-wrap gap-2 mb-2">
      <div>
        <div class="flex items-center gap-3">
          <span class="mono text-2xl font-black text-white">\${ticker}</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-idx-panel text-slate-400 font-mono">\${timeframe}</span>
          \${renderStatusBadge(s)}
        </div>
        <div class="text-xs text-slate-500 mt-1">\${s.notes ? s.notes.substring(0, 80) : ''}</div>
      </div>
      <div class="text-right">
        <div class="text-[10px] text-slate-500 uppercase">Risk / Reward</div>
        <div class="mono text-lg font-bold text-idx-amber">\${s.risk_reward ? Number(s.risk_reward).toFixed(2) + 'R' : '—'}</div>
      </div>
    </div>
    
    <div class="price-grid">
      <div class="price-item">
        <span class="price-label">Entry Range</span>
        <span class="price-value entry">\${entryRange}</span>
      </div>
      <div class="price-item">
        <span class="price-label">Stop Loss</span>
        <span class="price-value sl">\${fmtRp(s.stop_loss)}</span>
      </div>
      <div class="price-item">
        <span class="price-label">Target 1 / 2 / 3</span>
        <span class="price-value tp">\${targetRange}</span>
      </div>
      <div class="price-item">
        <span class="price-label">Entry Avg</span>
        <span class="price-value">\${fmtRp(s.entry_avg)}</span>
      </div>
    </div>
    
    <div class="progress-bar">
      <div class="progress-fill" style="width:\${progress.pct}%;background:\${progress.color};"></div>
    </div>
    <div class="progress-label">\${progress.label}</div>
    
    <div class="flex items-center justify-between mt-4">
      <div class="text-[10px] text-slate-500">
        \${s.published_at ? '📅 Published: ' + new Date(s.published_at).toLocaleDateString('id-ID', {day:'2-digit', month:'short', year:'numeric'}) : '📅 Belum dipublikasi'}
      </div>
      <a href="/?code=\${ticker}" class="filter-btn" style="text-decoration:none;">
        <i class="fa-solid fa-chart-line mr-1"></i> Lihat Chart
      </a>
    </div>
  </div>
  \`;
}

function renderSignals() {
  const container = document.getElementById('signalsList');
  let signals = allSignals;
  
  // Apply filter
  if (currentFilter !== 'all') {
    if (currentFilter === 'TP') {
      signals = signals.filter(s => ['TP1','TP2','TP3'].includes(s.outcome));
    } else if (currentFilter === 'SL') {
      signals = signals.filter(s => s.outcome === 'SL');
    } else {
      signals = signals.filter(s => s.status === currentFilter);
    }
  }
  
  if (!signals.length) {
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-inbox"></i><div>Belum ada signal' + (currentFilter !== 'all' ? ' untuk filter ini' : '') + '</div></div>';
    return;
  }
  
  container.innerHTML = signals.map(renderSignalCard).join('');
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
  renderSignals();
}

async function loadSignals() {
  const container = document.getElementById('signalsList');
  container.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><div class="mt-3">Memuat...</div></div>';
  
  try {
    const res = await fetch('/api/public/signals');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load');
    
    allSignals = data.signals || [];
    
    // Stats
    document.getElementById('statTotal').textContent = allSignals.length;
    document.getElementById('statActive').textContent = allSignals.filter(s => s.status === 'ACTIVE').length;
    
    const closed = allSignals.filter(s => ['TP1','TP2','TP3','SL'].includes(s.outcome));
    const wins = closed.filter(s => ['TP1','TP2','TP3'].includes(s.outcome)).length;
    document.getElementById('statWinRate').textContent = closed.length ? Math.round(wins/closed.length*100) + '%' : '—';
    
    document.getElementById('statUpdated').textContent = new Date().toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'});
    
    renderSignals();
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-exclamation-triangle" style="color:#ef4444;"></i><div class="mt-3">Error: ' + err.message + '</div></div>';
  }
}

// Init
loadSignals();
setInterval(loadSignals, 5 * 60 * 1000);
</script>
</body>
</html>
\`;

fs.writeFileSync(FILE, html, 'utf8');
console.log('✅ File dibuat: public/signals.html');
console.log('   Size:', fs.statSync(FILE).size, 'bytes');
console.log('');
console.log('🎉 Buka: http://localhost:3000/signals.html');
