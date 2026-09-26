const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const INPUT = path.join(ROOT, "data", "daily_stock_data_export_with_code.csv");
const OUT = path.join(ROOT, "backtest-results");

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const CONFIG = {
  version: "SF_CORE_V1_MATRIX",

  thresholds: [60, 65, 70, 75, 80, 85],

  volumeRatio: [1.2, 1.5, 2.0, 2.5, 3.0],
  frequencyRatio: [1.2, 1.5, 2.0, 2.5, 3.0],
  valueRatio: [1.2, 1.5, 2.0, 2.5, 3.0],
  rangeExpansion: [1.2, 1.5, 2.0, 2.5, 3.0],

  persistence: [2, 3, 4, 5],

  riskLambda: [0, 0.10, 0.20, 0.30, 0.40],

  liquidity: {
    minValue: 10_000_000_000,
    minFrequency: 1500,
    minVolume: 100_000,
    minHistoryDays: 60
  },

  weights: {
    price: 0.25,
    participation: 0.25,
    capital: 0.20,
    flow: 0.15,
    structure: 0.15
  },

  entry: "next_open",

  horizons: [1, 3, 5, 10, 20]
};

function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }

  out.push(cur);
  return out;
}

function num(v) {
  if (v === null || v === undefined || v === "") return NaN;

  const s = String(v)
    .replace(/"/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .trim();

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeHeader(x) {
  return String(x)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

console.log("==============================================");
console.log(" STOCKFAMILY — SF_CORE_V1 MATRIX ENGINE");
console.log("==============================================");

if (!fs.existsSync(INPUT)) {
  console.error(`CSV tidak ditemukan:\n${INPUT}`);
  process.exit(1);
}

console.log(`INPUT : ${INPUT}`);
console.log(`OUTPUT: ${OUT}`);

const raw = fs.readFileSync(INPUT, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);

const headers = parseCSVLine(lines[0]).map(normalizeHeader);

console.log(`Rows CSV : ${lines.length - 1}`);
console.log(`Columns  : ${headers.length}`);

const required = [
  "date",
  "code",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "value",
  "frequency",
  "foreign_buy",
  "foreign_sell"
];

const aliases = {
  date: ["date", "trade_date", "tanggal"],
  code: ["code", "stock_code", "kode_saham", "symbol"],
  open: ["open", "open_price"],
  high: ["high", "highest", "tertinggi"],
  low: ["low", "lowest", "terendah"],
  close: ["close", "closing_price", "penutupan"],
  volume: ["volume"],
  value: ["value", "nilai"],
  frequency: ["frequency", "frekuensi"],
  foreign_buy: ["foreign_buy"],
  foreign_sell: ["foreign_sell"]
};

function findColumn(name) {
  for (const candidate of aliases[name]) {
    const i = headers.indexOf(candidate);
    if (i >= 0) return i;
  }
  return -1;
}

const IDX = {};

for (const key of required) {
  IDX[key] = findColumn(key);

  if (IDX[key] < 0) {
    console.error(`MISSING COLUMN: ${key}`);
    process.exit(1);
  }
}

console.log("\nColumn mapping:");

for (const [k, v] of Object.entries(IDX)) {
  console.log(`  ${k.padEnd(16)} -> ${headers[v]}`);
}

const stocks = new Map();

for (let i = 1; i < lines.length; i++) {
  const cells = parseCSVLine(lines[i]);

  const code = cells[IDX.code]?.trim();

  if (!code) continue;

  const row = {
    date: cells[IDX.date],
    code,

    open: num(cells[IDX.open]),
    high: num(cells[IDX.high]),
    low: num(cells[IDX.low]),
    close: num(cells[IDX.close]),

    volume: num(cells[IDX.volume]),
    value: num(cells[IDX.value]),
    frequency: num(cells[IDX.frequency]),

    foreignBuy: num(cells[IDX.foreign_buy]),
    foreignSell: num(cells[IDX.foreign_sell])
  };

  if (!stocks.has(code)) stocks.set(code, []);
  stocks.get(code).push(row);
}

for (const rows of stocks.values()) {
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

console.log(`\nStocks loaded: ${stocks.size}`);

function mean(a) {
  const x = a.filter(Number.isFinite);
  return x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN;
}

function sma(arr, period) {
  if (arr.length < period) return NaN;
  return mean(arr.slice(-period));
}

function percentile(arr, p) {
  const x = arr.filter(Number.isFinite).sort((a, b) => a - b);

  if (!x.length) return NaN;

  const index = (x.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);

  if (lo === hi) return x[lo];

  return x[lo] + (x[hi] - x[lo]) * (index - lo);
}

function normalize(x, p10, p90) {
  if (!Number.isFinite(x)) return 0.5;
  if (!Number.isFinite(p10) || !Number.isFinite(p90) || p90 <= p10) {
    return 0.5;
  }

  return Math.max(
    0,
    Math.min(1, (x - p10) / (p90 - p10))
  );
}

function ratio(current, average) {
  if (!Number.isFinite(current) || !Number.isFinite(average) || average <= 0) {
    return NaN;
  }

  return current / average;
}

function returns(rows, i, n) {
  if (i - n < 0) return NaN;

  const c0 = rows[i - n].close;
  const c1 = rows[i].close;

  if (!(c0 > 0) || !(c1 > 0)) return NaN;

  return c1 / c0 - 1;
}

function downsideDeviation(rows, i, period = 20) {
  const vals = [];

  for (let j = Math.max(1, i - period + 1); j <= i; j++) {
    const prev = rows[j - 1].close;
    const cur = rows[j].close;

    if (!(prev > 0) || !(cur > 0)) continue;

    const r = cur / prev - 1;

    if (r < 0) vals.push(r * r);
    else vals.push(0);
  }

  if (!vals.length) return NaN;

  return Math.sqrt(mean(vals));
}

function calcFeature(rows, i) {
  const r = rows[i];

  if (
    !Number.isFinite(r.previous) &&
    i > 0
  ) {
    r.previous = rows[i - 1].close;
  }

  const previous = i > 0 ? rows[i - 1].close : NaN;

  if (
    !Number.isFinite(previous) ||
    previous <= 0 ||
    !Number.isFinite(r.close)
  ) {
    return null;
  }

  const bodyPct =
    Math.abs(r.close - r.open) / previous;

  const closePosition =
    (r.close - r.low) /
    Math.max(r.high - r.low, 1e-9);

  const return5 = returns(rows, i, 5);

  const volume20 = mean(
    rows.slice(Math.max(0, i - 19), i + 1)
      .map(x => x.volume)
  );

  const frequency20 = mean(
    rows.slice(Math.max(0, i - 19), i + 1)
      .map(x => x.frequency)
  );

  const value20 = mean(
    rows.slice(Math.max(0, i - 19), i + 1)
      .map(x => x.value)
  );

  const rangePct =
    (r.high - r.low) / previous;

  const ranges = rows
    .slice(Math.max(0, i - 19), i + 1)
    .map((x, k, a) => {
      const absoluteIndex =
        Math.max(0, i - 19) + k;

      const prev =
        absoluteIndex > 0
          ? rows[absoluteIndex - 1].close
          : NaN;

      if (!(prev > 0)) return NaN;

      return (x.high - x.low) / prev;
    });

  const range20 = mean(ranges);

  const range5 = mean(
    ranges.slice(-5)
  );

  const netForeign =
    (r.foreignBuy || 0) -
    (r.foreignSell || 0);

  const foreignRatio =
    netForeign /
    Math.max(r.value || 0, 1);

  let activityCount = 0;
  let foreignPositive = 0;

  const activityWindow =
    rows.slice(Math.max(0, i - 4), i + 1);

  for (const x of activityWindow) {
    if (
      Number.isFinite(x.volume) &&
      Number.isFinite(x.frequency)
    ) {
      activityCount++;
    }

    const nf =
      (x.foreignBuy || 0) -
      (x.foreignSell || 0);

    if (nf > 0) foreignPositive++;
  }

  const activityPersistence =
    activityCount / Math.max(activityWindow.length, 1);

  const foreignPersistence =
    foreignPositive /
    Math.max(activityWindow.length, 1);

  return {
    date: r.date,
    code: r.code,

    bodyPct,
    closePosition,
    return5,

    volumeRatio: ratio(r.volume, volume20),
    frequencyRatio: ratio(r.frequency, frequency20),
    activityPersistence,

    valueRatio: ratio(r.value, value20),
    absoluteValue: r.value,

    foreignRatio,
    foreignPersistence,

    rangePct,
    rangeExpansion:
      rangePct / Math.max(range20, 1e-9),

    compression:
      1 -
      Math.min(
        1,
        range5 / Math.max(range20, 1e-9)
      ),

    downsideDeviation:
      downsideDeviation(rows, i, 20),

    close: r.close,
    open: r.open,
    high: r.high,
    low: r.low,
    volume: r.volume,
    value: r.value,
    frequency: r.frequency
  };
}

const featureRows = [];

for (const [code, rows] of stocks.entries()) {
  if (rows.length < CONFIG.liquidity.minHistoryDays) continue;

  for (let i = 50; i < rows.length; i++) {
    const f = calcFeature(rows, i);

    if (!f) continue;

    featureRows.push(f);
  }
}

console.log(`Feature observations: ${featureRows.length}`);

const daily = new Map();

for (const row of featureRows) {
  if (!daily.has(row.date)) daily.set(row.date, []);
  daily.get(row.date).push(row);
}

function crossSectionNormalize(rows, field) {
  const values = rows
    .map(x => x[field])
    .filter(Number.isFinite);

  const p10 = percentile(values, 0.10);
  const p90 = percentile(values, 0.90);

  for (const x of rows) {
    x[`n_${field}`] =
      normalize(x[field], p10, p90);
  }
}

for (const rows of daily.values()) {
  crossSectionNormalize(rows, "bodyPct");
  crossSectionNormalize(rows, "return5");
  crossSectionNormalize(rows, "volumeRatio");
  crossSectionNormalize(rows, "frequencyRatio");
  crossSectionNormalize(rows, "valueRatio");
  crossSectionNormalize(rows, "absoluteValue");
  crossSectionNormalize(rows, "foreignRatio");
  crossSectionNormalize(rows, "rangeExpansion");
  crossSectionNormalize(rows, "downsideDeviation");
}

for (const row of featureRows) {
  row.PRICE =
    0.40 * row.n_bodyPct +
    0.35 * row.closePosition +
    0.25 * row.n_return5;

  row.PARTICIPATION =
    0.40 * row.n_volumeRatio +
    0.35 * row.n_frequencyRatio +
    0.25 * row.activityPersistence;

  row.CAPITAL =
    0.70 * row.n_valueRatio +
    0.30 * row.n_absoluteValue;

  row.FLOW =
    0.60 * row.n_foreignRatio +
    0.40 * row.foreignPersistence;

  row.STRUCTURE =
    0.60 * row.n_rangeExpansion +
    0.40 * row.compression;

  row.CORE =
    0.25 * row.PRICE +
    0.25 * row.PARTICIPATION +
    0.20 * row.CAPITAL +
    0.15 * row.FLOW +
    0.15 * row.STRUCTURE;

  row.RISK =
    row.n_downsideDeviation;

  row.RAC =
    row.CORE *
    (1 - CONFIG.riskLambda[2] * row.RISK);
}

function evaluateSignal(signal, rows, index, cfg) {
  if (
    signal.value < cfg.minValue ||
    signal.frequency < cfg.minFrequency ||
    signal.volume < cfg.minVolume
  ) {
    return null;
  }

  if (
    !Number.isFinite(signal.RAC) ||
    signal.RAC * 100 < cfg.threshold
  ) {
    return null;
  }

  const entry = rows[index + 1];

  if (!entry || !Number.isFinite(entry.open) || entry.open <= 0) {
    return null;
  }

  const result = {
    date: signal.date,
    code: signal.code,
    score: signal.RAC * 100,
    entry: entry.open
  };

  for (const h of CONFIG.horizons) {
    const future = rows[index + 1 + h - 1];

    result[`return_${h}d`] =
      future && future.close > 0
        ? future.close / entry.open - 1
        : null;
  }

  return result;
}

const byStock = new Map();

for (const row of featureRows) {
  if (!byStock.has(row.code)) byStock.set(row.code, []);
  byStock.get(row.code).push(row);
}

function metric(results, horizon) {
  const values = results
    .map(x => x[`return_${horizon}d`])
    .filter(Number.isFinite);

  if (!values.length) {
    return {
      signals: 0,
      winRate: null,
      avgReturn: null,
      medianReturn: null,
      profitFactor: null
    };
  }

  const wins = values.filter(x => x > 0);
  const gains = values
    .filter(x => x > 0)
    .reduce((s, x) => s + x, 0);

  const losses = Math.abs(
    values
      .filter(x => x < 0)
      .reduce((s, x) => s + x, 0)
  );

  const sorted = [...values].sort((a, b) => a - b);

  const mid = Math.floor(sorted.length / 2);

  const median =
    sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

  return {
    signals: values.length,
    winRate: wins.length / values.length,
    avgReturn: mean(values),
    medianReturn: median,
    profitFactor:
      losses > 0 ? gains / losses : Infinity
  };
}

const matrix = [];

console.log("\nRunning threshold matrix...");

for (const threshold of CONFIG.thresholds) {
  const cfg = {
    threshold,
    minValue: CONFIG.liquidity.minValue,
    minFrequency: CONFIG.liquidity.minFrequency,
    minVolume: CONFIG.liquidity.minVolume
  };

  const signals = [];

  for (const [code, rows] of byStock.entries()) {
    for (let i = 0; i < rows.length - 20; i++) {
      const result =
        evaluateSignal(rows[i], rows, i, cfg);

      if (result) signals.push(result);
    }
  }

  const row = {
    experiment: "threshold",
    parameter: threshold,
    signals: signals.length
  };

  for (const h of CONFIG.horizons) {
    const m = metric(signals, h);

    row[`win_${h}d`] = m.winRate;
    row[`avg_${h}d`] = m.avgReturn;
    row[`median_${h}d`] = m.medianReturn;
    row[`pf_${h}d`] = m.profitFactor;
  }

  matrix.push(row);

  console.log(
    `threshold=${threshold} signals=${signals.length}`
  );
}

const output = {
  version: CONFIG.version,
  generatedAt: new Date().toISOString(),
  config: CONFIG,
  matrix
};

const file =
  path.join(OUT, "sf-core-v1-threshold-matrix.json");

fs.writeFileSync(
  file,
  JSON.stringify(output, null, 2)
);

const csvHeader = [
  "experiment",
  "parameter",
  "signals",
  ...CONFIG.horizons.flatMap(h => [
    `win_${h}d`,
    `avg_${h}d`,
    `median_${h}d`,
    `pf_${h}d`
  ])
];

const csvRows = [
  csvHeader.join(","),
  ...matrix.map(r =>
    csvHeader.map(k =>
      r[k] === undefined ? "" : r[k]
    ).join(",")
  )
];

fs.writeFileSync(
  path.join(OUT, "sf-core-v1-threshold-matrix.csv"),
  csvRows.join("\n")
);

console.log("\n==============================================");
console.log(" MATRIX COMPLETE");
console.log("==============================================");
console.log(file);
console.log(
  path.join(OUT, "sf-core-v1-threshold-matrix.csv")
);
