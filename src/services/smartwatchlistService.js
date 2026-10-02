"use strict";

/*
 * CHARTNALIST â€” Smartwatchlist Adapter
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
const { computeSmartwatchlist } = require("../lib/smartwatchlist-core");

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

  const { data: latestMarketRows, error: latestMarketError } =
    await supabase
      .from("daily_stock_data")
      .select("trade_date")
      .order("trade_date", { ascending: false })
      .limit(1);

  if (latestMarketError) {
    throw new Error(
      `Failed to read latest market trade date: ${latestMarketError.message}`
    );
  }

  const latestMarketTradeDate =
    latestMarketRows?.[0]?.trade_date || null;

  const cached =
    cache.get(cacheKey);

  if (
    cached &&
    Date.now() -
      cached.timestamp <
      CACHE_TTL_MS &&
    cached.data?.date === latestMarketTradeDate
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

  const { stocks: output } = computeSmartwatchlist(stocks, history);

  const response = {
    success: true,
    date:
      latestMarketTradeDate ||
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





