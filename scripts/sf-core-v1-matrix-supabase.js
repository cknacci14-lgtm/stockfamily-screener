require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../src/database/historicalDb');

const OUTPUT_DIR = path.join(__dirname, '../data/backtest');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const CONFIG = {
  version: 'SF_CORE_V1',

  // ==========================================================
  // DATA
  // ==========================================================
  startDate: '2025-09-01',
  endDate: '2026-09-24',

  // ==========================================================
  // LIQUIDITY FILTERS
  // ==========================================================
  minValue: 10_000_000_000,
  minFrequency: 1500,
  minVolume: 100_000,
  minHistoryDays: 60,

  // ==========================================================
  // COMPONENT WEIGHTS
  // ==========================================================
  weights: {
    price: 0.25,
    participation: 0.25,
    capital: 0.20,
    flow: 0.15,
    structure: 0.15
  },

  // ==========================================================
  // SCORE
  // ==========================================================
  scoreThresholds: [60, 65, 70, 75, 80, 85],

  // ==========================================================
  // FEATURE THRESHOLDS
  // ==========================================================
  volumeRatioThresholds: [1.2, 1.5, 2.0, 2.5, 3.0],
  frequencyRatioThresholds: [1.2, 1.5, 2.0, 2.5, 3.0],
  valueRatioThresholds: [1.2, 1.5, 2.0, 2.5, 3.0],
  rangeExpansionThresholds: [1.2, 1.5, 2.0, 2.5, 3.0],

  // ==========================================================
  // FORWARD RETURNS
  // ==========================================================
  holdingDays: [1, 3, 5, 10, 20],

  // ==========================================================
  // RISK
  // ==========================================================
  riskLambda: 0.20,

  // ==========================================================
  // ENTRY
  // ==========================================================
  entryMode: 'next_open'
};

// ============================================================
// HELPERS
// ============================================================

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeDiv(a, b) {
  return b === 0 ? 0 : a / b;
}

function mean(arr) {
  const x = arr.filter(Number.isFinite);
  if (!x.length) return 0;
  return x.reduce((a, b) => a + b, 0) / x.length;
}

function median(arr) {
  const x = arr
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!x.length) return 0;

  const m = Math.floor(x.length / 2);

  return x.length % 2
    ? x[m]
    : (x[m - 1] + x[m]) / 2;
}

function percentile(arr, p) {
  const x = arr
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!x.length) return 0;

  const index = (x.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return x[lower];

  return x[lower] +
    (x[upper] - x[lower]) * (index - lower);
}

function normalize(value, p10, p90) {
  if (!Number.isFinite(value)) return 0.5;

  if (p90 <= p10) return 0.5;

  return Math.max(
    0,
    Math.min(
      1,
      (value - p10) / (p90 - p10)
    )
  );
}

function logRatio(x) {
  return Math.log1p(Math.max(0, x));
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';

  const s = String(value);

  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }

  return s;
}

// ============================================================
// ROLLING HELPERS
// ============================================================

function rollingMean(values, index, window) {
  const start = Math.max(0, index - window + 1);

  const arr = [];

  for (let i = start; i <= index; i++) {
    if (Number.isFinite(values[i])) {
      arr.push(values[i]);
    }
  }

  return mean(arr);
}

function previousRollingMean(values, index, window) {
  const end = index - 1;

  if (end < 0) return 0;

  const start = Math.max(0, end - window + 1);

  const arr = [];

  for (let i = start; i <= end; i++) {
    if (Number.isFinite(values[i])) {
      arr.push(values[i]);
    }
  }

  return mean(arr);
}

function persistence(values, index, window, predicate) {
  const start = Math.max(0, index - window + 1);

  let valid = 0;
  let passed = 0;

  for (let i = start; i <= index; i++) {
    if (!Number.isFinite(values[i])) continue;

    valid++;

    if (predicate(values[i], i)) {
      passed++;
    }
  }

  return valid ? passed / valid : 0;
}

// ============================================================
// BUILD STOCK SERIES
// ============================================================

function buildSeries(rows) {
  const map = new Map();

  for (const row of rows) {
    const code = String(row.code || '').trim().toUpperCase();

    if (!code) continue;

    if (!map.has(code)) {
      map.set(code, {
        code,
        name: row.name || '',
        rows: []
      });
    }

    map.get(code).rows.push(row);
  }

  for (const stock of map.values()) {
    stock.rows.sort((a, b) =>
      String(a.trade_date).localeCompare(String(b.trade_date))
    );
  }

  return map;
}

