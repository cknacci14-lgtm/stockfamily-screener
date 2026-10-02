'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { buildSignalCenter } = require('../src/services/signalCenterService');

(async () => {
  console.log('=== BUILD SIGNAL CENTER SNAPSHOT ===');
  console.log('Time: ' + new Date().toISOString());

  try {
    const result = await buildSignalCenter([], { fullUniverse: true });

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

    console.log('
✅ Snapshot build complete');
    process.exitCode = 0;
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  }
})();