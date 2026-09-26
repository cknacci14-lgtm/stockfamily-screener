require("dotenv").config();

const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const API_KEY = process.env.ARJUM_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

const TARGET_DATE = "2026-09-24";
const CODES = ["MEJA", "UNSP", "ABBA", "BIPP", "BBCA"];

if (!API_KEY) throw new Error("ARJUM_API_KEY tidak ditemukan.");
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Supabase environment variables tidak lengkap.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function arjumGet(code) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "stock.arjum.com",
        path: `/api/history/${encodeURIComponent(code)}`,
        method: "GET",
        headers: {
          "X-API-Key": API_KEY,
          Accept: "application/json"
        }
      },
      res => {
        let body = "";

        res.on("data", chunk => {
          body += chunk;
        });

        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              json: JSON.parse(body)
            });
          } catch {
            reject(
              new Error(
                `ARJUM ${code}: HTTP ${res.statusCode}, response bukan JSON`
              )
            );
          }
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

function getArjumRows(json) {
  if (Array.isArray(json)) return json;

  for (const key of ["data", "history", "rows", "result"]) {
    if (Array.isArray(json?.[key])) return json[key];
  }

  return [];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v) {
  return v === null || v === undefined ? "NULL" : String(v);
}

function compare(label, arjum, db) {
  const a = num(arjum);
  const b = num(db);

  if (a === null && b === null) return "MATCH";
  if (a === null || b === null) return "MISMATCH";

  return a === b ? "MATCH" : "MISMATCH";
}

(async () => {
  console.log("");
  console.log("============================================================");
  console.log("CHARTNALIST — SAME-DATE ARJUM vs SUPABASE CROSS-CHECK");
  console.log("============================================================");
  console.log(`Target date : ${TARGET_DATE}`);
  console.log(`Tickers     : ${CODES.join(", ")}`);
  console.log("");

  let mismatchCount = 0;

  for (const code of CODES) {
    console.log(`--- ${code} / ${TARGET_DATE} ---`);

    // ---------------------------------------------------------
    // ARJUM
    // ---------------------------------------------------------
    const arjumResult = await arjumGet(code);

    if (arjumResult.status !== 200) {
      console.log(`ARJUM HTTP : ${arjumResult.status}`);
      console.log("STATUS     : ARJUM REQUEST FAILED");
      console.log("");
      continue;
    }

    const arjumRows = getArjumRows(arjumResult.json);

    const arjumRow = arjumRows.find(
      row => String(row.date || row.trade_date || "").slice(0, 10) === TARGET_DATE
    );

    // ---------------------------------------------------------
    // SUPABASE STOCK ID
    // ---------------------------------------------------------
    const { data: stock, error: stockError } = await supabase
      .from("stocks")
      .select("id,code,name")
      .eq("code", code)
      .maybeSingle();

    if (stockError) {
      console.log("SUPABASE stock ERROR:", stockError.message);
      console.log("");
      continue;
    }

    if (!stock) {
      console.log("SUPABASE stock : NOT FOUND");
      console.log("");
      continue;
    }

    // ---------------------------------------------------------
    // SUPABASE SAME DATE
    // ---------------------------------------------------------
    const { data: dbRows, error: dbError } = await supabase
      .from("daily_stock_data")
      .select(
        "stock_id,trade_date,previous_price,open,high,low,close,volume,value,frequency"
      )
      .eq("stock_id", stock.id)
      .eq("trade_date", TARGET_DATE)
      .limit(1);

    if (dbError) {
      console.log("SUPABASE daily ERROR:", dbError.message);
      console.log("");
      continue;
    }

    const dbRow = dbRows?.[0];

    console.log("ARJUM row :", arjumRow ? "FOUND" : "NOT FOUND");
    console.log("DB row    :", dbRow ? "FOUND" : "NOT FOUND");

    if (!arjumRow || !dbRow) {
      console.log("STATUS    : INCOMPLETE CROSS-CHECK");
      console.log("");
      continue;
    }

    const checks = [
      ["OPEN", arjumRow.open, dbRow.open],
      ["HIGH", arjumRow.high, dbRow.high],
      ["LOW", arjumRow.low, dbRow.low],
      ["CLOSE", arjumRow.close, dbRow.close],
      ["VOLUME", arjumRow.volume, dbRow.volume],
      ["VALUE", arjumRow.value, dbRow.value],
      ["FREQUENCY", arjumRow.freq, dbRow.frequency]
    ];

    console.log("");
    console.log("FIELD       ARJUM              SUPABASE           RESULT");
    console.log("------------------------------------------------------------");

    let stockMismatch = false;

    for (const [label, a, b] of checks) {
      const result = compare(label, a, b);

      if (result !== "MATCH") {
        stockMismatch = true;
        mismatchCount++;
      }

      console.log(
        `${label.padEnd(11)} ${fmt(a).padEnd(18)} ${fmt(b).padEnd(18)} ${result}`
      );
    }

    console.log("");
    console.log(
      stockMismatch
        ? "STATUS    : DATA MISMATCH"
        : "STATUS    : EXACT MATCH"
    );

    console.log("");
  }

  console.log("============================================================");
  console.log("FINAL RESULT");
  console.log("============================================================");
  console.log(`Field mismatches : ${mismatchCount}`);

  if (mismatchCount === 0) {
    console.log("RESULT: Tidak ditemukan mismatch pada field yang diuji.");
  } else {
    console.log("RESULT: Ada mismatch — lanjut audit importer/source mapping.");
  }

  console.log("============================================================");
})();
