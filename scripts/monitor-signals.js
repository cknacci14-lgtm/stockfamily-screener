// ============================================================
// MONITOR SIGNALS ENGINE v2
// Tanpa dependency (pure Node.js fetch)
// ============================================================

// Load .env kalau ada (untuk lokal). Di GitHub Actions, env dari secrets.
try {
  require('dotenv').config();
} catch (e) {
  // dotenv tidak terinstall — skip (GitHub Actions case)
}

const { notifySignalEvent } = require('./telegram-notifier.js');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ARJUM_KEY = (process.env.ARJUM_API_KEY || '').trim();

// ============================================================
// SUPABASE REST HELPERS
// ============================================================
async function sb(path, options = {}) {
  const url = SUPABASE_URL + '/rest/v1/' + path;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Supabase ' + res.status + ': ' + text.substring(0, 200));
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return null;
}

// ============================================================
// ARJUM PRICE FETCH
// ============================================================
async function fetchPriceFromArjum(code) {
  if (!ARJUM_KEY) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://stock.arjum.com/api/price/' + encodeURIComponent(code), {
      headers: { 'X-API-Key': ARJUM_KEY, 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
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
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(code) + '.JK?range=1d&interval=1d', { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
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
  const w1 = Number(signal.entry_1_pct) || 30;
  const w2 = Number(signal.entry_2_pct) || 30;
  const w3 = Number(signal.entry_3_pct) || 40;
  const entryMin = Math.min(entry1, entry2, entry3);
  const entryMax = Math.max(entry1, entry2, entry3);
  const sl = Number(signal.stop_loss);
  const tp1 = Number(signal.target_1);
  const tp2 = Number(signal.target_2);
  const tp3 = Number(signal.target_3);
  
  const result = { action: null, event: null, newOutcome: null, extraFields: {} };
  
  // Helper: detect entry hits
  function detectEntryHits() {
    const hits = {};
    if (price <= entry1 && !signal.entry_1_hit_at) hits.entry_1_hit_at = true;
    if (price <= entry2 && !signal.entry_2_hit_at) hits.entry_2_hit_at = true;
    if (price <= entry3 && !signal.entry_3_hit_at) hits.entry_3_hit_at = true;
    return hits;
  }
  
  // Compute actual avg based on hits
  function computeActualAvg(extraFields) {
    const entries = [
      { price: entry1, weight: w1, hit: signal.entry_1_hit_at || extraFields.entry_1_hit_at },
      { price: entry2, weight: w2, hit: signal.entry_2_hit_at || extraFields.entry_2_hit_at },
      { price: entry3, weight: w3, hit: signal.entry_3_hit_at || extraFields.entry_3_hit_at }
    ].filter(x => x.hit);
    
    if (!entries.length) return null;
    const totalW = entries.reduce((s, x) => s + x.weight, 0);
    const sum = entries.reduce((s, x) => s + x.price * x.weight, 0);
    return totalW > 0 ? Math.round((sum / totalW) * 100) / 100 : null;
  }
  
  // PUBLISHED → ACTIVE when price enters entry range
  if (signal.status === 'PUBLISHED') {
    if (price <= entryMax && price >= entryMin * 0.95) {
      const hits = detectEntryHits();
      const actualAvg = computeActualAvg(hits);
      return { 
        action: 'ACTIVATE', 
        event: 'ENTRY_HIT',
        extraFields: { ...hits, actual_entry_avg: actualAvg }
      };
    }
    return result;
  }
  
  // ACTIVE: check TP & SL
  if (signal.status === 'ACTIVE') {
    // Check if more entries hit (E2 or E3) since activation
    const hits = detectEntryHits();
    if (Object.keys(hits).length > 0) {
      const actualAvg = computeActualAvg(hits);
      return {
        action: 'MORE_ENTRY_HIT',
        event: 'ENTRY_HIT',
        extraFields: { ...hits, actual_entry_avg: actualAvg }
      };
    }

    if (tp3 && price >= tp3 && !signal.tp3_hit_at) {
      return { action: 'CLOSE_TP3', event: 'TP3_HIT', newOutcome: 'TP3' };
    }
    if (tp2 && price >= tp2 && !signal.tp2_hit_at) {
      return { action: 'TP2_HIT', event: 'TP2_HIT', newOutcome: 'TP2' };
    }
    if (tp1 && price >= tp1 && !signal.tp1_hit_at) {
      return { action: 'TP1_HIT', event: 'TP1_HIT', newOutcome: 'TP1' };
    }
    if (sl && price <= sl && !signal.sl_hit_at) {
      const anyTPHit = signal.tp1_hit_at || signal.tp2_hit_at || signal.tp3_hit_at;
      return { action: anyTPHit ? 'SL_AFTER_TP' : 'CLOSE_SL', event: 'SL_HIT', newOutcome: anyTPHit ? (signal.outcome || 'TP1') : 'SL' };
    }
    return result;
  }
  
  return result;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('');
  console.log('============================================================');
  console.log(' SIGNAL MONITOR ENGINE v2');
  console.log('============================================================');
  console.log(' Started: ' + new Date().toISOString());
  console.log('');
  
  // Debug env (bukan value, hanya status)
  console.log('ENV CHECK:');
  console.log('  SUPABASE_URL       :', SUPABASE_URL ? 'SET (' + SUPABASE_URL.length + ' chars)' : '❌ MISSING');
  console.log('  SUPABASE_KEY       :', SUPABASE_KEY ? 'SET (' + SUPABASE_KEY.length + ' chars)' : '❌ MISSING');
  console.log('  ARJUM_API_KEY      :', ARJUM_KEY ? 'SET (' + ARJUM_KEY.length + ' chars)' : '⚠️ MISSING');
  console.log('');
  
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak diset!');
    process.exit(1);
  }
  
  // 1. Fetch active signals
  console.log('📊 Fetching signals (PUBLISHED/ACTIVE)...');
  const signals = await sb('signals?status=in.(PUBLISHED,ACTIVE)&select=*');
  console.log('  Got: ' + signals.length + ' signal(s)');
  console.log('');
  
  if (!signals.length) {
    console.log('No active signals. Exit.');
    return;
  }
  
  // 2. Fetch prices
  const tickers = [...new Set(signals.map(s => s.ticker))];
  console.log('📈 Fetching prices for: ' + tickers.join(', '));
  const priceMap = {};
  for (const code of tickers) {
    const p = await fetchPrice(code);
    priceMap[code] = p;
    if (p) {
      console.log('  ' + code + ' → Rp ' + p.price.toLocaleString('id-ID') + ' (' + p.source + ')');
    } else {
      console.log('  ' + code + ' → ❌ no price');
    }
  }
  console.log('');
  
  // 3. Process each signal
  const updates = [];
  for (const signal of signals) {
    const priceData = priceMap[signal.ticker];
    if (!priceData) {
      console.log('⏭️  ' + signal.ticker + ' #' + signal.id + ' — skip (no price)');
      continue;
    }
    const result = checkSignalStatus(signal, priceData.price);
    if (!result.action) {
      console.log('✓ ' + signal.ticker + ' #' + signal.id + ' [' + signal.status + '] — no change');
      continue;
    }
    console.log('🎯 ' + signal.ticker + ' #' + signal.id + ' — ' + result.event + (result.action === 'MORE_ENTRY_HIT' ? ' (more entries)' : '') + ' @ Rp ' + priceData.price.toLocaleString('id-ID'));
    const now = new Date().toISOString();
    const update = { id: signal.id };
    if (result.action === 'ACTIVATE') {
      update.status = 'ACTIVE';
      update.entry_hit_at = now;
      // Merge per-entry hits
      if (result.extraFields) {
        Object.keys(result.extraFields).forEach(k => {
          if (result.extraFields[k] === true) update[k] = now;
          else if (result.extraFields[k] != null) update[k] = result.extraFields[k];
        });
      }
    } else if (result.action === 'MORE_ENTRY_HIT') {
      // Just update hit timestamps + actual avg, no status change
      if (result.extraFields) {
        Object.keys(result.extraFields).forEach(k => {
          if (result.extraFields[k] === true) update[k] = now;
          else if (result.extraFields[k] != null) update[k] = result.extraFields[k];
        });
      }
    } else if (result.action === 'TP1_HIT') {
      update.tp1_hit_at = now; update.outcome = result.newOutcome;
    } else if (result.action === 'TP2_HIT') {
      update.tp2_hit_at = now; update.outcome = result.newOutcome;
    } else if (result.action === 'CLOSE_TP3') {
      update.tp3_hit_at = now; update.outcome = 'TP3'; update.status = 'CLOSED'; update.closed_at = now;
    } else if (result.action === 'CLOSE_SL' || result.action === 'SL_AFTER_TP') {
      update.sl_hit_at = now; update.outcome = result.newOutcome; update.status = 'CLOSED'; update.closed_at = now;
    }
    updates.push({ update, event: result.event, price: priceData.price, signal });
  }
  
  console.log('');
  console.log('📝 Total changes: ' + updates.length);
  
  if (updates.length === 0) {
    console.log('Nothing to update.');
    return;
  }
  
  // 4. Apply updates
  console.log('💾 Applying updates...');
  for (const u of updates) {
    const updateData = { ...u.update };
    delete updateData.id;
    try {
      await sb('signals?id=eq.' + u.update.id, {
        method: 'PATCH',
        body: JSON.stringify(updateData)
      });
      await sb('signal_events', {
        method: 'POST',
        body: JSON.stringify({
          signal_id: u.update.id,
          event_type: u.event,
          price_at_event: u.price,
          note: 'Auto-detected by monitor engine'
        })
      });
      console.log('✅ #' + u.update.id + ' ' + u.signal.ticker + ' — ' + u.event);
      
      // Kirim notifikasi Telegram
      console.log('   📤 Sending Telegram notif...');
      const notifResult = await notifySignalEvent(u.signal, u.event, u.price);
      if (notifResult.success) {
        console.log('   ✅ Telegram sent');
      } else {
        console.log('   ⚠️  Telegram failed: ' + (notifResult.error || 'unknown'));
      }
    } catch (err) {
      console.error('❌ #' + u.update.id + ' ' + u.signal.ticker + ' — ' + err.message);
    }
  }
  
  console.log('');
  console.log('============================================================');
  console.log(' DONE');
  console.log('============================================================');
}

main().catch(err => {
  console.error('❌ FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
