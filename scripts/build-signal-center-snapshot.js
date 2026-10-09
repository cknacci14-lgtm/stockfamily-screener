'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { buildSignalCenter } = require('../src/services/signalCenterService');

(async () => {
  console.log('=== BUILD SIGNAL CENTER SNAPSHOT ===');
  console.log('Time: ' + new Date().toISOString());

  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
    );
    const universe = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb.from('stocks').select('code').order('code', { ascending: true }).range(off, off + 999);
      if (error) throw error;
      universe.push(...(data || []).map(r => String(r.code || '').trim().toUpperCase()).filter(Boolean));
      if (!data || data.length < 1000) break;
    }
    console.log('Universe: ' + universe.length);
    const result = await buildSignalCenter(universe, { fullUniverse: true });
    if (!result || !result.date) {
      console.log('::warning::Hasil kosong tanpa tanggal, snapshot lama dipertahankan');
      process.exitCode = 0;
      return;
    }

    console.log('Date:     ' + (result.date || 'N/A'));
    console.log('Count:    ' + (result.count || 0));
    console.log('Signals:  ' + ((result.signals || []).length));

    if (result.signals && result.signals.length > 0) {
      console.log('Tickers:  ' + result.signals.map(s => s.stockCode).join(', '));
    }

    // Write to both locations (buildSignalCenter may already write via writeSnapshot)
    const json = JSON.stringify(result, null, 2);
    const targets = [
      path.join(__dirname, '..', 'data', 'signal-center-snapshot.json'),
      path.join(__dirname, '..', 'public', 'data', 'signal-center-snapshot.json'),
    ];

    for (const target of targets) {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, json);
      console.log('Written: ' + target);
    }

    console.log('\n✅ Snapshot build complete');
    try {
      const perf = require('./signal-performance.js');
      const svc = require('../src/services/signalCenterService');
      perf.appendFromBuild(result, typeof svc.getLastConsidered === 'function' ? svc.getLastConsidered() : null);
    } catch (logErr) {
      console.warn('[signal-log] skipped:', logErr && logErr.message ? logErr.message : logErr);
    }
    process.exitCode = 0;
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  }
})();