// ============================================================
// FEATURE ENGINE
// ============================================================

function calculateFeatures(rows) {
  const n = rows.length;

  const features = [];

  const volumes = rows.map(r => num(r.volume));
  const values = rows.map(r => num(r.value));
  const frequencies = rows.map(r => num(r.frequency));
  const ranges = rows.map(r => {
    const prev = num(r.previous_price);

    return prev > 0
      ? (num(r.high) - num(r.low)) / prev
      : 0;
  });

  const returns = rows.map((r, i) => {
    if (i === 0) return 0;

    const prevClose = num(rows[i - 1].close);
    const close = num(r.close);

    return prevClose > 0
      ? close / prevClose - 1
      : 0;
  });

  for (let i = 0; i < n; i++) {
    const r = rows[i];

    const previous = num(r.previous_price);
    const open = num(r.open);
    const high = num(r.high);
    const low = num(r.low);
    const close = num(r.close);

    const range = high - low;

    // --------------------------------------------------------
    // PRICE
    // --------------------------------------------------------

    const bodyPct =
      previous > 0
        ? Math.abs(close - open) / previous
        : 0;

    const closePosition =
      range > 0
        ? (close - low) / range
        : 0.5;

    const return5d =
      i >= 5 && num(rows[i - 5].close) > 0
        ? close / num(rows[i - 5].close) - 1
        : 0;

    // --------------------------------------------------------
    // PARTICIPATION
    // --------------------------------------------------------

    const volumeMA20 =
      previousRollingMean(volumes, i, 20);

    const frequencyMA20 =
      previousRollingMean(frequencies, i, 20);

    const volumeRatio =
      volumeMA20 > 0
        ? volumes[i] / volumeMA20
        : 0;

    const frequencyRatio =
      frequencyMA20 > 0
        ? frequencies[i] / frequencyMA20
        : 0;

    const activityPersistence5d =
      persistence(
        volumes,
        i,
        5,
        (v, j) =>
          previousRollingMean(volumes, j, 20) > 0 &&
          v / previousRollingMean(volumes, j, 20) >= 1
      );

    // --------------------------------------------------------
    // CAPITAL
    // --------------------------------------------------------

    const valueMA20 =
      previousRollingMean(values, i, 20);

    const valueRatio =
      valueMA20 > 0
        ? values[i] / valueMA20
        : 0;

    // --------------------------------------------------------
    // FLOW
    // --------------------------------------------------------

    const foreignBuy = num(r.foreign_buy);
    const foreignSell = num(r.foreign_sell);

    const netForeign =
      foreignBuy - foreignSell;

    const foreignRatio =
      values[i] > 0
        ? netForeign / values[i]
        : 0;

    const foreignPersistence5d =
      persistence(
        rows.map(x =>
          num(x.foreign_buy) - num(x.foreign_sell)
        ),
        i,
        5,
        v => v > 0
      );

    // --------------------------------------------------------
    // STRUCTURE
    // --------------------------------------------------------

    const rangeMA20 =
      previousRollingMean(ranges, i, 20);

    const rangeExpansion =
      rangeMA20 > 0
        ? ranges[i] / rangeMA20
        : 0;

    const range5 =
      i >= 5
        ? mean(ranges.slice(i - 5, i))
        : ranges[i];

    const range20 =
      i >= 20
        ? mean(ranges.slice(i - 20, i))
        : range5;

    const compression =
      range20 > 0
        ? Math.max(
            0,
            Math.min(
              1,
              1 - range5 / range20
            )
          )
        : 0;

    // --------------------------------------------------------
    // RISK
    // --------------------------------------------------------

    const downsideWindow =
      returns.slice(
        Math.max(0, i - 19),
        i + 1
      );

    const negativeReturns =
      downsideWindow
        .filter(x => x < 0)
        .map(x => x * x);

    const downsideDeviation =
      negativeReturns.length
        ? Math.sqrt(mean(negativeReturns))
        : 0;

    // --------------------------------------------------------
    // TREND
    // --------------------------------------------------------

    const closes = rows.map(x => num(x.close));

    const sma20 =
      rollingMean(closes, i, 20);

    const sma50 =
      rollingMean(closes, i, 50);

    const trend =
      close > sma20 &&
      sma20 > sma50;

    // --------------------------------------------------------
    // 52 WEEK
    // --------------------------------------------------------

    const start52 =
      Math.max(0, i - 251);

    const window52 =
      closes.slice(start52, i + 1);

    const high52 =
      Math.max(...window52);

    const low52 =
      Math.min(...window52);

    const position52 =
      high52 > low52
        ? (close - low52) / (high52 - low52)
        : 0.5;

    features.push({
      index: i,
      date: String(r.trade_date).slice(0, 10),

      code: rows[i].code,
      name: rows[i].name,

      open,
      high,
      low,
      close,
      previous,

      volume: volumes[i],
      value: values[i],
      frequency: frequencies[i],

      foreignBuy,
      foreignSell,
      netForeign,

      bodyPct,
      closePosition,
      return5d,

      volumeRatio,
      frequencyRatio,
      activityPersistence5d,

      valueRatio,

      foreignRatio,
      foreignPersistence5d,

      rangePct: ranges[i],
      rangeExpansion,
      compression,

      downsideDeviation,

      sma20,
      sma50,
      trend,

      position52,

      historyLength: i + 1
    });
  }

  return features;
}

