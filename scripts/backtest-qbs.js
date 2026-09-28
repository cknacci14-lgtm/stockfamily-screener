// ============================================================
// QBS EVENT BACKTEST
// Track outcome 20 hari setelah event detection
// Mengikuti QBS spec V1.0.0 (outcome_tracking section)
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
  ledgerFile: './results/qbs_production_event_ledger.json',
  trajectory: [1, 2, 3, 4, 5, 10, 15, 20],
  targetMetrics: [5, 10, 15, 20],
  drawdownSteps: [3, 5, 7, 10, 15, 20],
  outputFile: `qbs-backtest-${new Date().toISOString().slice(0, 10)}.json`
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

async function main() {
  log('');
  log('============================================================');
  log(' QBS EVENT BACKTEST');
  log(' Track 20 hari setelah deteksi event');
  log('============================================================');
  log('');

  // 1. Load event ledger
  log('[1/4] Loading event ledger...');
  if (!fs.existsSync(CONFIG.ledgerFile)) {
    console.error('❌ Ledger tidak ditemukan:', CONFIG.ledgerFile);
    process.exit(1);
  }

  const ledgerData = JSON.parse(fs.readFileSync(CONFIG.ledgerFile, 'utf8'));
  const events = ledgerData.events || ledgerData;
  
  if (!Array.isArray(events)) {
    console.error('❌ Format ledger tidak valid');
    process.exit(1);
  }

  log(`      ✅ ${events.length} events loaded`);
  
  // Filter: yang punya data h0 valid
  const validEvents = events.filter(e => e.h0 && e.h0.close && e.eventDate);
  log(`      ✅ ${validEvents.length} events punya h0 valid`);
  log('');

  // 2. Ambil stock map
  log('[2/4] Loading stocks...');
  const { data: stocks } = await supabase.from('stocks').select('id, code');
  const stockMap = {};
  stocks.forEach(s => stockMap[s.code.toUpperCase()] = s.id);
  log(`      ✅ ${Object.keys(stockMap).length} stocks`);
  log('');

  // 3. Track setiap event
  log('[3/4] Tracking outcomes...');
  const results = [];

  for (let i = 0; i < validEvents.length; i++) {
    const event = validEvents[i];
    const code = String(event.symbol || '').toUpperCase();
    const stockId = stockMap[code];
    
    if (!stockId) {
      log(`      ⚠️ ${code} tidak ditemukan di stocks`);
      continue;
    }

    const signalDate = event.eventDate;
    const h0Close = Number(event.h0.close);

    // Query 20 hari ke depan
    const { data: futureRowsRaw } = await supabase
      .from('daily_stock_data')
      .select('trade_date, close, high, low, open, volume, value')
      .eq('stock_id', stockId)
      .gt('trade_date', signalDate)
      .order('trade_date', { ascending: true })
      .limit(25);

    // FILTER: Buang hari dengan high=0 atau low=0 (no trading)
    const futureRows = (futureRowsRaw || []).filter(r => 
      Number(r.close) > 0 && 
      Number(r.high) > 0 && 
      Number(r.low) > 0
    ).slice(0, 20);

    if (!futureRows || !futureRows.length) {
      log(`      ⚠️ ${code} ${signalDate} — no future data`);
      continue;
    }

    // Hitung metrik per spec
    const trajectory = {};
    let maxHigh = h0Close;
    let minLow = h0Close;
    let maxFavorable = 0; // MFE
    let maxAdverse = 0;   // MAE (negative)

    CONFIG.trajectory.forEach(step => {
      const idx = step - 1;
      if (idx >= futureRows.length) return;
      
      const row = futureRows[idx];
      const ret = (Number(row.close) - h0Close) / h0Close;
      trajectory[`h_plus_${step}`] = {
        date: row.trade_date,
        close: Number(row.close),
        high: Number(row.high),
        low: Number(row.low),
        return: ret
      };

      // Track MFE & MAE
      const highRet = (Number(row.high) - h0Close) / h0Close;
      const lowRet = (Number(row.low) - h0Close) / h0Close;
      if (highRet > maxFavorable) maxFavorable = highRet;
      if (lowRet < maxAdverse) maxAdverse = lowRet;
      if (Number(row.high) > maxHigh) maxHigh = Number(row.high);
      if (Number(row.low) < minLow) minLow = Number(row.low);
    });

    // Target metrics (HIGH_5, HIGH_10, ...)
    const targetMetrics = {};
    CONFIG.targetMetrics.forEach(step => {
      const traj = trajectory[`h_plus_${step}`];
      if (traj) {
        targetMetrics[`high_${step}`] = (traj.high - h0Close) / h0Close;
        targetMetrics[`close_${step}`] = traj.return;
      }
    });

    // Drawdown metrics
    const drawdowns = {};
    CONFIG.drawdownSteps.forEach(step => {
      const traj = trajectory[`h_plus_${step}`];
      if (traj) {
        // Max drawdown dari H0 ke H+step
        let maxDD = 0;
        for (let s = 1; s <= step; s++) {
          const t = trajectory[`h_plus_${s}`];
          if (t && t.return < maxDD) maxDD = t.return;
        }
        drawdowns[`dd_${step}`] = maxDD;
      }
    });

    // Time to target (5%, 10%, 15%, 20%)
    const timeToTarget = {};
    [0.05, 0.10, 0.15, 0.20].forEach(target => {
      let timeToHit = null;
      for (let s = 1; s <= futureRows.length; s++) {
        const t = trajectory[`h_plus_${s}`];
        if (t && ((t.high - h0Close) / h0Close) >= target) {
          timeToHit = s;
          break;
        }
      }
      timeToTarget[`time_to_${(target*100).toFixed(0)}pct`] = timeToHit;
    });

    results.push({
      symbol: code,
      event_date: signalDate,
      qbs_score: event.qbsScore,
      qbs_band: event.qbsBand,
      state: event.state,
      h0_close: h0Close,
      mfe: maxFavorable,      // Maximum Favorable Excursion
      mae: maxAdverse,        // Maximum Adverse Excursion
      max_high: (maxHigh - h0Close) / h0Close,
      min_low: (minLow - h0Close) / h0Close,
      trajectory,
      target_metrics: targetMetrics,
      drawdowns,
      time_to_target: timeToTarget,
      data_points: futureRows.length
    });

    process.stdout.write(`      📊 [${i+1}/${validEvents.length}] ${code} @ ${signalDate} — done\r`);
  }

  log('');
  log(`      ✅ ${results.length} events tracked`);
  log('');

  // 4. Analysis
  log('[4/4] Analyzing...');
  const analysis = analyzeResults(results);

  // Save
  const outputDir = path.join(__dirname, '..', 'results');
  const outputPath = path.join(outputDir, CONFIG.outputFile);
  fs.writeFileSync(outputPath, JSON.stringify({
    config: CONFIG,
    summary: analysis.summary,
    events: results
  }, null, 2));

  printReport(results, analysis);
  
  log('');
  log(`💾 Saved: results/${CONFIG.outputFile}`);
  log('');
}

