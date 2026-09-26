"use strict";

/*
 * CHARTNALIST — Smartwatchlist Adapter
 *
 * This file is ONLY an adapter/view layer.
 *
 * It does NOT:
 * - create a new score
 * - convert score -> BUY
 * - modify Setup Engine
 * - modify Risk Engine
 * - modify Signal Lifecycle
 * - use QBS as a trading signal
 *
 * Pipeline:
 *
 * daily_stock_data
 *      ↓
 * SignalEngineInput
 *      ↓
 * evaluateStockSignal()
 *      ↓
 * Setup + Risk + Lifecycle
 *      ↓
 * Smartwatchlist
 */

// NOTE: .ts files di signal-engine sudah di-compile ke .js
// Tidak perlu ts-node runtime karena Netlify Functions tidak support

const { createClient } = require("@supabase/supabase-js");
const {
  evaluateStockSignal,
} = require("../lib/signal-engine");

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "Missing Supabase environment variables."
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const HISTORY_DAYS = 260;
const PAGE_SIZE = 1000;
const CACHE_TTL_MS = 30_000;

const cache = new Map();

function num(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? n
    : undefined;
}

function valid(values) {
  return values.filter(
    Number.isFinite
  );
}

function mean(values) {
  const v = valid(values);

  if (!v.length) {
    return undefined;
  }

  return (
    v.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / v.length
  );
}

function sum(values) {
  const v = valid(values);

  if (!v.length) {
    return undefined;
  }

  return v.reduce(
    (total, value) =>
      total + value,
    0
  );
}

function last(rows, n) {
  return rows.slice(
    Math.max(
      0,
      rows.length - n
    )
  );
}

function sma(rows, field, n) {
  if (rows.length < n) {
    return undefined;
  }

  return mean(
    last(rows, n).map(
      row => num(row[field])
    )
  );
}

function highest(rows, field, n) {
  const values = valid(
    last(rows, n).map(
      row => num(row[field])
    )
  );

  return values.length
    ? Math.max(...values)
    : undefined;
}

function lowest(rows, field, n) {
  const values = valid(
    last(rows, n).map(
      row => num(row[field])
    )
  ).filter(
    value => value > 0
  );

  return values.length
    ? Math.min(...values)
    : undefined;
}

function ratio(value, baseline) {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(baseline) ||
    baseline <= 0
  ) {
    return undefined;
  }

  return value / baseline;
}

function closePosition(row) {
  const close = num(row.close);
  const high = num(row.high);
  const low = num(row.low);

  if (
    !Number.isFinite(close) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    high <= low
  ) {
    return undefined;
  }

  return (
    (close - low) /
    (high - low)
  );
}

function bodyPct(row) {
  const close = num(row.close);
  const open = num(row.open);

  if (
    !Number.isFinite(close) ||
    !Number.isFinite(open) ||
    open <= 0
  ) {
    return undefined;
  }

  return (
    (close - open) /
    open
  );
}

function trueRange(row, previousClose) {
  const high = num(row.high);
  const low = num(row.low);
  const previous = num(previousClose);

  if (
    !Number.isFinite(high) ||
    !Number.isFinite(low)
  ) {
    return undefined;
  }

  if (!Number.isFinite(previous)) {
    return high - low;
  }

  return Math.max(
    high - low,
    Math.abs(high - previous),
    Math.abs(low - previous)
  );
}

function atr(rows, n = 14) {
  if (rows.length < n + 1) {
    return undefined;
  }

  const recent =
    last(rows, n + 1);

  const ranges = [];

  for (let i = 0; i < recent.length; i++) {
    const previousClose =
      i > 0
        ? recent[i - 1].close
        : undefined;

    const tr =
      trueRange(
        recent[i],
        previousClose
      );

    if (Number.isFinite(tr)) {
      ranges.push(tr);
    }
  }

  return ranges.length >= n
    ? mean(last(ranges, n))
    : undefined;
}

/*
 * Participation persistence:
 * fraction of recent sessions with positive
 * activity.
 */
