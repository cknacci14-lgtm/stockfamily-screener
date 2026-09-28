// ============================================================
// MONITOR SIGNALS ENGINE
// Run manually: node scripts/monitor-signals.js
// Run via GitHub Actions: cron */15 * * * *
// ============================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CONFIG = {
  expiryDays: 30,           // Auto-expire setelah 30 hari
  dryRun: process.argv.includes('--dry-run'),
  verbose: process.argv.includes('--verbose')
};

// ============================================================
// LOGGING
// ============================================================
function log(msg, color) {
  const colors = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m' };
  const reset = '\x1b[0m';
  console.log((colors[color] || '') + msg + reset);
}

// ============================================================
// FETCH PRICE (Arjum first, fallback Yahoo)
// ============================================================
function arjumGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'stock.arjum.com',
      path: path,
      method: 'GET',
      headers: { 'X-API-Key': process.env.ARJUM_API_KEY, 'Accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Non-JSON: ' + body.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function fetchPriceFromArjum(code) {
  try {
    const data = await arjumGet('/api/price/' + encodeURIComponent(code));
    if (data && data.last_price) {
      return { price: Number(data.last_price), source: 'arjum', date: data.source_date };
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function fetchPriceFromYahoo(code) {
  try {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(code) + '.JK?range=1d&interval=1d');
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (meta && meta.regularMarketPrice) {
      return { price: Number(meta.regularMarketPrice), source: 'yahoo', date: new Date().toISOString().slice(0, 10) };
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function fetchPrice(code) {
  let p = await fetchPriceFromArjum(code);
  if (p) return p;
  p = await fetchPriceFromYahoo(code);
  if (p) return p;
  return null;
}

// ============================================================
// SIGNAL LOGIC
// ============================================================
function checkSignalStatus(signal, currentPrice) {
  const price = Number(currentPrice);
  const entry1 = Number(signal.entry_1);
  const entry2 = Number(signal.entry_2) || entry1;
  const entry3 = Number(signal.entry_3) || entry1;
  const entryMin = Math.min(entry1, entry2, entry3);
  const entryMax = Math.max(entry1, entry2, entry3);
  const sl = Number(signal.stop_loss);
  const tp1 = Number(signal.target_1);
  const tp2 = Number(signal.target_2);
  const tp3 = Number(signal.target_3);
  
  const result = { action: null, event: null, newOutcome: null };
  
  // === PUBLISHED → ACTIVE when price enters entry range ===
  if (signal.status === 'PUBLISHED') {
    // Buy signal: price masuk range entry (di bawah atau sama dengan entry max)
    if (price <= entryMax && price >= entryMin * 0.95) {  // Tolerance 5% bawah
      result.action = 'ACTIVATE';
      result.event = 'ENTRY_HIT';
      return result;
    }
    return result;
  }
  
  // === ACTIVE: check TP & SL ===
  if (signal.status === 'ACTIVE') {
    // Check TP3 first (highest priority)
    if (tp3 && price >= tp3 && !signal.tp3_hit_at) {
      result.action = 'CLOSE_TP3';
      result.event = 'TP3_HIT';
      result.newOutcome = 'TP3';
      return result;
    }
    // Check TP2
    if (tp2 && price >= tp2 && !signal.tp2_hit_at) {
      result.action = 'TP2_HIT';
      result.event = 'TP2_HIT';
      result.newOutcome = 'TP2';
      return result;
    }
    // Check TP1
    if (tp1 && price >= tp1 && !signal.tp1_hit_at) {
      result.action = 'TP1_HIT';
      result.event = 'TP1_HIT';
      result.newOutcome = 'TP1';
      return result;
    }
    // Check SL (only if no TP hit yet — first-touch wins)
    if (sl && price <= sl && !signal.sl_hit_at) {
      // Kalau belum ada TP hit → full SL
      const anyTPHit = signal.tp1_hit_at || signal.tp2_hit_at || signal.tp3_hit_at;
      result.action = anyTPHit ? 'SL_AFTER_TP' : 'CLOSE_SL';
      result.event = 'SL_HIT';
      result.newOutcome = anyTPHit ? (signal.outcome || 'TP1') : 'SL';
      return result;
    }
    return result;
  }
  
  return result;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  log('', '');
  log('============================================================', 'cyan');
  log(' SIGNAL MONITOR ENGINE', 'cyan');
  log('============================================================', 'cyan');
  log(' Started: ' + new Date().toISOString(), 'gray');
  log(' Mode: ' + (CONFIG.dryRun ? 'DRY RUN (no DB changes)' : 'LIVE'), CONFIG.dryRun ? 'yellow' : 'green');
  log('', '');
  
  // 1. Fetch active signals
  const { data: signals, error } = await supabase
    .from('signals')
    .select('*')
    .in('status', ['PUBLISHED', 'ACTIVE']);
  
  if (error) {
    log('❌ Failed to fetch signals: ' + error.message, 'red');
    process.exit(1);
  }
  
  log('📊 Signals to check: ' + signals.length, 'cyan');
  log('', '');
  
  if (!signals.length) {
    log('No active signals. Exit.', 'gray');
    return;
  }
  
  // 2. Group tickers (avoid duplicate fetch)
  const tickers = [...new Set(signals.map(s => s.ticker))];
  log('📈 Fetching prices for ' + tickers.length + ' ticker(s)...', 'cyan');
  
  const priceMap = {};
  for (const code of tickers) {
    const p = await fetchPrice(code);
    priceMap[code] = p;
    if (p) {
      log('  ' + code + ' → Rp ' + p.price.toLocaleString('id-ID') + ' (' + p.source + ')', 'gray');
    } else {
      log('  ' + code + ' → ❌ no price', 'red');
    }
  }
  log('', '');
  
  // 3. Process each signal
  const updates = [];
  
  for (const signal of signals) {
    const priceData = priceMap[signal.ticker];
    if (!priceData) {
      log('⏭️  ' + signal.ticker + ' #' + signal.id + ' — skip (no price)', 'yellow');
      continue;
    }
    
    const result = checkSignalStatus(signal, priceData.price);
    
    if (!result.action) {
      log('✓ ' + signal.ticker + ' #' + signal.id + ' [' + signal.status + '] — no change', 'gray');
      continue;
    }
    
    log('🎯 ' + signal.ticker + ' #' + signal.id + ' — ' + result.event + ' @ Rp ' + priceData.price.toLocaleString('id-ID'), 'green');
    
    const now = new Date().toISOString();
    const update = { id: signal.id };
    
    if (result.action === 'ACTIVATE') {
      update.status = 'ACTIVE';
      update.entry_hit_at = now;
    } else if (result.action === 'TP1_HIT') {
      update.tp1_hit_at = now;
      update.outcome = result.newOutcome;
    } else if (result.action === 'TP2_HIT') {
      update.tp2_hit_at = now;
      update.outcome = result.newOutcome;
    } else if (result.action === 'CLOSE_TP3') {
      update.tp3_hit_at = now;
      update.outcome = 'TP3';
      update.status = 'CLOSED';
      update.closed_at = now;
    } else if (result.action === 'CLOSE_SL' || result.action === 'SL_AFTER_TP') {
      update.sl_hit_at = now;
      update.outcome = result.newOutcome;
      update.status = 'CLOSED';
      update.closed_at = now;
    }
    
    updates.push({ update: update, event: result.event, price: priceData.price, signal: signal });
  }
  
  log('', '');
  log('📝 Total changes: ' + updates.length, 'cyan');
  
  if (updates.length === 0) {
    log('Nothing to update. Exit.', 'gray');
    return;
  }
  
  // 4. Apply updates
  if (CONFIG.dryRun) {
    log('', '');
    log('=== DRY RUN — Would apply ===', 'yellow');
    updates.forEach(u => {
      log('  #' + u.update.id + ' ' + u.signal.ticker + ' → ' + JSON.stringify(u.update), 'gray');
    });
    return;
  }
  
  log('', '');
  log('💾 Applying updates...', 'cyan');
  
  for (const u of updates) {
    const updateData = { ...u.update };
    delete updateData.id;
    
    const { error: updErr } = await supabase
      .from('signals')
      .update(updateData)
      .eq('id', u.update.id);
    
    if (updErr) {
      log('❌ #' + u.update.id + ' ' + u.signal.ticker + ': ' + updErr.message, 'red');
      continue;
    }
    
    // Log event
    await supabase.from('signal_events').insert({
      signal_id: u.update.id,
      event_type: u.event,
      price_at_event: u.price,
      note: 'Auto-detected by monitor engine'
    });
    
    log('✅ #' + u.update.id + ' ' + u.signal.ticker + ' — ' + u.event, 'green');
    
    // TODO: Send Telegram notification here (Phase 7)
  }
  
  log('', '');
  log('============================================================', 'cyan');
  log(' DONE', 'cyan');
  log('============================================================', 'cyan');
  log('', '');
}

main().catch(err => {
  console.error('❌ FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