function analyzeResults(results) {
  const valid = results.filter(r => r.data_points >= 10);
  
  const summary = {
    totalEvents: results.length,
    eventsWithData: valid.length,
    // Return stats pada setiap horizon
    byHorizon: {}
  };

  [5, 10, 15, 20].forEach(h => {
    const closes = valid.map(r => r.target_metrics[`close_${h}`]).filter(v => v !== undefined);
    const highs = valid.map(r => r.target_metrics[`high_${h}`]).filter(v => v !== undefined);
    const dds = valid.map(r => r.drawdowns[`dd_${h}`]).filter(v => v !== undefined);

    if (!closes.length) return;

    const wins = closes.filter(c => c > 0);
    const losses = closes.filter(c => c < 0);
    const grossProfit = wins.reduce((s, v) => s + v, 0);
    const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));

    summary.byHorizon[`h_plus_${h}`] = {
      count: closes.length,
      winRate: wins.length / closes.length,
      avgCloseReturn: mean(closes),
      medianCloseReturn: median(closes),
      avgHighReturn: mean(highs),
      avgMaxDrawdown: mean(dds),
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 999,
      best: Math.max(...closes),
      worst: Math.min(...closes)
    };
  });

  // By QBS Band
  const byBand = {};
  ['0-3', '4-6', '7-9', '10+'].forEach(band => {
    const subset = valid.filter(r => r.qbs_band === band);
    if (!subset.length) return;
    const closes = subset.map(r => r.target_metrics.close_20).filter(v => v !== undefined);
    if (!closes.length) return;
    const wins = closes.filter(c => c > 0);
    byBand[band] = {
      count: subset.length,
      winRate: wins.length / closes.length,
      avgReturn: mean(closes),
      medianReturn: median(closes),
      avgMFE: mean(subset.map(r => r.mfe)),
      avgMAE: mean(subset.map(r => r.mae))
    };
  });

  // Time to target analysis
  const timeToTarget = {};
  [5, 10, 15, 20].forEach(target => {
    const times = valid.map(r => r.time_to_target[`time_to_${target}pct`]).filter(v => v !== null);
    if (!times.length) return;
    timeToTarget[`${target}pct`] = {
      hitCount: times.length,
      hitRate: times.length / valid.length,
      avgDays: mean(times),
      medianDays: median(times)
    };
  });

  return { summary, byBand, timeToTarget };
}

