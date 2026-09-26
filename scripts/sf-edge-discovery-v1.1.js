const fs = require("fs");
const path = require("path");
const db = require("../src/database/historicalDb");

const START = "2025-09-01";
const END   = "2026-09-24";

const HOLDINGS = [1, 3, 5, 10, 20];

const TH = {
  range:  [1.5, 2.0, 2.5, 3.0],
  volume: [1.5, 2.0, 2.5, 3.0],
  value:  [1.5, 2.0, 2.5, 3.0],
  foreign:[0.05, 0.10, 0.20],
};

const OUT = path.join(process.cwd(), "data", "backtest");
fs.mkdirSync(OUT, { recursive: true });

function median(values) {
  const x = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!x.length) return NaN;
  const m = Math.floor(x.length / 2);
  return x.length % 2 ? x[m] : (x[m-1] + x[m]) / 2;
}

function mean(values) {
  const x = values.filter(Number.isFinite);
  return x.length ? x.reduce((a,b)=>a+b,0) / x.length : NaN;
}

function profitFactor(values) {
  const wins = values.filter(x=>x>0).reduce((a,b)=>a+b,0);
  const losses = Math.abs(values.filter(x=>x<0).reduce((a,b)=>a+b,0));
  return losses > 0 ? wins / losses : NaN;
}

function stats(rows, field) {
  const r = rows.map(x=>x[field]).filter(Number.isFinite);

  if (!r.length) {
    return {
      n: 0,
      mean: NaN,
      median: NaN,
      winRate: NaN,
      profitFactor: NaN
    };
  }

  return {
    n: r.length,
    mean: mean(r),
    median: median(r),
    winRate: r.filter(x=>x>0).length / r.length,
    profitFactor: profitFactor(r)
  };
}

function previousMedian(series, index, lookback, fn) {
  if (index < lookback) return NaN;

  const values = [];

  for (let j=index-lookback; j<index; j++) {
    const v = fn(series[j]);

    if (Number.isFinite(v) && v > 0) {
      values.push(v);
    }
  }

  return median(values);
}

function safeReturn(entry, exit) {
  if (!Number.isFinite(entry) ||
      !Number.isFinite(exit) ||
      entry <= 0) return NaN;

  return exit / entry - 1;
}

function fmt(v) {
  return Number.isFinite(v) ? v.toFixed(4) : "NA";
}

