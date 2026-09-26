require("dotenv").config();
const https = require("https");

const API_KEY = process.env.ARJUM_API_KEY;
if (!API_KEY) {
  console.error("ERROR: ARJUM_API_KEY belum tersedia.");
  console.error("PowerShell:");
  console.error('$env:ARJUM_API_KEY="ISI_API_KEY_KAMU"');
  process.exit(1);
}

const codes = ["MEJA", "UNSP", "ABBA", "BIPP", "BBCA"];

function get(code) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "stock.arjum.com",
        path: `/api/history/${encodeURIComponent(code)}`,
        method: "GET",
        headers: {
          "X-API-Key": API_KEY,
          "Accept": "application/json"
        }
      },
      res => {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            resolve({ code, status: res.statusCode, json });
          } catch {
            resolve({
              code,
              status: res.statusCode,
              json: null,
              raw: body.slice(0, 1000)
            });
          }
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

function rowsOf(result) {
  const j = result.json;
  if (!j) return [];

  if (Array.isArray(j)) return j;

  for (const key of ["data", "history", "rows", "stocks", "result"]) {
    if (Array.isArray(j[key])) return j[key];
  }

  return [];
}

function pick(row, names) {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null) {
      return row[name];
    }
  }
  return undefined;
}

(async () => {
  console.log("");
  console.log("============================================================");
  console.log("CHARTNALIST — ARJUM SOURCE CROSS-CHECK");
  console.log("============================================================");
  console.log("Endpoint : /api/history/{code}");
  console.log("Tickers  : " + codes.join(", "));
  console.log("");

  const results = [];

  for (const code of codes) {
    try {
      const result = await get(code);
      results.push(result);

      const rows = rowsOf(result);

      console.log(`--- ${code} ---`);
      console.log(`HTTP       : ${result.status}`);
      console.log(`Rows       : ${rows.length}`);

      if (!rows.length) {
        console.log("No history rows detected.");
        if (result.raw) console.log("RAW:", result.raw);
        console.log("");
        continue;
      }

      const last = rows[rows.length - 1];

      const date = pick(last, [
        "date", "trade_date", "trading_date", "timestamp"
      ]);

      const open = pick(last, [
        "open", "open_price", "opening_price"
      ]);

      const high = pick(last, [
        "high", "high_price"
      ]);

      const low = pick(last, [
        "low", "low_price"
      ]);

      const close = pick(last, [
        "close", "close_price", "last_price"
      ]);

      const volume = pick(last, [
        "volume", "volume_shares"
      ]);

      const value = pick(last, [
        "value", "transaction_value", "value_transaction"
      ]);

      const frequency = pick(last, [
        "frequency", "freq", "transactions"
      ]);

      console.log("Latest row:");
      console.log("date       :", date);
      console.log("open       :", open);
      console.log("high       :", high);
      console.log("low        :", low);
      console.log("close      :", close);
      console.log("volume     :", volume);
      console.log("value      :", value);
      console.log("frequency  :", frequency);

      console.log("");
      console.log("Raw latest row:");
      console.log(JSON.stringify(last, null, 2));

      console.log("");
    } catch (err) {
      console.log(`ERROR ${code}: ${err.message}`);
      console.log("");
    }
  }

  console.log("============================================================");
  console.log("AUDIT INTERPRETATION");
  console.log("============================================================");
  console.log("1. ARJUM Open=0 + Supabase Open=0");
  console.log("   -> kemungkinan karakter/source data, bukan importer.");
  console.log("");
  console.log("2. ARJUM Open valid + Supabase Open=0");
  console.log("   -> DATA PIPELINE MISMATCH.");
  console.log("");
  console.log("3. ARJUM High/Low/Close berbeda dari Supabase");
  console.log("   -> perlu audit mapping/importer.");
  console.log("");
  console.log("4. ARJUM tidak punya row");
  console.log("   -> jangan menyimpulkan database salah.");
  console.log("============================================================");
})();