function printReport(results, a) {
  log('');
  log('============================================================');
  log(' QBS BACKTEST REPORT');
  log('============================================================');
  log('');
  log(` Total events     : ${a.summary.totalEvents}`);
  log(` Events with data : ${a.summary.eventsWithData}`);
  log('');

  log('📊 RETURN BY HORIZON (close-to-close)');
  log('');
  log(' Horizon | N  | Win%   | Avg Return | Median | Avg DD  | PF   ');
  log(' --------|----|--------|------------|--------|---------|------');
  for (const [h, s] of Object.entries(a.summary.byHorizon)) {
    const label = h.replace('h_plus_', 'H+').padEnd(6);
    log(` ${label} | ${String(s.count).padStart(2)} | ${pct(s.winRate).padStart(6)} | ${pctSigned(s.avgCloseReturn).padStart(10)} | ${pctSigned(s.medianCloseReturn).padStart(6)} | ${pct(s.avgMaxDrawdown).padStart(7)} | ${s.profitFactor.toFixed(2)}`);
  }
  log('');

  log('🎯 BY QBS BAND (H+20)');
  log('');
  log(' Band  | N  | Win%   | Avg Return | Avg MFE | Avg MAE');
  log(' ------|----|--------|------------|---------|--------');
  for (const [band, s] of Object.entries(a.byBand)) {
    log(` ${band.padEnd(5)} | ${String(s.count).padStart(2)} | ${pct(s.winRate).padStart(6)} | ${pctSigned(s.avgReturn).padStart(10)} | ${pctSigned(s.avgMFE).padStart(7)} | ${pctSigned(s.avgMAE).padStart(7)}`);
  }
  log('');

  log('⏱️ TIME TO TARGET');
  log('');
  log(' Target | Hit | Rate   | Avg Days | Median Days');
  log(' -------|-----|--------|----------|------------');
  for (const [target, s] of Object.entries(a.timeToTarget)) {
    log(` ${target.padEnd(6)} | ${String(s.hitCount).padStart(3)} | ${pct(s.hitRate).padStart(6)} | ${s.avgDays.toFixed(1).padStart(8)} | ${s.medianDays.toFixed(1).padStart(11)}`);
  }
  log('');

  // Detail per event
  log('📋 EVENT DETAILS');
  log('');
  log(' Symbol | Date       | Band  | H0 Close | H+20 Close | Return | MFE    | MAE    | Days');
  log(' -------|------------|-------|----------|------------|--------|--------|--------|-----');
  results.forEach(r => {
    const h20 = r.trajectory.h_plus_20;
    const ret = h20 ? h20.return : null;
    const daysHit = r.time_to_target.time_to_5pct;
    log(` ${r.symbol.padEnd(6)} | ${r.event_date} | ${String(r.qbs_band).padEnd(5)} | ${fmtNum(r.h0_close).padStart(8)} | ${h20 ? fmtNum(h20.close).padStart(10) : '  N/A     '} | ${ret !== null ? pctSigned(ret).padStart(6) : ' N/A  '} | ${pctSigned(r.mfe).padStart(6)} | ${pctSigned(r.mae).padStart(6)} | ${daysHit ? String(daysHit).padStart(3) : ' N/A'}`);
  });
  log('');

  log('============================================================');
  log(' VERDICT (descriptive only — small sample)');
  log('============================================================');
  const h20 = a.summary.byHorizon.h_plus_20;
  if (h20) {
    log(` Win Rate H+20 : ${pct(h20.winRate)}`);
    log(` Avg Return    : ${pctSigned(h20.avgCloseReturn)}`);
    log(` Profit Factor : ${h20.profitFactor.toFixed(2)}`);
    log('');
    log(` ⚠️  Sample size: ${h20.count} events — VERY SMALL`);
    log(` ⚠️  Hasil ini DESKRIPTIF, bukan probability`);
    log(` ⚠️  QBS spec warning: "must not be converted to production probabilities"`);
  }
  log('');
  log('============================================================');
}

main().catch(err => {
  console.error('');
  console.error('❌ FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