// ============================================================
// CROSS-SECTIONAL NORMALIZATION
// ============================================================

function normalizeCrossSection(rows, key) {
  const values = rows
    .map(r => r[key])
    .filter(Number.isFinite);

  const p10 = percentile(values, 0.10);
  const p90 = percentile(values, 0.90);

  for (const r of rows) {
    r[`${key}_N`] =
      normalize(r[key], p10, p90);
  }
}

// ============================================================
// COMPONENT SCORES
// ============================================================

function calculateScores(dayRows) {

  const normalizationKeys = [
    'bodyPct',
    'closePosition',
    'return5d',

    'volumeRatio',
    'frequencyRatio',
    'activityPersistence5d',

    'valueRatio',
    'value',

    'foreignRatio',
    'foreignPersistence5d',

    'rangeExpansion',
    'compression',

    'downsideDeviation'
  ];

  for (const key of normalizationKeys) {
    normalizeCrossSection(dayRows, key);
  }

  for (const r of dayRows) {

    // PRICE RESPONSE
    r.priceScore =
      100 * (
        0.40 * r.bodyPct_N +
        0.35 * r.closePosition_N +
        0.25 * r.return5d_N
      );

    // PARTICIPATION
    r.participationScore =
      100 * (
        0.40 * normalize(
          logRatio(r.volumeRatio),
          0,
          Math.log1p(5)
        ) +
        0.35 * normalize(
          logRatio(r.frequencyRatio),
          0,
          Math.log1p(5)
        ) +
        0.25 * r.activityPersistence5d_N
      );

    // CAPITAL
    r.capitalScore =
      100 * (
        0.70 * normalize(
          logRatio(r.valueRatio),
          0,
          Math.log1p(5)
        ) +
        0.30 * r.value_N
      );

    // FLOW
    r.flowScore =
      100 * (
        0.60 * r.foreignRatio_N +
        0.40 * r.foreignPersistence5d_N
      );

    // STRUCTURE
    r.structureScore =
      100 * (
        0.60 * r.rangeExpansion_N +
        0.40 * r.compression_N
      );

    // CORE
    r.coreScore =
      CONFIG.weights.price * r.priceScore +
      CONFIG.weights.participation * r.participationScore +
      CONFIG.weights.capital * r.capitalScore +
      CONFIG.weights.flow * r.flowScore +
      CONFIG.weights.structure * r.structureScore;

    // RISK ADJUSTMENT
    r.riskScore =
      100 * r.downsideDeviation_N;

    r.riskAdjustedScore =
      r.coreScore *
      (
        1 -
        CONFIG.riskLambda *
        r.riskScore / 100
      );
  }

  return dayRows;
}

// ============================================================
// FORWARD RETURNS
// ============================================================

function addForwardReturns(features) {

  for (const f of features) {

    for (const days of CONFIG.holdingDays) {

      const targetIndex =
        f.index + days;

      const target =
        features[targetIndex];

      if (!target) {
        f[`return_${days}d`] = null;
        continue;
      }

      if (!target.close || !f.entryPrice) {
        f[`return_${days}d`] = null;
        continue;
      }

      f[`return_${days}d`] =
        target.close / f.entryPrice - 1;
    }
  }
}

// ============================================================
// SIGNAL FILTER
// ============================================================

function eligible(f) {

  return (
    f.historyLength >= CONFIG.minHistoryDays &&
    f.value >= CONFIG.minValue &&
    f.frequency >= CONFIG.minFrequency &&
    f.volume >= CONFIG.minVolume
  );
}

// ============================================================
// METRICS
// ============================================================

