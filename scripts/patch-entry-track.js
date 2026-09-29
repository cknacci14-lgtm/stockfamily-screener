const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'scripts', 'monitor-signals.js');
const BACKUP = FILE + '.bak-entry-track-' + Date.now();

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));

let code = fs.readFileSync(FILE, 'utf8');

// === 1. Update checkSignalStatus ===
const oldStatus = `function checkSignalStatus(signal, currentPrice) {
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
  
  // PUBLISHED → ACTIVE when price enters entry range
  if (signal.status === 'PUBLISHED') {
    if (price <= entryMax && price >= entryMin * 0.95) {
      return { action: 'ACTIVATE', event: 'ENTRY_HIT' };
    }
    return result;
  }`;

const newStatus = `function checkSignalStatus(signal, currentPrice) {
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
  }`;

if (code.includes(oldStatus)) {
  code = code.replace(oldStatus, newStatus);
  console.log('✅ checkSignalStatus updated');
} else {
  console.log('❌ checkSignalStatus pattern not found');
  process.exit(1);
}

// === 2. Update ACTIVE branch — track more entries ===
const oldActive = `  // ACTIVE: check TP & SL
  if (signal.status === 'ACTIVE') {`;

const newActive = `  // ACTIVE: check TP & SL
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
`;

if (code.includes(oldActive)) {
  code = code.replace(oldActive, newActive);
  console.log('✅ ACTIVE branch updated');
}

// === 3. Update apply updates — include extraFields ===
const oldApply = `    const now = new Date().toISOString();
    const update = { id: signal.id };
    if (result.action === 'ACTIVATE') {
      update.status = 'ACTIVE'; update.entry_hit_at = now;
    } else if (result.action === 'TP1_HIT') {`;

const newApply = `    const now = new Date().toISOString();
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
    } else if (result.action === 'TP1_HIT') {`;

if (code.includes(oldApply)) {
  code = code.replace(oldApply, newApply);
  console.log('✅ Apply logic updated');
}

// === 4. Update logging — handle MORE_ENTRY_HIT ===
const oldLog = `    console.log('🎯 ' + signal.ticker + ' #' + signal.id + ' — ' + result.event + ' @ Rp ' + priceData.price.toLocaleString('id-ID'));`;
const newLog = `    console.log('🎯 ' + signal.ticker + ' #' + signal.id + ' — ' + result.event + (result.action === 'MORE_ENTRY_HIT' ? ' (more entries)' : '') + ' @ Rp ' + priceData.price.toLocaleString('id-ID'));`;

if (code.includes(oldLog)) {
  code = code.replace(oldLog, newLog);
  console.log('✅ Log message updated');
}

fs.writeFileSync(FILE, code, 'utf8');
console.log('');
console.log('🎉 Monitor engine updated!');
