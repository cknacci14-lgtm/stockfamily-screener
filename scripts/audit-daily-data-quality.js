const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function main() {
  const { data: stocks, error: stockError } =
    await supabase
      .from("stocks")
      .select("id,code,name");

  if (stockError) throw stockError;

  const stockMap = new Map(
    stocks.map(s => [String(s.id), s])
  );

  const all = [];

  for (let offset = 0; ; offset += 1000) {
    const { data, error } =
      await supabase
        .from("daily_stock_data")
        .select(
          "stock_id,trade_date,open,high,low,close,volume,value,frequency"
        )
        .order("trade_date", { ascending: true })
        .range(offset, offset + 999);

    if (error) throw error;

    const page = data || [];
    all.push(...page);

    if (page.length < 1000) break;
  }

  const stats = new Map();

  for (const row of all) {
    const id = String(row.stock_id);

    if (!stats.has(id)) {
      stats.set(id, {
        stockId: id,
        code: stockMap.get(id)?.code || id,
        name: stockMap.get(id)?.name || "",
        total: 0,
        validOHLC: 0,
        invalidOHLC: 0,
        zeroVolume: 0,
        zeroValue: 0,
        zeroFrequency: 0,
        firstValid: null,
        lastValid: null
      });
    }

    const s = stats.get(id);
    s.total++;

    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);

    const valid =
      Number.isFinite(open) &&
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      Number.isFinite(close) &&
      open > 0 &&
      high > 0 &&
      low > 0 &&
      close > 0;

    if (valid) {
      s.validOHLC++;

      if (!s.firstValid || row.trade_date < s.firstValid)
        s.firstValid = row.trade_date;

      if (!s.lastValid || row.trade_date > s.lastValid)
        s.lastValid = row.trade_date;
    } else {
      s.invalidOHLC++;
    }

    if (!(Number(row.volume) > 0))
      s.zeroVolume++;

    if (!(Number(row.value) > 0))
      s.zeroValue++;

    if (!(Number(row.frequency) > 0))
      s.zeroFrequency++;
  }

  const result = [...stats.values()]
    .map(s => ({
      ...s,
      validPct:
        s.total
          ? Number((s.validOHLC / s.total * 100).toFixed(1))
          : 0
    }))
    .sort((a,b) => a.validOHLC - b.validOHLC);

  console.log("\n=== DATABASE OHLC QUALITY AUDIT ===");

  console.log({
    stocks: result.length,
    totalRows: all.length,
    valid100pct: result.filter(x => x.validOHLC === x.total).length,
    validAtLeast50: result.filter(x => x.validOHLC >= 50).length,
    validAtLeast20: result.filter(x => x.validOHLC >= 20).length,
    validBelow20: result.filter(x => x.validOHLC < 20).length,
    zeroValid: result.filter(x => x.validOHLC === 0).length
  });

  console.log("\n=== WORST 30 STOCKS ===");
  console.table(
    result.slice(0, 30)
  );

  console.log("\n=== STOCKS WITH <20 VALID OHLC ===");
  console.table(
    result
      .filter(x => x.validOHLC < 20)
      .map(x => ({
        code: x.code,
        total: x.total,
        validOHLC: x.validOHLC,
        invalidOHLC: x.invalidOHLC,
        firstValid: x.firstValid,
        lastValid: x.lastValid,
        zeroVolume: x.zeroVolume,
        zeroValue: x.zeroValue,
        zeroFrequency: x.zeroFrequency
      }))
  );

  console.log("\n=== END AUDIT ===");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