function calculateMetrics(signals, returnKey) {

  const returns = signals
    .map(s => s[returnKey])
    .filter(Number.isFinite);

  if (!returns.length) {
    return {
      signals: 0,
      winRate: 0,
      averageReturn: 0,
      medianReturn: 0,
      profitFactor: 0,
      expectancy: 0,
      averageWin: 0,
      averageLoss: 0,
      bestTrade: 0,
      worstTrade: 0
    };
  }

  const wins = returns.filter(x => x > 0);
  const losses = returns.filter(x => x < 0);

  const grossProfit =
    wins.reduce((s, x) => s + x, 0);

  const grossLoss =
    Math.abs(
      losses.reduce((s, x) => s + x, 0)
    );

  return {
    signals: returns.length,

    winRate:
      wins.length / returns.length,

    averageReturn:
      mean(returns),

    medianReturn:
      median(returns),

    profitFactor:
      grossLoss > 0
        ? grossProfit / grossLoss
        : wins.length
          ? Infinity
          : 0,

    expectancy:
      mean(returns),

    averageWin:
      mean(wins),

    averageLoss:
      mean(losses),

    bestTrade:
      Math.max(...returns),

    worstTrade:
      Math.min(...returns)
  };
}

// ============================================================
// MAX DRAWDOWN
// ============================================================

function maxDrawdown(returns) {

  let equity = 1;
  let peak = 1;
  let maxDD = 0;

  for (const r of returns) {

    equity *= (1 + r);

    if (equity > peak) {
      peak = equity;
    }

    const dd =
      equity / peak - 1;

    if (dd < maxDD) {
      maxDD = dd;
    }
  }

  return maxDD;
}

// ============================================================
// MAIN
// ============================================================

