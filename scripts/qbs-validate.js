// scripts/qbs-validate.js
'use strict';
const fs = require('fs');

// ===== HELPERS =====
function sma(arr, n) {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((a,b)=>a+b,0) / n;
}
function closePos(close, high, low) {
  if (high === low) return 0;
  return (close - low) / (high - low);
}
function correction(close, high10d) {
  return (close / high10d) - 1;
}

// ===== FILTER =====
function passesFilter(s) {
  const f = {
    fnet3d: s.fnet_3d > 0,
    cpos3d: s.close_pos_3d_max >= 0.65,
    fib:    s.fib_ratio >= 0.50 && s.fib_ratio <= 0.81,
    corr:   correction(s.close, s.high_10d) >= -0.14 && correction(s.close, s.high_10d) <= -0.03,
    bid:    s.bid_vol > s.offer_vol,
    value:  s.value >= 1_000_000_000,
    vol:    s.volume > 100_000,
    rvol:   s.rvol_5d < 1.3,
    price:  s.close > 100,
  };
  return { pass: Object.values(f).every(Boolean), details: f };
}

// ===== LABEL =====
function classifyLabel(s) {
  if (s.close_pos >= 0.55 && s.fnet_1d >= 0) return 'A';
  if (s.close_pos >= 0.40 || s.fnet_1d > -0.5 * s.fnet_3d) return 'B';
  return 'C';
}
function isDeepFib(s) {
  return correction(s.close, s.high_10d) <= -0.10;
}

// ===== REGIME =====
function classifyRegime(universe) {
  const n = universe.length;
  if (n === 0) return { regime: 'Weak', pctUp: 0, meanFnet: 0 };
  const pctUp = universe.filter(s => s.close > s.prev_close).length / n;
  const meanFnet = universe.reduce((a, s) => a + s.fnet_1d, 0) / n;
  if (pctUp >= 0.45 && meanFnet >= 0) return { regime: 'Supportive', pctUp, meanFnet };
  if (pctUp >= 0.40 || meanFnet > -1_000_000) {
    return { regime: meanFnet >= 0 ? 'Neutral+' : 'Neutral-', pctUp, meanFnet };
  }
  return { regime: 'Weak', pctUp, meanFnet };
}

// ===== ACTION =====
function decideAction(s, regime) {
  const label = classifyLabel(s);
  const cpos = s.close_pos, cpos3d = s.close_pos_3d_max, fnet1d = s.fnet_1d;
  const deepFib = isDeepFib(s);

  if (regime === 'Supportive') {
    if (label === 'A' || label === 'B') return 'FULL';
    if (label === 'C' && cpos3d >= 0.70) return 'HALF';
    return 'SKIP';
  }
  if (regime === 'Neutral+') {
    if (label === 'A' && cpos >= 0.60) return 'FULL';
    return 'SKIP';
  }
  if (regime === 'Neutral-') {
    if (label === 'A' && cpos >= 0.70 && fnet1d > 0) return 'FULL';
    return 'SKIP';
  }
  if (regime === 'Weak') {
    if (deepFib) return 'HALF';
    if (label === 'A' && cpos >= 0.70 && fnet1d > 0) return 'HALF';
    return 'SKIP';
  }
  return 'SKIP';
}

// ===== SELF TEST =====
function selfTest() {
  console.log('\n=== QBS SELF TEST ===\n');
  const base = {
    ticker: 'TEST1', close: 6150, high: 6200, low: 6100, prev_close: 6200,
    high_10d: 6500, low_20d: 5900, volume: 500000, value: 3_000_000_000,
    bid_vol: 100_000, offer_vol: 80_000,
    fnet_1d: 50_000, fnet_3d: 150_000,
    close_pos: 0.5, close_pos_3d_max: 0.75, fib_ratio: 0.65, rvol_5d: 0.8,
  };
  const cases = [
    { name: 'Strong pass',       s: base },
    { name: 'Fail price (<100)', s: { ...base, close: 80 } },
    { name: 'Fail fnet3d',       s: { ...base, fnet_3d: -1000 } },
    { name: 'Fail rvol (>1.3)',  s: { ...base, rvol_5d: 1.5 } },
    { name: 'Deep Fib',          s: { ...base, high_10d: 6900 } },
  ];
  for (const c of cases) {
    const f = passesFilter(c.s);
    console.log(`${c.name.padEnd(25)} | pass=${f.pass} | label=${classifyLabel(c.s)} | deepFib=${isDeepFib(c.s)}`);
  }
}

// ===== MAIN =====
function main() {
  const args = process.argv.slice(2);
  const inputArg = args.find(a => a.startsWith('--input='));
  const stFlag = args.includes('--self-test');

  if (stFlag || !inputArg) {
    selfTest();
    if (!inputArg) {
      console.log('\nUsage: node scripts/qbs-validate.js --input=data.json');
      return;
    }
  }

  const inputPath = inputArg.split('=')[1];
  if (!fs.existsSync(inputPath)) { console.error('File not found:', inputPath); process.exit(1); }
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const stocks = raw.stocks || raw;
  const date = raw.date || new Date().toISOString().split('T')[0];

  console.log(`\n=== QBS VALIDATION @ ${date} ===`);
  console.log(`Total stocks: ${stocks.length}\n`);

  const regime = classifyRegime(stocks);
  console.log(`REGIME: ${regime.regime} (pctUp=${(regime.pctUp*100).toFixed(1)}%, meanFnet=${regime.meanFnet.toFixed(0)})\n`);

  const results = [];
  const failStats = { fnet3d:0, cpos3d:0, fib:0, corr:0, bid:0, value:0, vol:0, rvol:0, price:0 };

  for (const s of stocks) {
    const f = passesFilter(s);
    if (!f.pass) {
      for (const [k, v] of Object.entries(f.details)) if (!v) failStats[k]++;
      continue;
    }
    results.push({
      ticker: s.ticker,
      label: classifyLabel(s),
      action: decideAction(s, regime.regime),
      deepFib: isDeepFib(s),
      cpos: s.close_pos.toFixed(2),
      cpos3d: s.close_pos_3d_max.toFixed(2),
      fnet1d: s.fnet_1d,
    });
  }

  console.log('--- FILTER FAILURE COUNT ---');
  for (const [k, v] of Object.entries(failStats)) console.log(`  ${k.padEnd(8)}: ${v}`);
  console.log(`\n--- PASSED FILTER: ${results.length} stocks ---`);
  if (results.length) console.table(results);

  const ac = results.reduce((a, r) => (a[r.action]=(a[r.action]||0)+1, a), {});
  console.log('\n--- ACTION SUMMARY ---');
  for (const [k, v] of Object.entries(ac)) console.log(`  ${k}: ${v}`);
}
main();