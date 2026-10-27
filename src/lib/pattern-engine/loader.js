"use strict";

const { cleanCandles } = require("./utils");

/*
 * Supabase loader for daily_stock_data. Works with any @supabase/supabase-js
 * client (Express service or Cloudflare function) - pass the client in.
 *
 * Schema (from src/database/schema.sql):
 *   stocks(id, code, name, ...)
 *   daily_stock_data(stock_id -> stocks.id, trade_date, open, high, low, close,
 *                    volume, value, ...)
 */

const PAGE_SIZE = 1000;

async function fetchAllPages(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

/** @returns {Promise<Map<string, Candle[]>>} code -> clean ascending candles */
async function loadCandles(supabase, codes, { days = 260 } = {}) {
  const upper = [...new Set(codes.map((c) => String(c).toUpperCase()))];

  const { data: stocks, error } = await supabase.from("stocks").select("id, code").in("code", upper);
  if (error) throw new Error(error.message);

  const idToCode = new Map((stocks || []).map((s) => [s.id, s.code]));
  const out = new Map(upper.map((c) => [c, []]));
  if (!idToCode.size) return out;

  // trading days -> calendar days, with margin for holidays
  const cutoff = new Date(Date.now() - Math.ceil(days * 1.6) * 86400000).toISOString().slice(0, 10);

  const rows = await fetchAllPages(() =>
    supabase
      .from("daily_stock_data")
      .select("stock_id, trade_date, open, high, low, close, volume, value")
      .in("stock_id", [...idToCode.keys()])
      .gte("trade_date", cutoff)
      .order("trade_date", { ascending: true })
      .order("stock_id", { ascending: true })
  );

  const grouped = new Map();
  for (const r of rows) {
    const code = idToCode.get(r.stock_id);
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(r);
  }
  for (const [code, list] of grouped) out.set(code, cleanCandles(list));
  return out;
}

/** Most liquid stocks on the latest trade date (default universe for backtest). */
async function topLiquidCodes(supabase, limit = 45) {
  const { data: latest, error: e1 } = await supabase
    .from("daily_stock_data").select("trade_date").order("trade_date", { ascending: false }).limit(1);
  if (e1) throw new Error(e1.message);
  if (!latest || !latest.length) return [];

  const { data: top, error: e2 } = await supabase
    .from("daily_stock_data").select("stock_id, value")
    .eq("trade_date", latest[0].trade_date).order("value", { ascending: false }).limit(limit);
  if (e2) throw new Error(e2.message);

  const { data: stocks, error: e3 } = await supabase
    .from("stocks").select("id, code").in("id", (top || []).map((r) => r.stock_id));
  if (e3) throw new Error(e3.message);

  const idToCode = new Map((stocks || []).map((s) => [s.id, s.code]));
  return (top || []).map((r) => idToCode.get(r.stock_id)).filter(Boolean);
}

/** All stocks: Map(stock_id -> { code, name }) */
async function loadStockMap(supabase) {
  const rows = await fetchAllPages(() =>
    supabase.from("stocks").select("id, code, name").order("id", { ascending: true })
  );
  return new Map(rows.map((s) => [s.id, { code: s.code, name: s.name || "" }]));
}

/** Rows of every stock since `sinceDate` (YYYY-MM-DD), stable paging (trade_date, stock_id). */
async function loadRowsSince(supabase, sinceDate) {
  return fetchAllPages(() =>
    supabase
      .from("daily_stock_data")
      .select("stock_id, trade_date, open, high, low, close, volume, value")
      .gte("trade_date", sinceDate)
      .order("trade_date", { ascending: true })
      .order("stock_id", { ascending: true })
  );
}

/** Full history of one stock since `sinceDate`. */
async function loadStockHistory(supabase, stockId, sinceDate) {
  const rows = await fetchAllPages(() =>
    supabase
      .from("daily_stock_data")
      .select("stock_id, trade_date, open, high, low, close, volume, value")
      .eq("stock_id", stockId)
      .gte("trade_date", sinceDate)
      .order("trade_date", { ascending: true })
  );
  return cleanCandles(rows);
}

module.exports = { loadCandles, topLiquidCodes, loadStockMap, loadRowsSince, loadStockHistory };