function activityPersistence(
  rows,
  field,
  n = 5
) {
  const recent =
    last(rows, n);

  if (recent.length < n) {
    return undefined;
  }

  const values =
    recent.map(
      row => num(row[field])
    );

  if (
    values.some(
      value =>
        !Number.isFinite(value)
    )
  ) {
    return undefined;
  }

  return (
    values.filter(
      value => value > 0
    ).length / values.length
  );
}

/*
 * Foreign-flow persistence:
 * fraction of sessions where
 * foreign buy > foreign sell.
 */
function foreignPersistence(
  rows,
  n = 5
) {
  const recent =
    last(rows, n);

  if (recent.length < n) {
    return undefined;
  }

  let positive = 0;

  for (const row of recent) {
    const buy =
      num(row.foreign_buy);

    const sell =
      num(row.foreign_sell);

    if (
      !Number.isFinite(buy) ||
      !Number.isFinite(sell)
    ) {
      return undefined;
    }

    if (buy > sell) {
      positive++;
    }
  }

  return positive / recent.length;
}

/*
 * Foreign ratio:
 *
 * 20-session cumulative
 * net foreign / 20-session transaction value.
 */
function foreignMetrics(
  rows,
  n = 20
) {
  const recent =
    last(rows, n);

  let net = 0;
  let value = 0;

  for (const row of recent) {
    const buy =
      num(row.foreign_buy);

    const sell =
      num(row.foreign_sell);

    const transactionValue =
      num(row.value);

    if (
      !Number.isFinite(buy) ||
      !Number.isFinite(sell) ||
      !Number.isFinite(transactionValue)
    ) {
      continue;
    }

    net += buy - sell;
    value += transactionValue;
  }

  if (value <= 0) {
    return {
      netForeignValue:
        undefined,
      foreignRatio:
        undefined,
    };
  }

  return {
    netForeignValue: net,
    foreignRatio:
      net / value,
  };
}

/*
 * Range expansion:
 *
 * Current daily range /
 * average of the preceding 20 daily ranges.
 *
 * Current day is intentionally excluded
 * from the baseline so expansion is measured
 * against prior conditions.
 */
function rangeRatio(
  rows,
  baselineDays = 20
) {
  if (
    rows.length <
    baselineDays + 1
  ) {
    return undefined;
  }

  const current =
    rows[rows.length - 1];

  const currentHigh =
    num(current.high);

  const currentLow =
    num(current.low);

  if (
    !Number.isFinite(currentHigh) ||
    !Number.isFinite(currentLow)
  ) {
    return undefined;
  }

  const baseline =
    rows.slice(
      -baselineDays - 1,
      -1
    );

  const ranges =
    baseline.map(row => {
      const high =
        num(row.high);

      const low =
        num(row.low);

      if (
        !Number.isFinite(high) ||
        !Number.isFinite(low)
      ) {
        return undefined;
      }

      return high - low;
    });

  const average =
    mean(ranges);

  if (
    !Number.isFinite(average) ||
    average <= 0
  ) {
    return undefined;
  }

  return (
    (currentHigh - currentLow) /
    average
  );
}

/*
 * Base duration:
 *
 * consecutive compressed ranges
 * immediately preceding current session.
 *
 * Compression threshold follows the
 * accumulation contract: <= 0.90 of
 * the 20-session average range.
 */
function baseDays(rows) {
  if (rows.length < 21) {
    return 0;
  }

  const baselineRows =
    rows.slice(-21, -1);

  const ranges =
    baselineRows.map(row => {
      const high = num(row.high);
      const low = num(row.low);

      if (
        !Number.isFinite(high) ||
        !Number.isFinite(low)
      ) {
        return undefined;
      }

      return high - low;
    });

  const average =
    mean(ranges);

  if (
    !Number.isFinite(average) ||
    average <= 0
  ) {
    return 0;
  }

  let count = 0;

  const recent =
    rows.slice(
      -40,
      -1
    ).reverse();

  for (const row of recent) {
    const high = num(row.high);
    const low = num(row.low);

    if (
      !Number.isFinite(high) ||
      !Number.isFinite(low)
    ) {
      break;
    }

    if (
      high - low <=
      average * 0.90
    ) {
      count++;
    } else {
      break;
    }
  }

  return count;
}

