// ============================================================
// BACKTEST: BT Screener
// Simulasi historis untuk validasi strategi
// - No look-ahead bias
// - Entry T+1 close
// - Exit 3D/7D/30D
// - Compare vs baseline
// ============================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ==== CONFIG ====
const CONFIG = {
  lookbackDays: 30,       // Window untuk hitung BT
  minVol: 5000000,        // Min BT volume
  topN: 5,                // Ambil top N saham per tanggal
  exitDays: [3, 7, 30],   // Exit horizons
  minHistoryDays: 30,     // Min data sebelum signal date
  startDate: '2026-02-01',// Mulai backtest (butuh history)
  endDate: '2026-09-25',  // Latest date
  outputFile: `bt-backtest-${new Date().toISOString().slice(0, 10)}.json`
};

// ==== HELPERS ====
const fmtNum = (n) => Number(n || 0).toLocaleString('id-ID');
const log = (msg, color = '') => console.log(msg);

function dateAdd(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateDiff(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const sq = arr.reduce((s, v) => s + Math.pow(v - m, 2), 0);
  return Math.sqrt(sq / (arr.length - 1));
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ==== PHASE DETECTION (sama dengan endpoint) ====
function detectPhase(candles) {
  if (!candles || candles.length < 3) {
    return { phase: 'NEUTRAL', weight: 0 };
  }
  const closes = candles.map(c => Number(c.close));
  const highs = candles.map(c => Number(c.high));
  const lows = candles.map(c => Number(c.low));
  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const priceChange = (lastClose - firstClose) / firstClose;
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const range = hi - lo;
  const pos = range > 0 ? (lastClose - lo) / range : 0.5;
  
  if (priceChange > 0.05) return { phase: 'MARKUP', weight: 80 };
  if (priceChange < -0.05) return { phase: 'MARKDOWN', weight: 10 };
  if (pos > 0.65 && Math.abs(priceChange) < 0.05) return { phase: 'DISTRIBUSI', weight: 60 };
  if (pos < 0.35 && Math.abs(priceChange) < 0.05) return { phase: 'AKUMULASI', weight: 100 };
  return { phase: 'KONSOLIDASI', weight: 20 };
}

// ==== QUALITY SCORE ====
function calculateScore(volume, phaseWeight, count) {
  const volScore = Math.min(Math.log10(volume + 1) * 12, 100);
  const countBonus = Math.min(count * 5, 30);
  const score = (volScore * 0.3) + (phaseWeight * 0.5) + (countBonus * 0.2);
  return Math.round(score);
}

// ==== MAIN ====
async function main() {
  log('');
  log('============================================================');
  log(' BT SCREENER BACKTEST');
  log('============================================================');
  log(` Config: lookback=${CONFIG.lookbackDays}d, minVol=${fmtNum(CONFIG.minVol)}, topN=${CONFIG.topN}`);
  log(` Period: ${CONFIG.startDate} → ${CONFIG.endDate}`);
  log('');

  // 1. Fetch stocks
  log('[1/5] Loading stocks...');
  const { data: stocks, error: sErr } = await supabase
    .from('stocks')
    .select('id, code, name');
  if (sErr) throw sErr;
  const stockMap = {};
  stocks.forEach(s => stockMap[s.id] = s);
  log(`      ✅ ${stocks.length} stocks loaded`);

  // 2. Fetch all daily data (need for lookback)
  log('[2/5] Loading daily data (may take a while)...');
  const startFetch = dateAdd(CONFIG.startDate, -CONFIG.lookbackDays - 10);
  let allRows = [];
  let offset = 0;
  const PAGE = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: chunk, error: dErr } = await supabase
      .from('daily_stock_data')
      .select('stock_id, trade_date, close, high, low, volume, non_regular_volume, non_regular_value')
      .gte('trade_date', startFetch)
      .lte('trade_date', CONFIG.endDate)
      .order('trade_date', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (dErr) throw dErr;
    if (!chunk || !chunk.length) { hasMore = false; break; }
    allRows = allRows.concat(chunk);
    offset += PAGE;
    process.stdout.write(`      📊 ${fmtNum(allRows.length)} rows loaded\r`);
    if (chunk.length < PAGE) hasMore = false;
  }
  log('');
  log(`      ✅ ${fmtNum(allRows.length)} rows loaded`);

  // 3. Group data by stock
  log('[3/5] Grouping data by stock...');
  const byStock = {}; // { sid: { dates: [...], byDate: { date: row } } }
  const allDatesSet = new Set();

  allRows.forEach(r => {
    const sid = r.stock_id;
    if (!byStock[sid]) byStock[sid] = { dates: [], byDate: {} };
    byStock[sid].byDate[r.trade_date] = r;
    byStock[sid].dates.push(r.trade_date);
    allDatesSet.add(r.trade_date);
  });

  Object.values(byStock).forEach(s => s.dates.sort());
  const allDates = [...allDatesSet].sort();
  log(`      ✅ ${Object.keys(byStock).length} stocks grouped, ${allDates.length} unique dates`);

  // 4. Simulate
  log('[4/5] Running backtest simulation...');
  const signalDates = allDates.filter(d => d >= CONFIG.startDate && d <= CONFIG.endDate);
  const trades = [];
  let processed = 0;

  for (const signalDate of signalDates) {
    processed++;
    if (processed % 20 === 0) {
      process.stdout.write(`      📈 ${processed}/${signalDates.length} dates (${trades.length} trades)\r`);
    }

    // a. Lookback window untuk BT
    const lookbackStart = dateAdd(signalDate, -CONFIG.lookbackDays);
    const lookbackEnd = signalDate;

    // b. Build signals untuk tanggal ini
    const signals = [];
    
    for (const sid of Object.keys(byStock)) {
      const stock = byStock[sid];
      const info = stockMap[sid];
      if (!info) continue;

      // Filter: ambil BT dalam window
      let btVolume = 0, btValue = 0, btCount = 0;
      const btDates = [];
      for (const d of stock.dates) {
        if (d < lookbackStart) continue;
        if (d > lookbackEnd) break;
        const row = stock.byDate[d];
        const nrv = Number(row.non_regular_volume) || 0;
        if (nrv >= CONFIG.minVol) {
          btVolume += nrv;
          btValue += Number(row.non_regular_value) || 0;
          btCount++;
          btDates.push(d);
        }
      }

      if (btCount === 0) continue;

      // === FILTER 1: LIQUIDITY (avg value 20d) ===
      const recent20d = stock.dates
        .filter(d => d <= lookbackEnd)
        .slice(-20);
      if (recent20d.length < 10) continue;
      
      const avgValue20d = recent20d.reduce((s, d) => 
        s + (Number(stock.byDate[d]?.value) || 0), 0) / recent20d.length;
      if (avgValue20d < CONFIG.minAvgValue20d) continue;

      // === FILTER 2: MOMENTUM (above SMA20) ===
      const last20Closes = recent20d.map(d => Number(stock.byDate[d]?.close) || 0);
      const sma20 = last20Closes.reduce((s, c) => s + c, 0) / last20Closes.length;
      const latestClose = last20Closes[last20Closes.length - 1];
      
      if (CONFIG.requireAboveSMA20 && latestClose < sma20) continue;

      // Phase detection: butuh candle history
      const candleWindow = stock.dates
        .filter(d => d >= lookbackStart && d <= lookbackEnd)
        .map(d => stock.byDate[d]);
      
      if (candleWindow.length < 5) continue;

      const phaseInfo = detectPhase(candleWindow);
      const score = calculateScore(btVolume, phaseInfo.weight, btCount);

      signals.push({
        code: info.code,
        name: info.name,
        phase: phaseInfo.phase,
        score,
        bt_volume: btVolume,
        bt_value: btValue,
        bt_count: btCount,
        latest_close: Number(stock.byDate[lookbackEnd]?.close) || 0
      });
    }

    // c. Sort & take top N
    signals.sort((a, b) => b.score - a.score);
    const topN = signals.slice(0, CONFIG.topN);

    // d. Simulate entry & exit untuk setiap sinyal
    for (const signal of topN) {
      const stock = Object.values(byStock).find(s => {
        const anyRow = s.byDate[lookbackEnd];
        return anyRow && stockMap[anyRow.stock_id]?.code === signal.code;
      });
      if (!stock) continue;

      // Entry: T+1 close
      const entryDatesAfter = stock.dates.filter(d => d > signalDate).sort();
      if (entryDatesAfter.length === 0) continue;
      const entryDate = entryDatesAfter[0];
      const entryPrice = Number(stock.byDate[entryDate]?.close);
      if (!entryPrice) continue;

      // Exits: T+3, T+7, T+30 setelah entry
      const trade = {
        signal_date: signalDate,
        code: signal.code,
        phase: signal.phase,
        score: signal.score,
        bt_volume: signal.bt_volume,
        entry_date: entryDate,
        entry_price: entryPrice,
        returns: {}
      };

      for (const exitDay of CONFIG.exitDays) {
        const targetDate = dateAdd(entryDate, exitDay);
        // Cari tanggal terdekat >= target (skip weekend/holiday)
        const exitCandidates = stock.dates.filter(d => d >= targetDate);
        if (exitCandidates.length === 0) {
          trade.returns[`return_${exitDay}d`] = null;
          continue;
        }
        const exitDate = exitCandidates[0];
        const exitPrice = Number(stock.byDate[exitDate]?.close);
        if (!exitPrice) {
          trade.returns[`return_${exitDay}d`] = null;
          continue;
        }
        trade.returns[`return_${exitDay}d`] = (exitPrice - entryPrice) / entryPrice;
        trade.returns[`exit_${exitDay}d_date`] = exitDate;
        trade.returns[`exit_${exitDay}d_price`] = exitPrice;
      }

      trades.push(trade);
    }
  }

  log('');
  log(`      ✅ ${trades.length} trades recorded`);

  // 5. Analysis
  log('[5/5] Analyzing results...');
  
  const analysis = analyzeTrades(trades);
  
  // Save
  const outputDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, CONFIG.outputFile);
  
  fs.writeFileSync(outputPath, JSON.stringify({
    config: CONFIG,
    summary: analysis.summary,
    byPhase: analysis.byPhase,
    byScore: analysis.byScore,
    byMonth: analysis.byMonth,
    topWinners: analysis.topWinners,
    topLosers: analysis.topLosers,
    totalTrades: trades.length,
    trades: trades.slice(0, 500) // Sample only untuk ukuran file
  }, null, 2));

  printReport(analysis);
  log('');
  log(`💾 Saved to: results/${CONFIG.outputFile}`);
  log('');
}

