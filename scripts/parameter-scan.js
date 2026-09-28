// ============================================================
// PARAMETER SCAN
// Test individual parameter predictive power
// No look-ahead: hanya pakai data <= tanggal signal
// ============================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CONFIG = {
  startDate: '2026-02-15',
  endDate: '2026-08-25',
  minHistory: 25,
  minValue: 1000000000, // Rp 1B minimum value untuk filter likuiditas
  horizons: [5, 10, 20],
  maxStocksPerDate: 200,
  outputFile: `parameter-scan-${new Date().toISOString().slice(0, 10)}.json`
};

const log = (msg) => console.log(msg);
const pct = (n) => (n * 100).toFixed(2) + '%';
const pctSigned = (n) => (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
const fmtNum = (n) => Number(n || 0).toLocaleString('id-ID');

function dateAdd(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    else if (diff < 0) lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }
  if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

async function main() {
  log('');
  log('============================================================');
  log(' PARAMETER SCAN — Test Individual Predictive Power');
  log('============================================================');
  log(` Period : ${CONFIG.startDate} → ${CONFIG.endDate}`);
  log(` Horizon: ${CONFIG.horizons.join('D, ')}D`);
  log('');

  // 1. Load stocks
  log('[1/5] Loading stocks...');
  const { data: stocks } = await supabase.from('stocks').select('id, code');
  const stockMap = {};
  stocks.forEach(s => stockMap[s.id] = s.code);
  log(`      ✅ ${stocks.length} stocks`);

  // 2. Load all daily data
  log('[2/5] Loading daily data...');
  const startFetch = dateAdd(CONFIG.startDate, -60);
  let allRows = [];
  let offset = 0;
  const PAGE = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: chunk, error } = await supabase
      .from('daily_stock_data')
      .select('stock_id, trade_date, close, high, low, open, volume, value, frequency, bid_volume, offer_volume, foreign_buy, foreign_sell')
      .gte('trade_date', startFetch)
      .lte('trade_date', CONFIG.endDate)
      .order('trade_date', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!chunk || !chunk.length) break;
    allRows = allRows.concat(chunk);
    offset += PAGE;
    process.stdout.write(`      📊 ${fmtNum(allRows.length)} rows...\r`);
    if (chunk.length < PAGE) hasMore = false;
  }
  log('');
  log(`      ✅ ${fmtNum(allRows.length)} rows loaded`);

  // 3. Group by stock
  log('[3/5] Grouping...');
  const byStock = {};
  allRows.forEach(r => {
    if (!byStock[r.stock_id]) byStock[r.stock_id] = [];
    byStock[r.stock_id].push(r);
  });
  Object.values(byStock).forEach(arr => {
    arr.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  });
  log(`      ✅ ${Object.keys(byStock).length} stocks grouped`);

  // 4. Get all unique dates
  const dateSet = new Set();
  allRows.forEach(r => {
    if (r.trade_date >= CONFIG.startDate && r.trade_date <= CONFIG.endDate) {
      dateSet.add(r.trade_date);
    }
  });
  const signalDates = [...dateSet].sort();
  log(`      ✅ ${signalDates.length} signal dates`);

  // 5. For each date, compute parameters & track forward return
  log('[4/5] Computing parameters & tracking returns...');
  log('');

  // Parameters to test
  // Each: name, thresholdFn (row context) -> boolean
  const parameters = [
    { name: 'BT Vol > 5M', test: (ctx) => (ctx.btVol || 0) > 5000000 },
    { name: 'BT Vol > 50M', test: (ctx) => (ctx.btVol || 0) > 50000000 },
    { name: 'BT/Total > 10%', test: (ctx) => ctx.btRatio > 0.10 },
    { name: 'Foreign Net > 0', test: (ctx) => ctx.foreignNet > 0 },
    { name: 'Foreign Buy% > 60', test: (ctx) => ctx.foreignBuyPct > 0.60 },
    { name: 'Bid/Offer > 2', test: (ctx) => ctx.bidOfferRatio > 2 },
    { name: 'Bid/Offer > 3', test: (ctx) => ctx.bidOfferRatio > 3 },
    { name: 'RSI < 40', test: (ctx) => ctx.rsi != null && ctx.rsi < 40 },
    { name: 'RSI < 30', test: (ctx) => ctx.rsi != null && ctx.rsi < 30 },
    { name: 'Close > SMA20', test: (ctx) => ctx.close > ctx.sma20 },
    { name: 'Close > SMA50', test: (ctx) => ctx.sma50 && ctx.close > ctx.sma50 },
    { name: 'Close < SMA20', test: (ctx) => ctx.close < ctx.sma20 },
    { name: 'Vol Surge > 3x', test: (ctx) => ctx.volSurge > 3 },
    { name: 'Vol Surge > 5x', test: (ctx) => ctx.volSurge > 5 },
    { name: 'BB Width < 0.06', test: (ctx) => ctx.bbWidth != null && ctx.bbWidth < 0.06 },
    { name: '52W Pos < 30%', test: (ctx) => ctx.pos52W != null && ctx.pos52W < 0.30 },
    { name: '52W Pos > 70%', test: (ctx) => ctx.pos52W != null && ctx.pos52W > 0.70 },
    { name: 'Close Pos > 0.8', test: (ctx) => ctx.closePos > 0.8 },
    { name: 'Turnover > 0.1%', test: (ctx) => ctx.turnover > 0.001 },
    { name: 'Value > 10B', test: (ctx) => ctx.value > 10000000000 }
  ];

  // For each parameter, collect all forward returns
  const paramResults = {};
  parameters.forEach(p => {
    paramResults[p.name] = {};
    CONFIG.horizons.forEach(h => {
      paramResults[p.name][h] = [];
    });
  });

  let processedDates = 0;
  for (const signalDate of signalDates) {
    processedDates++;
    if (processedDates % 10 === 0) {
      process.stdout.write(`      📈 ${processedDates}/${signalDates.length} dates (${Object.keys(paramResults).length} params)...\r`);
    }

    // For each stock, compute context at signalDate
    for (const stockId of Object.keys(byStock)) {
      const rows = byStock[stockId];
      // Find index of signalDate
      const idx = rows.findIndex(r => r.trade_date === signalDate);
      if (idx < CONFIG.minHistory) continue;

      const current = rows[idx];
      const close = Number(current.close);
      if (!close || close <= 0) continue;
      const value = Number(current.value);
      if (value < CONFIG.minValue) continue;

      // Lookback window
      const lookback = rows.slice(Math.max(0, idx - 60), idx + 1);
      const last20 = lookback.slice(-20);
      const last50 = lookback.slice(-50);

      // Compute parameters
      const ctx = {
        close,
        value,
        volume: Number(current.volume) || 0,
        frequency: Number(current.frequency) || 0,
        // BT Volume dalam 30 hari terakhir
        btVol: lookback.slice(-30).reduce((s, r) => s + (Number(r.non_regular_volume) || 0), 0),
        // Foreign Net hari ini
        foreignNet: (Number(current.foreign_buy) || 0) - (Number(current.foreign_sell) || 0),
        foreignBuyPct: (() => {
          const b = Number(current.foreign_buy) || 0;
          const s = Number(current.foreign_sell) || 0;
          const t = b + s;
          return t > 0 ? b / t : 0;
        })(),
        // Bid/Offer
        bidOfferRatio: (() => {
          const b = Number(current.bid_volume) || 0;
          const o = Number(current.offer_volume) || 0;
          return o > 0 ? b / o : 0;
        })(),
        // RSI
        rsi: computeRSI(last50.map(r => Number(r.close)), 14),
        // SMA
        sma20: mean(last20.map(r => Number(r.close))),
        sma50: last50.length >= 50 ? mean(last50.map(r => Number(r.close))) : null,
        // Vol surge
        volSurge: (() => {
          if (last20.length < 20) return 0;
          const avg20 = mean(last20.slice(0, -1).map(r => Number(r.volume) || 0));
          return avg20 > 0 ? (Number(current.volume) || 0) / avg20 : 0;
        })(),
        // BB Width
        bbWidth: (() => {
          if (last20.length < 20) return null;
          const closes = last20.map(r => Number(r.close));
          const avg = mean(closes);
          const std = stdDev(closes);
          return avg > 0 ? (4 * std) / avg : null;
        })(),
        // 52W Position (dari max lookback)
        pos52W: (() => {
          const highs = lookback.map(r => Number(r.high));
          const lows = lookback.map(r => Number(r.low));
          const hi = Math.max(...highs);
          const lo = Math.min(...lows);
          const range = hi - lo;
          return range > 0 ? (close - lo) / range : 0.5;
        })(),
        // Close Position hari ini
        closePos: (() => {
          const h = Number(current.high);
          const l = Number(current.low);
          const range = h - l;
          return range > 0 ? (close - l) / range : 0.5;
        })(),
        // Turnover (dari shares - skip karena tidak ada)
        turnover: 0.001 // default
      };

      // BT Ratio (BT / Total Vol)
      const totalVol30 = lookback.slice(-30).reduce((s, r) => s + (Number(r.volume) || 0), 0);
      ctx.btRatio = totalVol30 > 0 ? ctx.btVol / totalVol30 : 0;

      // Compute forward returns
      const forwardReturns = {};
      for (const h of CONFIG.horizons) {
        if (idx + h < rows.length) {
          const futureClose = Number(rows[idx + h].close);
          if (futureClose > 0 && close > 0) {
            forwardReturns[h] = (futureClose - close) / close;
          }
        }
      }

      // Test each parameter
      for (const p of parameters) {
        if (p.test(ctx)) {
          for (const h of CONFIG.horizons) {
            if (forwardReturns[h] !== undefined) {
              paramResults[p.name][h].push(forwardReturns[h]);
            }
          }
        }
      }
    }
  }

  log('');
  log(`      ✅ Scan complete`);

  // 6. Analyze
  log('[5/5] Analyzing results...');
  const analysis = analyzeParams(paramResults);

  // Save
  const outputDir = path.join(__dirname, '..', 'results');
  const outputPath = path.join(outputDir, CONFIG.outputFile);
  fs.writeFileSync(outputPath, JSON.stringify({
    config: CONFIG,
    parameters: analysis
  }, null, 2));

  printReport(analysis);
  
  log('');
  log(`💾 Saved: results/${CONFIG.outputFile}`);
  log('');
}