function downsideDeviation(
  rows,
  n = 20
) {
  const recent =
    last(rows, n + 1);

  const downside = [];

  for (
    let i = 1;
    i < recent.length;
    i++
  ) {
    const previous =
      num(recent[i - 1].close);

    const close =
      num(recent[i].close);

    if (
      !Number.isFinite(previous) ||
      !Number.isFinite(close) ||
      previous <= 0
    ) {
      continue;
    }

    const ret =
      close / previous - 1;

    if (ret < 0) {
      downside.push(ret);
    }
  }

  if (!downside.length) {
    return 0;
  }

  return Math.sqrt(
    mean(
      downside.map(
        x => x * x
      )
    )
  );
}

function buildInput(
  rows,
  stock
) {
  if (!rows.length) {
    return null;
  }

  const current =
    rows[rows.length - 1];

  const close =
    num(current.close);

  if (!Number.isFinite(close)) {
    return null;
  }

  const previous =
    rows.slice(0, -1);

  const previous20 =
    last(previous, 20);

  const volume =
    num(current.volume);

  const value =
    num(current.value);

  const frequency =
    num(current.frequency);

  const volumeBaseline =
    mean(
      previous20.map(
        row => num(row.volume)
      )
    );

  const valueBaseline =
    mean(
      previous20.map(
        row => num(row.value)
      )
    );

  const frequencyBaseline =
    mean(
      previous20.map(
        row => num(row.frequency)
      )
    );

  const recentHigh =
    highest(rows, "high", 20);
  /*
   * Smartwatchlist adapter safety:
   * recentLow feeds the existing PULLBACK Risk Engine.
   * Never pass a zero/non-positive invalidation level.
   */
  const recentLowCandidate =
    lowest(rows, "low", 20);

  const recentLow =
    Number.isFinite(recentLowCandidate) &&
    recentLowCandidate > 0
      ? recentLowCandidate
      : undefined;

  const foreign =
    foreignMetrics(
      rows,
      20
    );

  const recentForeign =
    last(rows, 5);

  let foreignNetPositive = 0;

  for (const row of recentForeign) {
    const buy =
      num(row.foreign_buy);

    const sell =
      num(row.foreign_sell);

    if (
      Number.isFinite(buy) &&
      Number.isFinite(sell) &&
      buy > sell
    ) {
      foreignNetPositive++;
    }
  }

  const foreignPersistence5d =
    recentForeign.length === 5
      ? foreignNetPositive / 5
      : undefined;

  /*
   * Pullback is measured from recent 20-session high.
   */
  const pullbackPct =
    Number.isFinite(recentHigh) &&
    recentHigh > 0 &&
    close < recentHigh
      ? (
          recentHigh - close
        ) / recentHigh
      : 0;

  const input = {
    stockCode:
      stock.code,

    stockName:
      stock.name,

    close,

    open:
      num(current.open),

    high:
      num(current.high),

    low:
      num(current.low),

    sma20:
      sma(rows, "close", 20),

    sma50:
      sma(rows, "close", 50),

    high20:
      highest(rows, "high", 20),

    previousHigh20:
      highest(previous, "high", 20),

    high52w:
      highest(rows, "high", 252),

    rangeRatio:
      rangeRatio(rows, 20),

    volumeRatio:
      ratio(
        volume,
        volumeBaseline
      ),

    valueRatio:
      ratio(
        value,
        valueBaseline
      ),

    frequencyRatio:
      ratio(
        frequency,
        frequencyBaseline
      ),

    persistence5d:
      activityPersistence(
        rows,
        "volume",
        5
      ),

    foreignPersistence5d,

    foreignRatio:
      foreign.foreignRatio,

    netForeignValue:
      foreign.netForeignValue,

    closePosition:
      closePosition(current),

    bodyPct:
      bodyPct(current),

    recentHigh,

    recentLow,

    pullbackPct,

    baseDays:
      baseDays(rows),

    value,

    frequency,

    volume,

    downsideDeviation:
      downsideDeviation(
        rows,
        20
      ),

    historyDays:
      rows.length,

    atr:
      atr(rows, 14),
  };

  return input;
}

