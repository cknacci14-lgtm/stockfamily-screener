'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const LOG_PATH = path.join(__dirname, '..', 'public', 'results', 'paper-trade-log.json');
const SCREENER_PATH = path.join(__dirname, '..', 'public', 'screener_results.json');

function loadLog() {
  if (fs.existsSync(LOG_PATH)) {
    try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch {}
  }
  return { created_at: new Date().toISOString(), policy_version: 'qbs-v3', entries: {}, runs: [] };
}

const stockIdCache = {};
async function fetchStockId(ticker) {
  if (stockIdCache[ticker]) return stockIdCache[ticker];
  const { data, error } = await sb.from('stocks').select('id').eq('code', ticker).maybeSingle();
  if (error) throw error;
  stockIdCache[ticker] = data?.id || null;
  return stockIdCache[ticker];
}

async function fetchNthDayAfter(stockId, signalDate, n) {
  const { data, error } = await sb.from('daily_stock_data')
    .select('trade_date, open, close')
    .eq('stock_id', stockId)
    .gt('trade_date', signalDate)
    .order('trade_date', { ascending: true })
    .limit(n);
  if (error) throw error;
  return (data && data[n - 1]) || null;
}

async function track() {
  console.log('=== QBS PAPER TRADE TRACKER ===\n');
  const log = loadLog();

  if (!fs.existsSync(SCREENER_PATH)) {
    console.error('Screener output not found:', SCREENER_PATH);
    process.exit(1);
  }
  const screener = JSON.parse(fs.readFileSync(SCREENER_PATH, 'utf8'));
  const todaysSignals = screener.data || [];
  console.log('Screener: regime=' + screener.regime + ' total=' + todaysSignals.length);

  let newCount = 0;
  for (const sig of todaysSignals) {
    const key = sig.ticker + '_' + sig.date;
    if (!log.entries[key]) {
      log.entries[key] = {
        ticker: sig.ticker,
        label: sig.qbs_label,
        regime: sig.qbs_regime,
        signal_date: sig.date,
        signal_close: sig.close,
        entry_price: null, entry_date: null,
        exit_price: null, exit_date: null,
        return_pct: null,
        status: 'PENDING',
        created_at: new Date().toISOString(),
      };
      newCount++;
    }
  }
  console.log('New signals added:', newCount);

  let entryResolved = 0, resolved = 0;
  for (const key of Object.keys(log.entries)) {
    const e = log.entries[key];
    if (e.status === 'COMPLETE') continue;
    const stockId = await fetchStockId(e.ticker);
    if (!stockId) continue;

    if (!e.entry_price) {
      const t1 = await fetchNthDayAfter(stockId, e.signal_date, 1);
      if (t1 && t1.open > 0) {
        e.entry_price = t1.open;
        e.entry_date = t1.trade_date;
        entryResolved++;
      }
    }

    if (e.entry_price) {
      const t10 = await fetchNthDayAfter(stockId, e.signal_date, 10);
      if (t10 && t10.close > 0) {
        e.exit_price = t10.close;
        e.exit_date = t10.trade_date;
        e.return_pct = ((e.exit_price - e.entry_price) / e.entry_price) * 100;
        e.status = 'COMPLETE';
        resolved++;
      }
    }
  }
  console.log('Entry prices resolved:', entryResolved);
  console.log('Outcomes completed (T+10):', resolved);

  const completed = Object.values(log.entries).filter(e => e.status === 'COMPLETE');
  const pending = Object.values(log.entries).filter(e => e.status === 'PENDING');

  console.log('\n=== SUMMARY ===');
  console.log('Total entries:', Object.keys(log.entries).length);
  console.log('Completed:', completed.length);
  console.log('Pending:', pending.length);

  if (completed.length) {
    const returns = completed.map(e => e.return_pct);
    const wins = returns.filter(r => r > 0);
    const losses = returns.filter(r => r <= 0);
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    const winRate = wins.length / returns.length * 100;
    const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

    console.log('\n--- T+10 Outcomes ---');
    console.log('Win rate   :', winRate.toFixed(1) + '%');
    console.log('Avg return :', avg.toFixed(2) + '%');
    console.log('Avg win    :', avgWin.toFixed(2) + '%');
    console.log('Avg loss   :', avgLoss.toFixed(2) + '%');
    console.log('Expectancy :', ((winRate / 100) * avgWin + (1 - winRate / 100) * avgLoss).toFixed(2) + '%');

    const byLabel = {};
    for (const e of completed) {
      if (!byLabel[e.label]) byLabel[e.label] = [];
      byLabel[e.label].push(e.return_pct);
    }
    console.log('\n--- By Label ---');
    for (const [label, rs] of Object.entries(byLabel)) {
      const wr = rs.filter(r => r > 0).length / rs.length * 100;
      const a = rs.reduce((x, y) => x + y, 0) / rs.length;
      console.log('  ' + label + ': N=' + rs.length + ', Win=' + wr.toFixed(1) + '%, Avg=' + a.toFixed(2) + '%');
    }
  }

  log.last_run = new Date().toISOString();
  if (!log.runs) log.runs = [];
  log.runs.push({
    timestamp: new Date().toISOString(),
    new_signals: newCount,
    completed: resolved,
    total_entries: Object.keys(log.entries).length,
  });
  if (log.runs.length > 100) log.runs = log.runs.slice(-100);

  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
  console.log('\nLog saved:', LOG_PATH);
}

track().catch(e => { console.error('ERROR:', e.message); process.exit(1); });