async function main() {

  console.log('');
  console.log('================================================');
  console.log('SF CORE V1 — SUPABASE MATRIX BACKTEST');
  console.log('================================================');
  console.log('');

  console.log('Config:', CONFIG);
  console.log('');

  if (!db.useSupabase) {
    throw new Error(
      'Supabase tidak aktif. Periksa .env'
    );
  }

  console.log(
    `[1/6] Loading Supabase history ${CONFIG.startDate} → ${CONFIG.endDate}`
  );

  const rows =
    await db.getAllHistory(
      CONFIG.startDate,
      CONFIG.endDate
    );

  console.log(
    `Loaded ${rows.length.toLocaleString()} rows`
  );

  if (!rows.length) {
    throw new Error(
      'Tidak ada data historis.'
    );
  }

  console.log(
    `[2/6] Building stock series`
  );

  const stockMap =
    buildSeries(rows);

  console.log(
    `Stocks: ${stockMap.size}`
  );

  console.log(
    `[3/6] Calculating features`
  );

  const allFeatures = [];

  for (const stock of stockMap.values()) {

    const features =
      calculateFeatures(stock.rows);

    allFeatures.push(...features);
  }

  console.log(
    `Features: ${allFeatures.length.toLocaleString()}`
  );

  console.log(
    `[4/6] Cross-sectional scoring`
  );

  const byDate = new Map();

  for (const f of allFeatures) {

    if (!byDate.has(f.date)) {
      byDate.set(f.date, []);
    }

    byDate.get(f.date).push(f);
  }

  for (const dayRows of byDate.values()) {
    calculateScores(dayRows);
  }

  // ----------------------------------------------------------
  // Attach next-open entry
  // ----------------------------------------------------------

  for (const stock of stockMap.values()) {

    const features =
      allFeatures.filter(
        f => f.code === stock.code
      );

    for (let i = 0; i < features.length; i++) {

      const current = features[i];
      const next = features[i + 1];

      if (!next) {
        current.entryPrice = null;
        continue;
      }

      current.entryPrice =
        num(next.open);

      current.entryDate =
        next.date;
    }

    addForwardReturns(features);
  }

  console.log(
    `[5/6] Running signal matrix`
  );

  const matrix = [];

  for (const scoreThreshold of CONFIG.scoreThresholds) {

    for (
      const volumeThreshold
      of CONFIG.volumeRatioThresholds
    ) {

      for (
        const frequencyThreshold
        of CONFIG.frequencyRatioThresholds
      ) {

        for (
          const valueThreshold
          of CONFIG.valueRatioThresholds
        ) {

          for (
            const rangeThreshold
            of CONFIG.rangeExpansionThresholds
          ) {

            const signals =
              allFeatures.filter(f =>
                eligible(f) &&
                f.entryPrice &&
                f.riskAdjustedScore >= scoreThreshold &&
                f.volumeRatio >= volumeThreshold &&
                f.frequencyRatio >= frequencyThreshold &&
                f.valueRatio >= valueThreshold &&
                f.rangeExpansion >= rangeThreshold
              );

            for (const days of CONFIG.holdingDays) {

              const key =
                `return_${days}d`;

              const metrics =
                calculateMetrics(
                  signals,
                  key
                );

              const returns =
                signals
                  .map(s => s[key])
                  .filter(Number.isFinite);

              matrix.push({
                score_threshold: scoreThreshold,
                volume_ratio_threshold: volumeThreshold,
                frequency_ratio_threshold: frequencyThreshold,
                value_ratio_threshold: valueThreshold,
                range_expansion_threshold: rangeThreshold,
                holding_days: days,

                ...metrics,

                maxDrawdown:
                  maxDrawdown(returns)
              });
            }
          }
        }
      }
    }
  }

  console.log(
    `[6/6] Writing results`
  );

  const timestamp =
    new Date()
      .toISOString()
      .replace(/[:.]/g, '-');

  // ----------------------------------------------------------
  // Matrix CSV
  // ----------------------------------------------------------

  const headers =
    Object.keys(matrix[0] || {});

  const csv = [
    headers.join(','),
    ...matrix.map(row =>
      headers
        .map(h => csvEscape(row[h]))
        .join(',')
    )
  ].join('\n');

  const matrixFile =
    path.join(
      OUTPUT_DIR,
      `sf-core-v1-matrix-${timestamp}.csv`
    );

  fs.writeFileSync(
    matrixFile,
    csv
  );

  // ----------------------------------------------------------
  // Signal detail
  // ----------------------------------------------------------

  const signalThreshold = 70;

  const signals =
    allFeatures
      .filter(f =>
        eligible(f) &&
        f.entryPrice &&
        f.riskAdjustedScore >= signalThreshold
      )
      .map(f => ({
        date: f.date,
        code: f.code,
        name: f.name,

        priceScore: f.priceScore,
        participationScore: f.participationScore,
        capitalScore: f.capitalScore,
        flowScore: f.flowScore,
        structureScore: f.structureScore,

        coreScore: f.coreScore,
        riskScore: f.riskScore,
        riskAdjustedScore: f.riskAdjustedScore,

        volumeRatio: f.volumeRatio,
        frequencyRatio: f.frequencyRatio,
        valueRatio: f.valueRatio,
        rangeExpansion: f.rangeExpansion,

        foreignRatio: f.foreignRatio,

        entryDate: f.entryDate,
        entryPrice: f.entryPrice,

        return_1d: f.return_1d,
        return_3d: f.return_3d,
        return_5d: f.return_5d,
        return_10d: f.return_10d,
        return_20d: f.return_20d
      }));

  const signalHeaders =
    Object.keys(signals[0] || {});

  const signalCSV = [
    signalHeaders.join(','),
    ...signals.map(row =>
      signalHeaders
        .map(h => csvEscape(row[h]))
        .join(',')
    )
  ].join('\n');

  const signalFile =
    path.join(
      OUTPUT_DIR,
      `sf-core-v1-signals-${timestamp}.csv`
    );

  fs.writeFileSync(
    signalFile,
    signalCSV
  );

  // ----------------------------------------------------------
  // Summary JSON
  // ----------------------------------------------------------

  const summary = {
    version: CONFIG.version,

    generatedAt:
      new Date().toISOString(),

    data: {
      startDate: CONFIG.startDate,
      endDate: CONFIG.endDate,
      rows: rows.length,
      stocks: stockMap.size,
      tradingDates: byDate.size
    },

    config: CONFIG,

    signalsAt70:
      signals.length,

    files: {
      matrix: matrixFile,
      signals: signalFile
    }
  };

  const summaryFile =
    path.join(
      OUTPUT_DIR,
      `sf-core-v1-summary-${timestamp}.json`
    );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(
      summary,
      null,
      2
    )
  );

  console.log('');
  console.log('================================================');
  console.log('BACKTEST COMPLETE');
  console.log('================================================');

  console.log(
    `Rows       : ${rows.length.toLocaleString()}`
  );

  console.log(
    `Stocks     : ${stockMap.size}`
  );

  console.log(
    `Dates      : ${byDate.size}`
  );

  console.log(
    `Signals ≥70: ${signals.length}`
  );

  console.log('');
  console.log('Matrix :', matrixFile);
  console.log('Signals:', signalFile);
  console.log('Summary:', summaryFile);
  console.log('');
}

main().catch(err => {
  console.error('');
  console.error('BACKTEST ERROR');
  console.error(err);
  process.exit(1);
});