async function fetchStocks(
  codes
) {
  let query =
    supabase
      .from("stocks")
      .select(
        "id,code,name"
      );

  if (codes.length) {
    query =
      query.in(
        "code",
        codes
      );
  }

  const { data, error } =
    await query;

  if (error) {
    throw error;
  }

  return data || [];
}

async function fetchHistory(
  stockIds
) {
  if (!stockIds.length) {
    return [];
  }

  const fields = [
    "stock_id",
    "trade_date",
    "previous_price",
    "open",
    "first_trade",
    "high",
    "low",
    "close",
    "change_price",
    "volume",
    "value",
    "frequency",
    "offer",
    "offer_volume",
    "bid",
    "bid_volume",
    "foreign_sell",
    "foreign_buy"
  ].join(",");

  const result = [];

  /*
   * We deliberately retrieve enough rows
   * for 52-week context.
   */
  for (
    let offset = 0;
    ;
    offset += PAGE_SIZE
  ) {
    const {
      data,
      error
    } =
      await supabase
        .from("daily_stock_data")
        .select(fields)
        .in(
          "stock_id",
          stockIds
        )
        .order(
          "trade_date",
          { ascending: true }
        )
        .range(
          offset,
          offset + PAGE_SIZE - 1
        );

    if (error) {
      throw error;
    }

    const page =
      data || [];

    result.push(...page);

    if (
      page.length <
      PAGE_SIZE
    ) {
      break;
    }
  }

  return result;
}

function normalizeRows(
  stocks,
  history
) {
  const stockMap =
    new Map(
      stocks.map(
        stock => [
          String(stock.id),
          stock,
        ]
      )
    );

  const grouped =
    new Map();

  for (const row of history) {

    /*
     * Raw database history may contain placeholder/non-trading
     * rows where OHLC is zero while close or other fields exist.
     *
     * Keep those rows in the database, but NEVER let them enter
     * analytical calculations used by Signal Engine.
     */
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);

    const validOHLC =
      Number.isFinite(open) &&
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      Number.isFinite(close) &&
      open > 0 &&
      high > 0 &&
      low > 0 &&
      close > 0;

    if (!validOHLC) {
      continue;
    }

    const stock =
      stockMap.get(
        String(row.stock_id)
      );

    if (!stock) {
      continue;
    }

    const code =
      String(stock.code)
        .trim()
        .toUpperCase();

    if (!grouped.has(code)) {
      grouped.set(
        code,
        []
      );
    }

    grouped
      .get(code)
      .push({
        ...row,
        code,
        name:
          stock.name,
      });
  }

  for (
    const [code, rows]
    of grouped
  ) {
    rows.sort(
      (a, b) =>
        String(a.trade_date)
          .localeCompare(
            String(b.trade_date)
          )
    );

    grouped.set(
      code,
      rows.slice(
        -HISTORY_DAYS
      )
    );
  }

  return grouped;
}

function rankSignal(
  signal
) {
  const statusRank = {
    ACTIVE: 0,
    TRIGGERED: 1,
    WATCH: 2,
    OBSERVE: 3,
    TARGET: 4,
    INVALIDATED: 5,
  };

  const setupRank = {
    BREAKOUT: 0,
    PULLBACK: 1,
    ACCUMULATION: 2,
  };

  return [
    statusRank[
      signal.status
    ] ?? 99,

    setupRank[
      signal.setup
    ] ?? 99,

    signal.stockCode,
  ];
}
function cleanNumber(value, decimals = 2) {
  if (!Number.isFinite(Number(value))) return undefined;

  const factor = 10 ** decimals;
  const rounded =
    Math.round((Number(value) + Number.EPSILON) * factor) / factor;

  return Object.is(rounded, -0) ? 0 : rounded;
}

