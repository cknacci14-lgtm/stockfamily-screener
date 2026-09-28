// ============================================================
// PATCH: Signal Management API Endpoints
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src', 'server.js');
const BACKUP = FILE + '.bak-signal-api-' + Date.now();

if (!fs.existsSync(FILE)) {
  console.error('❌ File tidak ditemukan:', FILE);
  process.exit(1);
}

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));
console.log('');

let code = fs.readFileSync(FILE, 'utf8');

if (code.includes('/api/admin/signals')) {
  console.log('⚠️ Signal API sudah ada, skip.');
  process.exit(0);
}

// Endpoint code
const signalAPI = `

// ============================================================
// SIGNAL MANAGEMENT API
// ============================================================

// Helper: hitung status signal berdasarkan event timestamps
function computeOutcome(signal) {
  if (signal.tp3_hit_at) return 'TP3';
  if (signal.tp2_hit_at) return 'TP2';
  if (signal.tp1_hit_at) return 'TP1';
  if (signal.sl_hit_at) return 'SL';
  return null;
}

// Helper: validasi signal input
function validateSignalInput(body) {
  const errors = [];
  if (!body.ticker) errors.push('Ticker wajib');
  if (!body.stop_loss) errors.push('Stop loss wajib');
  if (!body.entry_1) errors.push('Entry 1 wajib');
  if (!body.target_1) errors.push('Target 1 wajib');
  
  const e1 = Number(body.entry_1);
  const e2 = Number(body.entry_2) || e1;
  const e3 = Number(body.entry_3) || e1;
  const sl = Number(body.stop_loss);
  const tp1 = Number(body.target_1);
  
  // Entry harus konsisten (buy signal): entry < SL
  if (sl >= e1) errors.push('Stop loss harus lebih rendah dari entry');
  // Target harus lebih tinggi dari entry
  if (tp1 <= e1) errors.push('Target 1 harus lebih tinggi dari entry');
  
  return errors;
}

// Helper: hitung entry average (weighted)
function calcEntryAvg(s) {
  const p1 = s.entry_1_pct || 30;
  const p2 = s.entry_2_pct || 30;
  const p3 = s.entry_3_pct || 40;
  const total = p1 + p2 + p3;
  
  let sum = 0, weightSum = 0;
  if (s.entry_1) { sum += Number(s.entry_1) * p1; weightSum += p1; }
  if (s.entry_2) { sum += Number(s.entry_2) * p2; weightSum += p2; }
  if (s.entry_3) { sum += Number(s.entry_3) * p3; weightSum += p3; }
  
  return weightSum > 0 ? sum / weightSum : null;
}

// Helper: hitung risk/reward
function calcRR(s) {
  const entryAvg = calcEntryAvg(s);
  const sl = Number(s.stop_loss);
  const tp1 = Number(s.target_1);
  if (!entryAvg || !sl || !tp1) return null;
  
  const risk = Math.abs(entryAvg - sl);
  const reward = Math.abs(tp1 - entryAvg);
  if (risk === 0) return null;
  return reward / risk;
}

// === GET ALL SIGNALS (admin) ===
app.get('/api/admin/signals', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, signals: data || [] });
  } catch (err) {
    console.error('[signals-list]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === GET SIGNAL DETAIL ===
app.get('/api/admin/signals/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { data: signal, error: sErr } = await supabase
      .from('signals').select('*').eq('id', id).maybeSingle();
    if (sErr) throw sErr;
    if (!signal) return res.status(404).json({ success: false, error: 'Signal not found' });

    const { data: events, error: eErr } = await supabase
      .from('signal_events')
      .select('*')
      .eq('signal_id', id)
      .order('created_at', { ascending: true });
    if (eErr) throw eErr;

    res.json({ success: true, signal, events: events || [] });
  } catch (err) {
    console.error('[signals-detail]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === CREATE SIGNAL (draft) ===
app.post('/api/admin/signals', async (req, res) => {
  try {
    const body = req.body || {};
    const errors = validateSignalInput(body);
    if (errors.length) {
      return res.status(400).json({ success: false, error: errors.join(', ') });
    }
    
    const entryAvg = calcEntryAvg(body);
    const rr = calcRR(body);
    
    const insertData = {
      ticker: String(body.ticker).toUpperCase(),
      timeframe: body.timeframe || 'D1',
      notes: body.notes || null,
      image_url: body.image_url || null,
      entry_1: Number(body.entry_1) || null,
      entry_2: Number(body.entry_2) || null,
      entry_3: Number(body.entry_3) || null,
      entry_1_pct: Number(body.entry_1_pct) || 30,
      entry_2_pct: Number(body.entry_2_pct) || 30,
      entry_3_pct: Number(body.entry_3_pct) || 40,
      stop_loss: Number(body.stop_loss) || null,
      target_1: Number(body.target_1) || null,
      target_2: Number(body.target_2) || null,
      target_3: Number(body.target_3) || null,
      status: 'DRAFT',
      entry_avg: entryAvg,
      risk_reward: rr,
      created_by: 'admin'
    };
    
    const { data, error } = await supabase
      .from('signals').insert(insertData).select().single();
    if (error) throw error;

    // Log event
    await supabase.from('signal_events').insert({
      signal_id: data.id,
      event_type: 'CREATED',
      note: 'Signal dibuat sebagai draft'
    });

    res.json({ success: true, signal: data });
  } catch (err) {
    console.error('[signals-create]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === UPDATE SIGNAL ===
app.patch('/api/admin/signals/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = req.body || {};
    
    // Cek signal exists
    const { data: existing } = await supabase
      .from('signals').select('*').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ success: false, error: 'Signal not found' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ success: false, error: 'Hanya signal DRAFT yang bisa diubah' });
    }
    
    const updateData = {};
    const allowed = ['ticker','timeframe','notes','image_url','entry_1','entry_2','entry_3',
                     'entry_1_pct','entry_2_pct','entry_3_pct','stop_loss','target_1','target_2','target_3'];
    allowed.forEach(k => {
      if (body[k] !== undefined) updateData[k] = body[k];
    });
    
    // Recompute avg & RR
    const merged = { ...existing, ...updateData };
    updateData.entry_avg = calcEntryAvg(merged);
    updateData.risk_reward = calcRR(merged);
    
    const { data, error } = await supabase
      .from('signals').update(updateData).eq('id', id).select().single();
    if (error) throw error;

    res.json({ success: true, signal: data });
  } catch (err) {
    console.error('[signals-update]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === PUBLISH SIGNAL ===
app.post('/api/admin/signals/:id/publish', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { data: existing } = await supabase
      .from('signals').select('*').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ success: false, error: 'Signal not found' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ success: false, error: 'Hanya DRAFT yang bisa publish' });
    }

    const { data, error } = await supabase
      .from('signals')
      .update({ status: 'PUBLISHED', published_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;

    await supabase.from('signal_events').insert({
      signal_id: id,
      event_type: 'PUBLISHED',
      note: 'Signal dipublikasikan'
    });

    // TODO: Kirim notif Telegram di sini

    res.json({ success: true, signal: data });
  } catch (err) {
    console.error('[signals-publish]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === DELETE SIGNAL (only draft) ===
app.delete('/api/admin/signals/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { data: existing } = await supabase
      .from('signals').select('*').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ success: false, error: 'Signal not found' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ success: false, error: 'Hanya DRAFT yang bisa dihapus' });
    }

    const { error } = await supabase.from('signals').delete().eq('id', id);
    if (error) throw error;

    res.json({ success: true, message: 'Signal deleted' });
  } catch (err) {
    console.error('[signals-delete]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === PUBLIC: LIST SIGNALS ===
app.get('/api/public/signals', async (req, res) => {
  try {
    const statusFilter = req.query.status;  // optional
    let query = supabase
      .from('signals')
      .select('*')
      .in('status', ['PUBLISHED', 'ACTIVE', 'CLOSED', 'EXPIRED'])
      .order('published_at', { ascending: false })
      .limit(100);
    
    if (statusFilter) query = query.eq('status', statusFilter);
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json({ success: true, signals: data || [] });
  } catch (err) {
    console.error('[signals-public]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
`;

