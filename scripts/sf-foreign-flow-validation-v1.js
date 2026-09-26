const fs = require("fs");
const path = require("path");
const db = require("../src/database/historicalDb");

const START = "2025-09-01";
const END   = "2026-09-24";

const THRESHOLDS = [0.10, 0.20];
const HOLDINGS = [5, 10, 20];

const OUT = path.join(process.cwd(), "data", "backtest");
fs.mkdirSync(OUT, { recursive: true });

function median(a) {
  const x = a.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!x.length) return NaN;
  const m = Math.floor(x.length / 2);
  return x.length % 2 ? x[m] : (x[m-1]+x[m])/2;
}

function mean(a) {
  const x=a.filter(Number.isFinite);
  return x.length ? x.reduce((s,v)=>s+v,0)/x.length : NaN;
}

function pf(a) {
  const win=a.filter(x=>x>0).reduce((s,v)=>s+v,0);
  const loss=Math.abs(a.filter(x=>x<0).reduce((s,v)=>s+v,0));
  return loss ? win/loss : NaN;
}

function stats(rows, field) {
  const r=rows.map(x=>x[field]).filter(Number.isFinite);

  return {
    n:r.length,
    mean:mean(r),
    median:median(r),
    winRate:r.length ? r.filter(x=>x>0).length/r.length : NaN,
    profitFactor:pf(r)
  };
}

function pct(v) {
  return Number.isFinite(v) ? (v*100).toFixed(2)+"%" : "NA";
}

function num(v) {
  return Number.isFinite(v) ? v.toFixed(3) : "NA";
}