function analyzeTrades(trades) {
  const valid = (arr) => arr.filter(v => v !== null && !isNaN(v));

  const summary = {};
  for (const d of CONFIG.exitDays) {
    const rets = valid(trades.map(t => t.returns[`return_${d}d`]));
    if (!rets.length) continue;
    const wins = rets.filter(r => r > 0);
    const losses = rets.filter(r => r < 0);
    const grossProfit = wins.reduce((s, r) => s + r, 0);
    const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
    
    summary[`return_${d}d`] = {
      count: rets.length,
      winRate: wins.length / rets.length,
      avgReturn: mean(rets),
      medianReturn: median(rets),
      stdDev: stdDev(rets),
      best: Math.max(...rets),
      worst: Math.min(...rets),
      p25: percentile(rets, 0.25),
      p75: percentile(rets, 0.75),
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 999,
      sharpe: stdDev(rets) > 0 ? mean(rets) / stdDev(rets) : 0
    };
  }

  // By Phase
  const byPhase = {};
  for (const phase of ['AKUMULASI', 'MARKUP', 'DISTRIBUSI', 'MARKDOWN', 'KONSOLIDASI']) {
    const subset = trades.filter(t => t.phase === phase);
    if (!subset.length) continue;
    byPhase[phase] = {
      count: subset.length,
      return_3d: analyzeRets(valid(subset.map(t => t.returns.return_3d))),
      return_7d: analyzeRets(valid(subset.map(t => t.returns.return_7d))),
      return_30d: analyzeRets(valid(subset.map(t => t.returns.return_30d)))
    };
  }

  // By Score bucket
  const byScore = {};
  const buckets = [
    { name: '80-100', min: 80, max: 100 },
    { name: '60-79', min: 60, max: 79 },
    { name: '40-59', min: 40, max: 59 },
    { name: '<40', min: 0, max: 39 }
  ];
  for (const b of buckets) {
    const subset = trades.filter(t => t.score >= b.min && t.score <= b.max);
    if (!subset.length) continue;
    byScore[b.name] = {
      count: subset.length,
      return_3d: analyzeRets(valid(subset.map(t => t.returns.return_3d))),
      return_7d: analyzeRets(valid(subset.map(t => t.returns.return_7d))),
      return_30d: analyzeRets(valid(subset.map(t => t.returns.return_30d)))
    };
  }

  // By month
  const byMonth = {};
  const months = [...new Set(trades.map(t => t.signal_date.slice(0, 7)))].sort();
  for (const m of months) {
    const subset = trades.filter(t => t.signal_date.startsWith(m));
    byMonth[m] = {
      count: subset.length,
      return_30d: analyzeRets(valid(subset.map(t => t.returns.return_30d)))
    };
  }

  // Top winners & losers
  const with30d = trades.filter(t => t.returns.return_30d !== null && !isNaN(t.returns.return_30d));
  const topWinners = with30d.sort((a, b) => b.returns.return_30d - a.returns.return_30d).slice(0, 10);
  const topLosers = with30d.sort((a, b) => a.returns.return_30d - b.returns.return_30d).slice(0, 10);

  return { summary, byPhase, byScore, byMonth, topWinners, topLosers };
}

