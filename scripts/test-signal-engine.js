require("dotenv").config();

const {
  getHistoryByCode,
} = require("../src/database/historicalDb");

const {
  evaluateStockSignal,
} = require("../src/lib/signal-engine");

const CODE = process.argv[2] || "BBCA";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function median(values) {
  const clean = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!clean.length) return undefined;

  const mid = Math.floor(clean.length / 2);

  return clean.length % 2
    ? clean[mid]
    : (clean[mid - 1] + clean[mid]) / 2;
}

function sma(rows, field, period) {
  if (rows.length < period) return undefined;

  const values = rows
    .slice(-period)
    .map(r => Number(r[field]))
    .filter(Number.isFinite);

  if (values.length < period) return undefined;

  return values.reduce((a, b) => a + b, 0) / values.length;
}

function highest(rows, field, period) {
  const values = rows
    .slice(-period)
    .map(r => Number(r[field]))
    .filter(Number.isFinite);

  return values.length
    ? Math.max(...values)
    : undefined;
}

function calculateFeatures(rows) {
  if (!rows.length) return null;

  const sorted = [...rows].sort(
    (a, b) =>
      String(a.trade_date).localeCompare(String(b.trade_date))
  );

  const current = sorted[sorted.length - 1];

  const previous20 =
    sorted.length >= 21
      ? sorted.slice(-21, -1)
      : [];

  const prior20Ranges =
    previous20
      .map(r => Number(r.high) - Number(r.low))
      .filter(Number.isFinite);

  const prior20Volumes =
    previous20
      .map(r => Number(r.volume))
      .filter(Number.isFinite);

  const prior20Values =
    previous20
      .map(r => Number(r.value))
      .filter(Number.isFinite);

  const currentRange =
    num(current.high) !== undefined &&
    num(current.low) !== undefined
      ? Number(current.high) - Number(current.low)
      : undefined;

  const rangeBaseline =
    median(prior20Ranges);

  const volumeBaseline =
    median(prior20Volumes);

  const valueBaseline =
    median(prior20Values);

  const rangeRatio =
    Number.isFinite(currentRange) &&
    Number.isFinite(rangeBaseline) &&
    rangeBaseline > 0
      ? currentRange / rangeBaseline
      : undefined;

  const volumeRatio =
    Number.isFinite(Number(current.volume)) &&
    Number.isFinite(volumeBaseline) &&
    volumeBaseline > 0
      ? Number(current.volume) / volumeBaseline
      : undefined;

  const valueRatio =
    Number.isFinite(Number(current.value)) &&
    Number.isFinite(valueBaseline) &&
    valueBaseline > 0
      ? Number(current.value) / valueBaseline
      : undefined;

  const close = Number(current.close);
  const high = Number(current.high);
  const low = Number(current.low);
  const open = Number(current.open);

  const closePosition =
    Number.isFinite(close) &&
    Number.isFinite(high) &&
    Number.isFinite(low) &&
    high > low
      ? (close - low) / (high - low)
      : undefined;

  const bodyPct =
    Number.isFinite(close) &&
    Number.isFinite(open) &&
    open > 0
      ? (close - open) / open
      : undefined;

  const foreignBuy =
    Number(current.foreign_buy) || 0;

  const foreignSell =
    Number(current.foreign_sell) || 0;

  /*
   * Foreign ratio is deliberately kept as the same
   * proxy used during research:
   *
   * (foreign_buy - foreign_sell) * close / value
   *
   * It is contextual evidence, not exact capital-flow measurement.
   */
  const foreignNetValue =
    (foreignBuy - foreignSell) * close;

  const foreignRatio =
    Number(current.value) > 0
      ? foreignNetValue / Number(current.value)
      : undefined;

  const last5 =
    sorted.slice(-5);

  const positiveForeignDays =
    last5.filter(r =>
      (Number(r.foreign_buy) || 0) >
      (Number(r.foreign_sell) || 0)
    ).length;

  const foreignPersistence5d =
    last5.length === 5
      ? positiveForeignDays / 5
      : undefined;

  const last20 =
    sorted.slice(-20);

  const positivePersistenceDays =
    last20.filter(r =>
      Number(r.close) > Number(r.open)
    ).length;

  const persistence5d =
    foreignPersistence5d;

  const recentHigh =
    highest(sorted, "high", 20);

  const recentLow =
    (() => {
      const values = sorted
        .slice(-20)
        .map(r => Number(r.low))
        .filter(Number.isFinite);

      return values.length
        ? Math.min(...values)
        : undefined;
    })();

  const previousHigh20 =
    previous20.length
      ? Math.max(
          ...previous20
            .map(r => Number(r.high))
            .filter(Number.isFinite)
        )
      : undefined;

  const high52w =
    highest(sorted, "high", 252);

  const sma20Value =
    sma(sorted, "close", 20);

  const sma50Value =
    sma(sorted, "close", 50);

  const pullbackPct =
    Number.isFinite(recentHigh) &&
    recentHigh > 0 &&
    Number.isFinite(close)
      ? (recentHigh - close) / recentHigh
      : undefined;

  /*
   * Initial accumulation base estimate.
   * We intentionally keep this simple and descriptive.
   */
  const baseRows =
    sorted.slice(-20);

  const baseRanges =
    baseRows
      .map(r => {
        const h = Number(r.high);
        const l = Number(r.low);

        return Number.isFinite(h) &&
          Number.isFinite(l)
          ? h - l
          : undefined;
      })
      .filter(Number.isFinite);

  const baseRangeMedian =
    median(baseRanges);

  const baseDays =
    baseRangeMedian !== undefined
      ? baseRows.filter(r => {
          const h = Number(r.high);
          const l = Number(r.low);

          if (!Number.isFinite(h) || !Number.isFinite(l)) {
            return false;
          }

          return (h - l) <= baseRangeMedian * 1.20;
        }).length
      : undefined;

  return {
    close,
    open,
    high,
    low,

    sma20: sma20Value,
    sma50: sma50Value,

    high20: recentHigh,
    previousHigh20,
    high52w,

    rangeRatio,
    volumeRatio,
    valueRatio,

    frequencyRatio: undefined,

    persistence5d,
    foreignPersistence5d,

    foreignRatio,
    netForeignValue,

    closePosition,
    bodyPct,

    recentHigh,
    recentLow,
    pullbackPct,
    baseDays,

    value: Number(current.value),
    frequency: Number(current.frequency),
    volume: Number(current.volume),

    historyDays: sorted.length,
  };
}