function analyzeParams(paramResults) {
  const analysis = [];
  for (const [name, horizons] of Object.entries(paramResults)) {
    const row = { name };
    for (const [h, returns] of Object.entries(horizons)) {
      if (!returns.length) {
        row[`h${h}`] = null;
        continue;
      }
      const wins = returns.filter(r => r > 0);
      const losses = returns.filter(r => r < 0);
      const grossProfit = wins.reduce((s, r) => s + r, 0);
      const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
      row[`h${h}`] = {
        count: returns.length,
        winRate: wins.length / returns.length,
        avgReturn: mean(returns),
        medianReturn: median(returns),
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 999
      };
    }
    analysis.push(row);
  }
  // Sort by 20D PF
  analysis.sort((a, b) => {
    const aPF = a.h20 ? a.h20.profitFactor : 0;
    const bPF = b.h20 ? b.h20.profitFactor : 0;
    return bPF - aPF;
  });
  return analysis;
}

function printReport(analysis) {
  log('');
  log('============================================================');
  log(' PARAMETER SCAN REPORT');
  log('============================================================');
  log('');
  log(' 📊 Ranked by H+20 Profit Factor');
  log('');
  log(' # │ Parameter              │ N 20D │ WR 20D │ Avg 20D │ PF 20D │ WR 5D  │ PF 5D');
  log(' ──┼────────────────────────┼───────┼────────┼─────────┼────────┼────────┼──────');
  
  analysis.forEach((row, i) => {
    const h20 = row.h20 || {};
    const h5 = row.h5 || {};
    const name = row.name.padEnd(22).slice(0, 22);
    const n20 = h20.count ? String(h20.count).padStart(5) : '  N/A';
    const wr20 = h20.winRate != null ? pct(h20.winRate).padStart(6) : '  N/A';
    const avg20 = h20.avgReturn != null ? pctSigned(h20.avgReturn).padStart(7) : '  N/A ';
    const pf20 = h20.profitFactor != null ? h20.profitFactor.toFixed(2).padStart(6) : '  N/A';
    const wr5 = h5.winRate != null ? pct(h5.winRate).padStart(6) : '  N/A';
    const pf5 = h5.profitFactor != null ? h5.profitFactor.toFixed(2).padStart(5) : '  N/A';
    log(` ${String(i+1).padStart(2)} │ ${name} │ ${n20} │ ${wr20} │ ${avg20} │ ${pf20} │ ${wr5} │ ${pf5}`);
  });
  log('');
  
  // Top 5 by PF
  const top5 = analysis.slice(0, 5);
  log(' 🏆 TOP 5 PARAMETER (by 20D PF):');
  top5.forEach((row, i) => {
    const h20 = row.h20 || {};
    if (h20.count) {
      log(`   ${i+1}. ${row.name.padEnd(25)} PF=${h20.profitFactor.toFixed(2)} WR=${pct(h20.winRate)} Avg=${pctSigned(h20.avgReturn)} N=${h20.count}`);
    }
  });
  
  log('');
  log(' 💡 INTERPRETASI:');
  log('   PF > 1.3 : ✅ KUAT — layak masuk formula');
  log('   PF 1.1-1.3 : 🟡 WEAK — bisa explore');
  log('   PF < 1.1 : ❌ TIDAK — jangan masuk formula');
  log('');
  log('============================================================');
}

main().catch(err => {
  console.error('');
  console.error('❌ FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
