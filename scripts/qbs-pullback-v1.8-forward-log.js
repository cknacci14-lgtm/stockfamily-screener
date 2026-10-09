/**
 * QBS PULLBACK V1.8 — FORWARD LOG (FINAL)
 *
 * Menulis sinyal yang lolos rule V1.8 ke tabel verdict_forward_log
 * dengan verdict = 'QBS_PULLBACK_V18'
 *
 * Rule V1.8:
 * 1. confirmation_lower_wick > 0
 * 2. HH + HL
 * 3. SpaceR ≥ 5
 * 4. Breadth SMA20 ≥ 50%
 *
 * Production Files Touched: ZERO (script baru)
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERDICT = "QBS_PULLBACK_V18";
const MIN_SPACE_R = 5;
const BREADTH_THRESHOLD = 50;
const SMA_PERIOD = 20;
const PRE = 4e9;
const WARM = 60;

const argDate =
  (process.argv.find((a) => a.startsWith("--date=")) || "").slice(7) || "";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function finite(v) {
  return Number.isFinite(Number(v));
}

async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function confirmationLowerWick(candle) {
  const bodyLow = Math.min(candle.open, candle.close);
  return bodyLow - candle.low;
}

function detectHHHL(candles, endIdx) {
  const hi = [];
  const lo = [];
  for (let i = 2; i < endIdx - 2; i++) {
    const x = candles[i];
    if (
      x.high > candles[i - 1].high &&
      x.high > candles[i - 2].high &&
      x.high > candles[i + 1].high &&
      x.high > candles[i + 2].high
    ) {
      hi.push(x.high);
    }
    if (
      x.low < candles[i - 1].low &&
      x.low < candles[i - 2].low &&
      x.low < candles[i + 1].low &&
      x.low < candles[i + 2].low
    ) {
      lo.push(x.low);
    }
  }
  if (hi.length < 2 || lo.length < 2) return false;
  const lh = hi[hi.length - 1];
  const ph = hi[hi.length - 2];
  const ll = lo[lo.length - 1];
  const pl = lo[lo.length - 2];
  return lh > ph && ll > pl;
}

function estimateSpaceR(candles, endIdx) {
  let resistance = 0;
  for (let i = Math.max(0, endIdx - 30); i < endIdx; i++) {
    if (candles[i].high > resistance) resistance = candles[i].high;
  }
  const close = candles[endIdx - 1].close;
  const low = Math.min(
    candles[endIdx - 1].low,
    candles[endIdx - 2]?.low ?? candles[endIdx - 1].low
  );
  const risk = close - low;
  if (risk <= 0) return null;
  return (resistance - close) / risk;
}

async function main() {
  console.log("==============================================");
  console.log("QBS PULLBACK V1.8 — FORWARD LOG (FINAL)");
  console.log("==============================================");

  // 1. Tentukan tanggal
  let target = argDate;
  if (!target) {
    const { data, error } = await sb
      .from("daily_stock_data")
      .select("trade_date")
      .order("trade_date", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    target = data?.[0]?.trade_date;
  }
  if (!target) {
    console.error("Tidak bisa menentukan tanggal target");
    process.exit(1);
  }
  console.log("Target date :", target);

  // 2. Mapping stock
  const stocks = await fetchAll(() => sb.from("stocks").select("id, code"));
  const codeById = new Map(stocks.map((s) => [String(s.id), s.code]));
  console.log("Stocks loaded:", codeById.size);

  // 3. Saham liquid hari itu
  const dayRows = await fetchAll(() =>
    sb
      .from("daily_stock_data")
      .select("stock_id, value")
      .eq("trade_date", target)
      .gte("value", PRE)
  );
  console.log("Liquid stocks on day:", dayRows.length);

  // 4. Hitung Breadth SMA20
  console.log("Computing Breadth SMA20...");
  let above = 0;
  let total = 0;
  const breadthSample = dayRows.slice(0, 400);

  for (const t of breadthSample) {
    const q = await sb
      .from("daily_stock_data")
      .select("close")
      .eq("stock_id", t.stock_id)
      .lte("trade_date", target)
      .order("trade_date", { ascending: false })
      .limit(SMA_PERIOD + 5);

    const rows = (q.data || []).reverse();
    if (rows.length < SMA_PERIOD) continue;
    const closes = rows.map((r) => num(r.close)).filter(finite);
    if (closes.length < SMA_PERIOD) continue;
    const sma =
      closes.slice(-SMA_PERIOD).reduce((a, b) => a + b, 0) / SMA_PERIOD;
    total++;
    if (closes[closes.length - 1] > sma) above++;
  }

  const breadth = total > 0 ? (above / total) * 100 : null;
  console.log(
    `Breadth SMA20 : ${breadth != null ? breadth.toFixed(2) + "%" : "n/a"} (sample ${total})`
  );

  if (breadth == null || breadth < BREADTH_THRESHOLD) {
    console.log(
      `Breadth < ${BREADTH_THRESHOLD}% → tidak ada sinyal V1.8 yang dicatat hari ini.`
    );
    return;
  }

  // 5. Scan kandidat V1.8
  const toInsert = [];

  for (const t of dayRows) {
    const code = codeById.get(String(t.stock_id));
    if (!code) continue;

    // Ambil history terbaru
    const q = await sb
      .from("daily_stock_data")
      .select("trade_date, open, high, low, close, value")
      .eq("stock_id", t.stock_id)
      .lte("trade_date", target)
      .order("trade_date", { ascending: false })
      .limit(120);

    const rows = (q.data || [])
      .filter((r) => num(r.close) > 0)
      .reverse();

    if (rows.length < WARM + 5) continue;
    if (rows[rows.length - 1].trade_date !== target) continue;

    const candles = rows.map((r) => ({
      date: r.trade_date,
      open: num(r.open),
      high: num(r.high),
      low: num(r.low),
      close: num(r.close),
      value: num(r.value) || 0,
    }));

    const n = candles.length;
    const last = candles[n - 1];

    // Filter 1: Bad-Candle
    const lowerWick = confirmationLowerWick(last);
    if (!finite(lowerWick) || lowerWick <= 0) continue;

    // Filter 2: HH + HL
    if (!detectHHHL(candles, n)) continue;

    // Filter 3: SpaceR ≥ 5
    const spaceR = estimateSpaceR(candles, n);
    if (!finite(spaceR) || spaceR < MIN_SPACE_R) continue;

    // Lolos V1.8
    toInsert.push({
      log_date: target,
      stock_code: code,
      verdict: VERDICT,
      ref_close: last.close,
      foreign_ratio_20d: null,
      avg_value_20d:
        candles.slice(-20).reduce((s, x) => s + x.value, 0) / 20,
    });
  }

  console.log(`Kandidat yang lolos V1.8 : ${toInsert.length}`);

  // 6. Upsert ke tabel
  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const { error } = await sb.from("verdict_forward_log").upsert(chunk, {
        onConflict: "log_date,stock_code,verdict",
        ignoreDuplicates: true,
      });
      if (error) throw new Error(error.message);
    }
    console.log("Berhasil dicatat ke verdict_forward_log:");
    console.log(toInsert.map((x) => x.stock_code).join(", "));
  } else {
    console.log("Tidak ada sinyal V1.8 yang dicatat hari ini.");
  }

  console.log("==============================================");
  console.log("SELESAI");
  console.log("==============================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});