async function main() {
  console.log("");
  console.log("==============================================");
  console.log("STOCKFAMILY SIGNAL ENGINE — INTEGRATION TEST");
  console.log("==============================================");
  console.log(`Stock : ${CODE}`);

  const result =
    await getHistoryByCode(
      CODE,
      "2025-09-01",
      "2026-09-24"
    );

  if (!result.stock) {
    throw new Error(
      `Stock ${CODE} tidak ditemukan di master stocks.`
    );
  }

  if (!result.rows.length) {
    throw new Error(
      `Tidak ada historical data untuk ${CODE}.`
    );
  }

  console.log(`Name  : ${result.stock.name}`);
  console.log(`Rows  : ${result.rows.length}`);

  const features =
    calculateFeatures(result.rows);

  if (!features) {
    throw new Error(
      "Feature calculation gagal."
    );
  }

  const signal =
    evaluateStockSignal({
      stockCode:
        result.stock.code,

      stockName:
        result.stock.name,

      ...features,
    });

  console.log("");
  console.log("----------------------------------------------");
  console.log("EVIDENCE");
  console.log("----------------------------------------------");

  console.log(
    "Structure     :",
    signal.signal.structure.state,
    "-",
    signal.signal.structure.label
  );

  console.log(
    "Participation :",
    signal.signal.participation.state,
    "-",
    signal.signal.participation.label
  );

  console.log(
    "Flow          :",
    signal.signal.flow.state,
    "-",
    signal.signal.flow.label
  );

  console.log(
    "Liquidity     :",
    signal.signal.liquidity.state,
    "-",
    signal.signal.liquidity.label
  );

  console.log("");
  console.log("----------------------------------------------");
  console.log("SETUPS");
  console.log("----------------------------------------------");

  console.log(
    "Breakout      :",
    signal.setups.breakout
  );

  console.log(
    "Pullback      :",
    signal.setups.pullback
  );

  console.log(
    "Accumulation  :",
    signal.setups.accumulation
  );

  console.log("");
  console.log("----------------------------------------------");
  console.log("PRIMARY SIGNAL");
  console.log("----------------------------------------------");

  console.log(
    "Setup         :",
    signal.signal.setup
  );

  console.log(
    "Status        :",
    signal.signal.status
  );

  console.log("");
  console.log("----------------------------------------------");
  console.log("TRADE PLAN");
  console.log("----------------------------------------------");

  console.log(
    "Entry         :",
    signal.signal.tradePlan.entry
  );

  console.log(
    "Trigger       :",
    signal.signal.tradePlan.trigger
  );

  console.log(
    "Invalidation  :",
    signal.signal.tradePlan.invalidation
  );

  console.log(
    "Target 1      :",
    signal.signal.tradePlan.target1
  );

  console.log(
    "Target 2      :",
    signal.signal.tradePlan.target2
  );

  console.log(
    "R:R           :",
    signal.signal.tradePlan.riskReward
  );

  console.log(
    "Risk          :",
    signal.signal.tradePlan.riskLevel
  );

  console.log("");
  console.log("----------------------------------------------");
  console.log("RAW FEATURES");
  console.log("----------------------------------------------");

  console.log(
    JSON.stringify(features, null, 2)
  );

  console.log("");
  console.log("----------------------------------------------");
  console.log("FULL SIGNAL");
  console.log("----------------------------------------------");

  console.log(
    JSON.stringify(signal.signal, null, 2)
  );

  console.log("");
  console.log("==============================================");
  console.log("INTEGRATION TEST COMPLETE");
  console.log("==============================================");
}

main().catch(error => {
  console.error("");
  console.error("INTEGRATION TEST FAILED");
  console.error(error);
  process.exit(1);
});