function cleanTradePlan(plan) {
  if (!plan) return null;

  return {
    ...plan,
    entry: cleanNumber(plan.entry),
    trigger: cleanNumber(plan.trigger),
    invalidation: cleanNumber(plan.invalidation),
    target1: cleanNumber(plan.target1),
    target2: cleanNumber(plan.target2),
    riskReward: cleanNumber(plan.riskReward),
  };
}

async function buildSmartwatchlist(
  codes = []
) {
  const normalized =
    [
      ...new Set(
        codes
          .map(code =>
            String(code)
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      ),
    ];

  /*
   * Empty watchlist must be cheap.
   */
  if (!normalized.length) {
    return {
      success: true,
      date: null,
      stocks: [],
      count: 0,
      message:
        "Smartwatchlist is empty.",
    };
  }

  const cacheKey =
    normalized
      .slice()
      .sort()
      .join(",");

  const cached =
    cache.get(cacheKey);

  if (
    cached &&
    Date.now() -
      cached.timestamp <
      CACHE_TTL_MS
  ) {
    return cached.data;
  }

  const stocks =
    await fetchStocks(
      normalized
    );

  const history =
    await fetchHistory(
      stocks.map(
        stock => stock.id
      )
    );

  const grouped =
    normalizeRows(
      stocks,
      history
    );

  const output = [];

  for (
    const stock of stocks
  ) {
    const code =
      String(stock.code)
        .trim()
        .toUpperCase();

    const rows =
      grouped.get(code) || [];

    if (rows.length < 20) {
      continue;
    }

    const input =
      buildInput(
        rows,
        stock
      );

    if (!input) {
      continue;
    }

    let result;

    try {
      result =
        evaluateStockSignal(
          input
        );
    } catch (error) {
      console.error(
        `[Smartwatchlist] ${code} engine error:`,
        error
      );
      continue;
    }

    if (
      !result ||
      !result.signal
    ) {
      continue;
    }

    const signal =
      result.signal;


    // Adapter-only presentation normalization.
    // Setup/Risk/Signal Engine remains authoritative.
    signal.tradePlan = cleanTradePlan(signal.tradePlan);
    /*
     * Only setups belong in Smartwatchlist.
     * Pure OBSERVE with setup=null stays out.
     */
    if (!signal.setup) {
      continue;
    }

    output.push({
      stockCode:
        signal.stockCode ||
        code,

      stockName:
        signal.stockName ||
        stock.name ||
        code,

      setup:
        signal.setup,

      status:
        signal.status,

      price:
        input.close,

      trigger:
        signal.tradePlan?.trigger,

      invalidation:
        signal.tradePlan?.invalidation,

      target1:
        signal.tradePlan?.target1,

      target2:
        signal.tradePlan?.target2,

      riskReward:
        signal.tradePlan?.riskReward,

      riskLevel:
        signal.tradePlan?.riskLevel,

      structure:
        signal.structure,

      participation:
        signal.participation,

      flow:
        signal.flow,

      liquidity:
        signal.liquidity,

      createdAt:
        signal.createdAt,

      updatedAt:
        signal.updatedAt,

      latestTradeDate:
        input &&
        rows[rows.length - 1]
          ?.trade_date,
    });
  }

  output.sort(
    (a, b) => {
      const ar =
        rankSignal(a);

      const br =
        rankSignal(b);

      for (
        let i = 0;
        i < ar.length;
        i++
      ) {
        if (
          ar[i] < br[i]
        ) return -1;

        if (
          ar[i] > br[i]
        ) return 1;
      }

      return 0;
    }
  );

  const latestDate =
    output.reduce(
      (latest, row) => {
        if (
          !latest ||
          String(
            row.latestTradeDate
          ) > String(latest)
        ) {
          return row.latestTradeDate;
        }

        return latest;
      },
      null
    );

  const response = {
    success: true,
    date:
      latestDate ||
      null,
    stocks: output,
    count:
      output.length,
  };

  cache.set(
    cacheKey,
    {
      timestamp:
        Date.now(),
      data:
        response,
    }
  );

  return response;
}

module.exports = {
  buildSmartwatchlist,
};