// Insert before "// === SCREENER BLOCK TRADE ===" or similar marker
const anchor = "// === SCREENER BLOCK TRADE ===";
if (code.includes(anchor)) {
  code = code.replace(anchor, signalAPI + anchor);
  console.log('✅ Signal API disisipkan sebelum SCREENER BLOCK TRADE');
} else {
  // Fallback: insert sebelum "app.get('/api/public/history/:code'"
  const fallback = "app.get('/api/public/history/:code'";
  if (code.includes(fallback)) {
    code = code.replace(fallback, signalAPI + '\n' + fallback);
    console.log('✅ Signal API disisipkan sebelum /api/public/history');
  } else {
    console.error('❌ Anchor tidak ditemukan');
    process.exit(1);
  }
}

// SAVE
fs.writeFileSync(FILE, code, 'utf8');

console.log('');
console.log('=== VERIFIKASI ===');
const check = fs.readFileSync(FILE, 'utf8');
const endpoints = [
  '/api/admin/signals',
  '/api/admin/signals/:id',
  '/api/admin/signals/:id/publish',
  '/api/public/signals'
];
endpoints.forEach(ep => {
  console.log((check.includes(ep) ? '✅' : '❌') + ' ' + ep);
});
console.log('');
console.log('🎉 Selesai! Restart server dengan: npm start');