(async()=>{

  console.log("================================================");
  console.log("SF EDGE DISCOVERY V1.1");
  console.log("CORRECTED RAW EVENT STUDY");
  console.log("================================================");

  const raw = await db.getAllHistory(START, END);

  console.log("Raw rows :", raw.length);

  const byCode = new Map();

  for (const r of raw) {

    const code = r.code || r.stock_code;
    if (!code) continue;

    if (!byCode.has(code)) {
      byCode.set(code, []);
    }

    byCode.get(code).push({
      date: r.trade_date || r.date,

      previous: Number(r.previous_price),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),

      volume: Number(r.volume),
      value: Number(r.value),
      frequency: Number(r.frequency),

      foreignBuy: Number(r.foreign_buy),
      foreignSell: Number(r.foreign_sell)
    });
  }

  for (const series of byCode.values()) {
    series.sort((a,b)=>a.date.localeCompare(b.date));
  }

  console.log("Stocks    :", byCode.size);

  const events = [];

  for (const [code, series] of byCode) {

    for (let i=20; i<series.length-20; i++) {

      const t = series[i];
      const next = series[i+1];

      if (!next || !Number.isFinite(next.open) || next.open <= 0) {
        continue;
      }

      if (
        !Number.isFinite(t.previous) ||
        !Number.isFinite(t.open) ||
        !Number.isFinite(t.high) ||
        !Number.isFinite(t.low) ||
        !Number.isFinite(t.close) ||
        t.previous <= 0
      ) {
        continue;
      }

      // ==========================================
      // PRICE STRUCTURE
      // ==========================================

      const range = t.high - t.low;

      if (!Number.isFinite(range) || range <= 0) {
        continue;
      }

      const bodyPct =
        Math.abs(t.close - t.open) / t.previous;

      const closePosition =
        (t.close - t.low) / range;

      const changePct =
        (t.close - t.previous) / t.previous;

      // ==========================================
      // RANGE EXPANSION
      // IMPORTANT:
      // rolling baseline is HIGH-LOW, NOT HIGH
      // ==========================================

      const rangeMedian = previousMedian(
        series,
        i,
        20,
        x => x.high - x.low
      );

      const rangeRatio =
        Number.isFinite(rangeMedian) && rangeMedian > 0
          ? range / rangeMedian
          : NaN;

      // ==========================================
      // VOLUME EXPANSION
      // ==========================================

      const volumeMedian = previousMedian(
        series,
        i,
        20,
        x => x.volume
      );

      const volumeRatio =
        Number.isFinite(volumeMedian) && volumeMedian > 0
          ? t.volume / volumeMedian
          : NaN;

      // ==========================================
      // VALUE EXPANSION
      // ==========================================

      const valueMedian = previousMedian(
        series,
        i,
        20,
        x => x.value
      );

      const valueRatio =
        Number.isFinite(valueMedian) && valueMedian > 0
          ? t.value / valueMedian
          : NaN;

      // ==========================================
      // FOREIGN FLOW
      //
      // Foreign data = shares.
      // Convert to approximate rupiah using CLOSE.
      // ==========================================

      const foreignNetVolume =
        t.foreignBuy - t.foreignSell;

      const foreignNetValue =
        foreignNetVolume * t.close;

      const foreignRatio =
        Number.isFinite(t.value) && t.value > 0
          ? foreignNetValue / t.value
          : NaN;

      // ==========================================
      // FOREIGN PERSISTENCE
      // ==========================================

      const foreign5 = [];

      for (
        let j=Math.max(0,i-4);
        j<=i;
        j++
      ) {
        const f =
          series[j].foreignBuy -
          series[j].foreignSell;

        if (Number.isFinite(f)) {
          foreign5.push(f);
        }
      }

      const foreignPersistence =
        foreign5.length
          ? foreign5.filter(x=>x>0).length / foreign5.length
          : NaN;

      // ==========================================
      // FORWARD RETURNS
      // Entry = T+1 OPEN
      // Exit = T+h CLOSE
      // ==========================================

      const future = {};

      for (const h of HOLDINGS) {

        const exit = series[i+h];

        if (!exit) continue;

        future[`ret_${h}d`] =
          safeReturn(next.open, exit.close);
      }

      events.push({
        code,
        date: t.date,

        rangeRatio,
        volumeRatio,
        valueRatio,

        foreignRatio,
        foreignPersistence,

        bodyPct,
        closePosition,
        changePct,

        ...future
      });
    }
  }

  console.log("Candidate events :", events.length);

  // ==========================================
  // EVENT DEFINITIONS
  // ==========================================

  const defs = [];

  for (const x of TH.range) {
    defs.push({
      name: `RANGE_${x}X`,
      test: e => e.rangeRatio >= x
    });
  }

  for (const x of TH.volume) {
    defs.push({
      name: `VOLUME_${x}X`,
      test: e => e.volumeRatio >= x
    });
  }

  for (const x of TH.value) {
    defs.push({
      name: `VALUE_${x}X`,
      test: e => e.valueRatio >= x
    });
  }

  for (const x of TH.foreign) {
    defs.push({
      name: `FOREIGN_${x}`,
      test: e => e.foreignRatio >= x
    });
  }

  defs.push(
    {
      name: "PRICE_CLOSE_TOP_25",
      test: e => e.closePosition >= 0.75
    },
    {
      name: "PRICE_BODY_2PCT",
      test: e => e.bodyPct >= 0.02
    },
    {
      name: "PRICE_BODY_3PCT",
      test: e => e.bodyPct >= 0.03
    },
    {
      name: "FOREIGN_PERSIST_80",
      test: e => e.foreignPersistence >= 0.80
    }
  );

  // ==========================================
  // TEMPORAL OOS
  // ==========================================

  const dates = [
    ...new Set(events.map(e=>e.date))
  ].sort();

  const splitIndex = Math.floor(dates.length * 0.70);
  const cutoff = dates[splitIndex];

  console.log("OOS cutoff       :", cutoff);

  const train = events.filter(e=>e.date < cutoff);
  const oos   = events.filter(e=>e.date >= cutoff);

  console.log("Train events     :", train.length);
  console.log("OOS events       :", oos.length);

  // ==========================================
  // FULL RESULTS
  // ==========================================

  const results = [];

  for (const def of defs) {

    for (const sample of [
      ["TRAIN", train],
      ["OOS", oos]
    ]) {

      const sampleName = sample[0];
      const rows = sample[1];

      const selected = rows.filter(def.test);

      for (const h of HOLDINGS) {

        const field = `ret_${h}d`;

        const st = stats(selected, field);

        results.push({
          sample: sampleName,
          event: def.name,
          holding: h,
          n: st.n,
          mean: st.mean,
          median: st.median,
          winRate: st.winRate,
          profitFactor: st.profitFactor
        });
      }
    }
  }

  // ==========================================
  // DECISION
  //
  // Primary:
  // OOS 5D
  //
  // Requirements:
  // N >= 30
  // median > 0
  // mean > 0
  // PF > 1
  //
  // PLUS at least 2 positive OOS
  // holding periods.
  // ==========================================

  const decisions = [];

  for (const def of defs) {

    const oosRows =
      results.filter(x =>
        x.sample === "OOS" &&
        x.event === def.name
      );

    const r5 =
      oosRows.find(x=>x.holding===5);

    const positiveHolds =
      oosRows.filter(x =>
        x.n >= 30 &&
        x.mean > 0 &&
        x.median > 0 &&
        x.profitFactor > 1
      );

    const pass =
      r5 &&
      r5.n >= 30 &&
      r5.mean > 0 &&
      r5.median > 0 &&
      r5.profitFactor > 1 &&
      positiveHolds.length >= 2;

    decisions.push({
      event: def.name,

      n: r5?.n || 0,

      mean5D: r5?.mean,
      median5D: r5?.median,
      winRate5D: r5?.winRate,
      profitFactor5D: r5?.profitFactor,

      positiveHoldingPeriods:
        positiveHolds.map(x=>x.holding),

      decision: pass ? "PASS" : "FAIL"
    });
  }

  // ==========================================
  // SAVE
  // ==========================================

  const stamp =
    new Date().toISOString()
      .replace(/[:.]/g,"-");

  const csvPath =
    path.join(
      OUT,
      `sf-edge-discovery-v1.1-${stamp}.csv`
    );

  const jsonPath =
    path.join(
      OUT,
      `sf-edge-discovery-v1.1-${stamp}.json`
    );

  const headers = [
    ...new Set(
      results.flatMap(x=>Object.keys(x))
    )
  ];

  const esc = v => {
    if (v === undefined || v === null) return "";
    const s = String(v);
    return /[,"\n]/.test(s)
      ? `"${s.replace(/"/g,'""')}"`
      : s;
  };

  const csv = [
    headers.join(","),
    ...results.map(r =>
      headers.map(h=>esc(r[h])).join(",")
    )
  ].join("\n");

  fs.writeFileSync(csvPath,csv);

  const passEvents =
    decisions.filter(x=>x.decision==="PASS");

  const report = {

    engine: "SF_EDGE_DISCOVERY_V1.1",

    methodology:
      "Raw event study; signal at T; entry at T+1 open; exit at T+h close.",

    period: {
      start: START,
      end: END
    },

    rawRows: raw.length,
    stocks: byCode.size,
    candidateEvents: events.length,

    trainEnd:
      dates[splitIndex-1],

    oosCutoff: cutoff,

    primaryGate:
      "OOS 5D N>=30, mean>0, median>0, PF>1 AND >=2 positive holding periods",

    decisions,

    passCount: passEvents.length,

    finalDecision:
      passEvents.length > 0
        ? "EDGE_FOUND"
        : "NO_EDGE_FOUND"
  };

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(report,null,2)
  );

  // ==========================================
  // TERMINAL DECISION
  // ==========================================

  console.log("");
  console.log("================================================");
  console.log("FINAL DECISION");
  console.log("================================================");

  console.log(
    "EDGE EVENTS :", passEvents.length
  );

  console.log(
    "DECISION    :",
    report.finalDecision
  );

  console.log("");

  for (const d of decisions) {

    console.log(
      `${d.event.padEnd(24)} ` +
      `N=${String(d.n).padStart(6)} ` +
      `Median5D=${fmt(d.median5D)} ` +
      `PF=${fmt(d.profitFactor5D)} ` +
      `PositiveHolds=${d.positiveHoldingPeriods.join("/") || "-"} ` +
      `${d.decision}`
    );
  }

  console.log("");
  console.log("CSV :", csvPath);
  console.log("JSON:", jsonPath);
})();