function analyzeRets(rets) {
  if (!rets.length) return { count: 0 };
  const wins = rets.filter(r => r > 0);
  const losses = rets.filter(r => r < 0);
  const grossProfit = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
  return {
    count: rets.length,
    winRate: wins.length / rets.length,
    avgReturn: mean(rets),
    medianReturn: median(rets),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 999
  };
}

function printReport(a) {
  const pct = (n) => (n * 100).toFixed(2) + '%';

  log('');
  log('============================================================');
  log(' BACKTEST REPORT');
  log('============================================================');
  log('');
  log('📊 SUMMARY BY EXIT HORIZON');
  log('');
  log(' Horizon | Count | Win%  | Avg    | Median | PF    | Sharpe');
  log(' --------|-------|-------|--------|--------|-------|--------');
  for (const d of CONFIG.exitDays) {
    const s = a.summary[`return_${d}d`];
    if (!s) continue;
    log(`   ${String(d).padStart(2)}d   | ${String(s.count).padStart(5)} | ${pct(s.winRate).padStart(5)} | ${pct(s.avgReturn).padStart(6)} | ${pct(s.medianReturn).padStart(6)} | ${s.profitFactor.toFixed(2).padStart(5)} | ${s.sharpe.toFixed(2)}`);
  }

  log('');
  log('🎯 BY PHASE (30D return)');
  log('');
  log(' Phase        | Count | Win%  | Avg    | PF');
  log(' -------------|-------|-------|--------|-------');
  for (const [phase, data] of Object.entries(a.byPhase)) {
    const r = data.return_30d;
    if (!r || !r.count) continue;
    log(` ${phase.padEnd(12)} | ${String(r.count).padStart(5)} | ${pct(r.winRate).padStart(5)} | ${pct(r.avgReturn).padStart(6)} | ${r.profitFactor.toFixed(2)}`);
  }

  log('');
  log('📈 BY SCORE BUCKET (30D return)');
  log('');
  log(' Score Range  | Count | Win%  | Avg    | PF');
  log(' -------------|-------|-------|--------|-------');
  for (const [bucket, data] of Object.entries(a.byScore)) {
    const r = data.return_30d;
    if (!r || !r.count) continue;
    log(` ${bucket.padEnd(12)} | ${String(r.count).padStart(5)} | ${pct(r.winRate).padStart(5)} | ${pct(r.avgReturn).padStart(6)} | ${r.profitFactor.toFixed(2)}`);
  }

  log('');
  log('📅 BY MONTH (30D return)');
  log('');
  log(' Month    | Count | Win%  | Avg');
  log(' ---------|-------|-------|--------');
  for (const [month, data] of Object.entries(a.byMonth)) {
    const r = data.return_30d;
    if (!r || !r.count) continue;
    log(` ${month}  | ${String(r.count).padStart(5)} | ${pct(r.winRate).padStart(5)} | ${pct(r.avgReturn).padStart(6)}`);
  }

  log('');
  log('🏆 TOP 5 WINNERS (30D)');
  a.topWinners.slice(0, 5).forEach(t => {
    log(`  ${t.code.padEnd(6)} | ${t.signal_date} | ${t.phase.padEnd(12)} | Score ${t.score} | ${pct(t.returns.return_30d)}`);
  });

  log('');
  log('💀 TOP 5 LOSERS (30D)');
  a.topLosers.slice(0, 5).forEach(t => {
    log(`  ${t.code.padEnd(6)} | ${t.signal_date} | ${t.phase.padEnd(12)} | Score ${t.score} | ${pct(t.returns.return_30d)}`);
  });

  log('');
  log('============================================================');
  log(' VERDICT');
  log('============================================================');
  const s30 = a.summary.return_30d;
  if (s30) {
    const pf = s30.profitFactor;
    const wr = s30.winRate;
    const avg = s30.avgReturn;
    
    let verdict = '';
    if (pf > 1.5 && wr > 0.55 && avg > 0.02) {
      verdict = '✅ STRATEGY LAYAK DEPLOY — Signal kuat & profitable';
    } else if (pf > 1.2 && wr > 0.5 && avg > 0.01) {
      verdict = '🟡 LAYAK DEPLOY (kondisional) — Perlu tuning';
    } else if (pf > 1.0) {
      verdict = '⚠️ MARGINAL — Perlu significant improvement';
    } else {
      verdict = '❌ TIDAK LAYAK — Jangan deploy sebelum tuning ulang';
    }
    log(` ${verdict}`);
    log(` Profit Factor: ${pf.toFixed(2)} | Win Rate: ${pct(wr)} | Avg Return: ${pct(avg)}`);
  }
  log('');
}

main().catch(err => {
  console.error('');
  console.error('❌ FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