(async()=>{

  console.log("================================================");
  console.log("STOCKFAMILY FOREIGN FLOW VALIDATION V1");
  console.log("FINAL VALIDATION GATE");
  console.log("================================================");

  const raw=await db.getAllHistory(START,END);

  console.log("Raw rows :",raw.length);

  const byCode=new Map();

  for(const r of raw){

    const code=r.code || r.stock_code;
    if(!code) continue;

    if(!byCode.has(code)) byCode.set(code,[]);

    byCode.get(code).push({
      code,
      date:r.trade_date || r.date,
      previous:Number(r.previous_price),
      open:Number(r.open),
      high:Number(r.high),
      low:Number(r.low),
      close:Number(r.close),
      value:Number(r.value),
      foreignBuy:Number(r.foreign_buy),
      foreignSell:Number(r.foreign_sell)
    });
  }

  for(const a of byCode.values()){
    a.sort((x,y)=>x.date.localeCompare(y.date));
  }

  // ------------------------------------------------
  // BUILD DAILY MARKET REGIME
  // Equal-weight market return from all stocks.
  // Only information available at T is used.
  // ------------------------------------------------

  const marketDays=new Map();

  for(const a of byCode.values()){

    for(const r of a){

      if(
        !Number.isFinite(r.previous) ||
        !Number.isFinite(r.close) ||
        r.previous<=0
      ) continue;

      const ret=r.close/r.previous-1;

      if(!marketDays.has(r.date))
        marketDays.set(r.date,[]);

      marketDays.get(r.date).push(ret);
    }
  }

  const marketSeries=[...marketDays.entries()]
    .map(([date,rets])=>({
      date,
      marketReturn:median(rets)
    }))
    .sort((a,b)=>a.date.localeCompare(b.date));

  // 20D rolling market regime.
  // Bull = median market return > +0.10%
  // Bear = < -0.10%
  // otherwise Neutral.
  const marketMap=new Map();

  for(let i=0;i<marketSeries.length;i++){

    const recent=marketSeries
      .slice(Math.max(0,i-19),i+1)
      .map(x=>x.marketReturn)
      .filter(Number.isFinite);

    const r=mean(recent);

    let regime="NEUTRAL";

    if(r>0.001) regime="BULL";
    if(r<-0.001) regime="BEAR";

    marketMap.set(
      marketSeries[i].date,
      regime
    );
  }

  // ------------------------------------------------
  // BUILD EVENTS
  // ------------------------------------------------

  const events=[];

  for(const [code,a] of byCode){

    for(let i=20;i<a.length-20;i++){

      const t=a[i];
      const next=a[i+1];

      if(
        !next ||
        !Number.isFinite(next.open) ||
        next.open<=0 ||
        !Number.isFinite(t.close) ||
        t.close<=0 ||
        !Number.isFinite(t.value) ||
        t.value<=0
      ) continue;

      // Foreign volume -> approximate value.
      const foreignNetVolume =
        t.foreignBuy-t.foreignSell;

      const foreignNetValue =
        foreignNetVolume*t.close;

      const foreignRatio =
        foreignNetValue/t.value;

      const row={
        code,
        date:t.date,
        foreignRatio,
        regime:marketMap.get(t.date) || "NEUTRAL"
      };

      for(const h of HOLDINGS){

        const exit=a[i+h];

        if(!exit) continue;

        row[`ret_${h}d`] =
          exit.close/next.open-1;
      }

      events.push(row);
    }
  }

  console.log("Events :",events.length);

  // ------------------------------------------------
  // MONTHLY STABILITY
  // ------------------------------------------------

  const results=[];

  for(const threshold of THRESHOLDS){

    const selected=
      events.filter(e=>e.foreignRatio>=threshold);

    console.log("");
    console.log("-----------------------------------------------");
    console.log(
      `FOREIGN >= ${(threshold*100).toFixed(0)}%`
    );
    console.log("-----------------------------------------------");

    // Overall
    for(const h of HOLDINGS){

      const st=stats(
        selected,
        `ret_${h}d`
      );

      console.log(
        `${h}D N=${st.n}`+
        ` Median=${pct(st.median)}`+
        ` PF=${num(st.profitFactor)}`
      );
    }

    // ----------------------------------------------
    // STOCK CONCENTRATION
    // ----------------------------------------------

    const stockCounts=new Map();

    for(const e of selected){
      stockCounts.set(
        e.code,
        (stockCounts.get(e.code)||0)+1
      );
    }

    const stocks=[
      ...stockCounts.entries()
    ].sort((a,b)=>b[1]-a[1]);

    const total=selected.length;

    const top10=stocks
      .slice(0,10)
      .reduce((s,x)=>s+x[1],0);

    const top20=stocks
      .slice(0,20)
      .reduce((s,x)=>s+x[1],0);

    const topStock=stocks[0];

    console.log("");
    console.log("Stock concentration:");
    console.log("Unique stocks :",stocks.length);
    console.log(
      "Top stock     :",
      topStock ? `${topStock[0]} (${topStock[1]})` : "-"
    );
    console.log(
      "Top 10 share  :",
      total ? pct(top10/total) : "-"
    );
    console.log(
      "Top 20 share  :",
      total ? pct(top20/total) : "-"
    );

    // ----------------------------------------------
    // MONTHLY STABILITY
    // ----------------------------------------------

    const months=new Map();

    for(const e of selected){

      const month=e.date.slice(0,7);

      if(!months.has(month))
        months.set(month,[]);

      months.get(month).push(e);
    }

    let positiveMonths=0;

    console.log("");
    console.log("Monthly 5D:");

    for(const [month,rows] of months){

      const st=stats(rows,"ret_5d");

      if(
        st.n>=30 &&
        st.median>0 &&
        st.mean>0
      ){
        positiveMonths++;
      }

      console.log(
        `${month} N=${st.n}`+
        ` Median=${pct(st.median)}`+
        ` PF=${num(st.profitFactor)}`
      );

      results.push({
        type:"MONTH",
        threshold,
        month,
        n:st.n,
        mean:st.mean,
        median:st.median,
        winRate:st.winRate,
        profitFactor:st.profitFactor
      });
    }

    // ----------------------------------------------
    // REGIME
    // ----------------------------------------------

    console.log("");
    console.log("Regime:");

    for(const regime of ["BULL","NEUTRAL","BEAR"]){

      const rows=selected.filter(
        e=>e.regime===regime
      );

      const st=stats(rows,"ret_5d");

      console.log(
        `${regime.padEnd(8)}`+
        ` N=${st.n}`+
        ` Median=${pct(st.median)}`+
        ` PF=${num(st.profitFactor)}`
      );

      results.push({
        type:"REGIME",
        threshold,
        regime,
        n:st.n,
        mean:st.mean,
        median:st.median,
        winRate:st.winRate,
        profitFactor:st.profitFactor
      });
    }

    // ----------------------------------------------
    // SUMMARY
    // ----------------------------------------------

    const r5=stats(selected,"ret_5d");
    const r10=stats(selected,"ret_10d");
    const r20=stats(selected,"ret_20d");

    const regimeRows=
      ["BULL","NEUTRAL","BEAR"]
      .map(regime=>{

        const rows=selected.filter(
          e=>e.regime===regime
        );

        return {
          regime,
          ...stats(rows,"ret_5d")
        };
      })
      .filter(x=>x.n>=30);

    const positiveRegimes=
      regimeRows.filter(
        x=>x.median>0 &&
           x.mean>0 &&
           x.profitFactor>1
      );

    // ----------------------------------------------
    // FINAL VALIDATION GATE
    //
    // We DO NOT optimize.
    //
    // Requirements:
    // 5D, 10D, 20D positive median
    // PF > 1
    // >= 60% of sufficiently large months positive
    // no top-10 concentration > 40%
    // at least 2 market regimes represented
    // ----------------------------------------------

    const largeMonths=
      [...months.entries()]
      .map(([month,rows])=>({
        month,
        ...stats(rows,"ret_5d")
      }))
      .filter(x=>x.n>=30);

    const monthPositive=
      largeMonths.filter(
        x=>x.median>0 &&
           x.mean>0
      ).length;

    const monthRatio=
      largeMonths.length
        ? monthPositive/largeMonths.length
        : 0;

    const regimeCount=
      regimeRows.filter(x=>x.n>=30).length;

    const concentration=
      total ? top10/total : 1;

    const PASS =
      selected.length>=500 &&
      r5.median>0 &&
      r10.median>0 &&
      r20.median>0 &&
      r5.profitFactor>1 &&
      r10.profitFactor>1 &&
      r20.profitFactor>1 &&
      monthRatio>=0.60 &&
      concentration<0.40 &&
      regimeCount>=2 &&
      positiveRegimes.length>=2;

    results.push({
      type:"SUMMARY",
      threshold,
      n:selected.length,
      median5d:r5.median,
      median10d:r10.median,
      median20d:r20.median,
      pf5d:r5.profitFactor,
      pf10d:r10.profitFactor,
      pf20d:r20.profitFactor,
      largeMonths:largeMonths.length,
      positiveMonths:monthPositive,
      positiveMonthRatio:monthRatio,
      uniqueStocks:stocks.length,
      top10Share:concentration,
      representedRegimes:regimeCount,
      positiveRegimes:positiveRegimes.length,
      decision:PASS ? "PASS" : "FAIL"
    });
  }

  // ------------------------------------------------
  // FINAL DECISION
  // ------------------------------------------------

  const summaries=
    results.filter(x=>x.type==="SUMMARY");

  const pass=
    summaries.filter(x=>x.decision==="PASS");

  console.log("");
  console.log("================================================");
  console.log("FOREIGN FLOW FINAL VALIDATION");
  console.log("================================================");

  for(const x of summaries){

    console.log("");
    console.log(
      `FOREIGN >= ${(x.threshold*100).toFixed(0)}%`
    );

    console.log(
      "N               :",x.n
    );

    console.log(
      "Median 5D       :",pct(x.median5d)
    );

    console.log(
      "Median 10D      :",pct(x.median10d)
    );

    console.log(
      "Median 20D      :",pct(x.median20d)
    );

    console.log(
      "PF 5/10/20D     :",
      num(x.pf5d),
      "/",
      num(x.pf10d),
      "/",
      num(x.pf20d)
    );

    console.log(
      "Positive months :",
      `${x.positiveMonths}/${x.largeMonths}`,
      `(${pct(x.positiveMonthRatio)})`
    );

    console.log(
      "Unique stocks   :",x.uniqueStocks
    );

    console.log(
      "Top 10 share    :",pct(x.top10Share)
    );

    console.log(
      "Regimes         :",
      x.representedRegimes
    );

    console.log(
      "Decision        :",x.decision
    );
  }

  const finalDecision=
    pass.length>0
      ? "FOREIGN_FLOW_LOCK_CANDIDATE"
      : "FOREIGN_FLOW_FAIL";

  console.log("");
  console.log("================================================");
  console.log("FINAL DECISION");
  console.log("================================================");
  console.log("PASS thresholds :",pass.length);
  console.log("DECISION        :",finalDecision);

  const stamp=
    new Date().toISOString()
      .replace(/[:.]/g,"-");

  const jsonPath=
    path.join(
      OUT,
      `sf-foreign-flow-validation-${stamp}.json`
    );

  const csvPath=
    path.join(
      OUT,
      `sf-foreign-flow-validation-${stamp}.csv`
    );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      engine:"SF_FOREIGN_FLOW_VALIDATION_V1",
      period:{START,END},
      finalDecision,
      summaries,
      details:results
    },null,2)
  );

  const headers=[
    ...new Set(
      results.flatMap(x=>Object.keys(x))
    )
  ];

  const esc=v=>{
    if(v===undefined || v===null) return "";
    const s=String(v);
    return /[,"\n]/.test(s)
      ? `"${s.replace(/"/g,'""')}"`
      : s;
  };

  fs.writeFileSync(
    csvPath,
    [
      headers.join(","),
      ...results.map(r =>
        headers.map(h=>esc(r[h])).join(",")
      )
    ].join("\n")
  );

  console.log("");
  console.log("JSON:",jsonPath);
  console.log("CSV :",csvPath);

})();