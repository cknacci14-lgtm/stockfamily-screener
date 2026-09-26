const fs = require("fs");
const path = require("path");
const db = require("../src/database/historicalDb");

const OUT = path.join(process.cwd(), "data", "backtest");
fs.mkdirSync(OUT, { recursive: true });

const START = "2025-09-01";
const END   = "2026-09-24";

const HOLDINGS = [1, 3, 5, 10, 20];

// Thresholds are fixed BEFORE looking at results.
// No optimizer. No composite score.
const TH = {
  range:  [1.5, 2.0, 2.5, 3.0],
  volume: [1.5, 2.0, 2.5, 3.0],
  value:  [1.5, 2.0, 2.5, 3.0],
  foreign:[0.05, 0.10, 0.20]
};

function median(a) {
  const x = a.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!x.length) return NaN;
  const m = Math.floor(x.length/2);
  return x.length % 2 ? x[m] : (x[m-1]+x[m])/2;
}

function mean(a) {
  const x=a.filter(Number.isFinite);
  return x.length ? x.reduce((s,v)=>s+v,0)/x.length : NaN;
}

function pf(a) {
  const wins=a.filter(x=>x>0).reduce((s,v)=>s+v,0);
  const losses=Math.abs(a.filter(x=>x<0).reduce((s,v)=>s+v,0));
  return losses ? wins/losses : NaN;
}

function stats(rows, field) {
  const r=rows.map(x=>x[field]).filter(Number.isFinite);
  if (!r.length) return {};
  return {
    n:r.length,
    mean:mean(r),
    median:median(r),
    winRate:r.filter(x=>x>0).length/r.length,
    profitFactor:pf(r)
  };
}

function rollingMedian(arr, i, n, key) {
  if(i<n) return NaN;
  const vals=[];
  for(let j=i-n;j<i;j++) {
    const v=Number(arr[j][key]);
    if(Number.isFinite(v) && v>0) vals.push(v);
  }
  return median(vals);
}

function ret(entry, exit) {
  if(!Number.isFinite(entry) || !Number.isFinite(exit) || entry<=0) return NaN;
  return exit/entry-1;
}

(async()=>{
  console.log("==============================================");
  console.log("SF EDGE DISCOVERY V1");
  console.log("RAW EVENT STUDY — NO COMPOSITE SCORE");
  console.log("==============================================");

  const raw=await db.getAllHistory(START,END);
  console.log("Raw rows:",raw.length);

  const byCode=new Map();

  for(const r of raw) {
    const code=r.code || r.stock_code;
    if(!code) continue;
    if(!byCode.has(code)) byCode.set(code,[]);
    byCode.get(code).push({
      date:r.trade_date || r.date,
      open:Number(r.open),
      high:Number(r.high),
      low:Number(r.low),
      close:Number(r.close),
      volume:Number(r.volume),
      value:Number(r.value),
      frequency:Number(r.frequency),
      foreignBuy:Number(r.foreign_buy),
      foreignSell:Number(r.foreign_sell)
    });
  }

  for(const a of byCode.values()) {
    a.sort((x,y)=>x.date.localeCompare(y.date));
  }

  const events=[];

  for(const [code,a] of byCode) {
    for(let i=20;i<a.length-20;i++) {
      const t=a[i];
      const next=a[i+1];

      if(!Number.isFinite(next.open) || next.open<=0) continue;

      const range=Math.max(0,t.high-t.low);
      const prevClose=Number(t.close);
      if(!Number.isFinite(prevClose) || prevClose<=0) continue;

      const body=Math.abs(t.close-t.open)/prevClose;
      const closePos=range>0 ? (t.close-t.low)/range : 0.5;

      const rangeMed=rollingMedian(a,i,20,"high");
      const volMed=rollingMedian(a,i,20,"volume");
      const valueMed=rollingMedian(a,i,20,"value");

      const rangeRatio=Number.isFinite(rangeMed)&&rangeMed>0 ? range/rangeMed : NaN;
      const volumeRatio=Number.isFinite(volMed)&&volMed>0 ? t.volume/volMed : NaN;
      const valueRatio=Number.isFinite(valueMed)&&valueMed>0 ? t.value/valueMed : NaN;

      const foreignNet=t.foreignBuy-t.foreignSell;
      const foreignRatio=t.value>0 ? foreignNet/t.value : NaN;

      const f5=[];
      for(let j=Math.max(0,i-4);j<=i;j++) {
        const v=a[j].foreignBuy-a[j].foreignSell;
        if(Number.isFinite(v)) f5.push(v);
      }
      const foreignPersistence=f5.length ? f5.filter(x=>x>0).length/f5.length : NaN;

      const future={};
      for(const h of HOLDINGS) {
        const ex=a[i+h];
        if(ex) future[`ret_${h}d`]=ret(next.open,ex.close);
      }

      events.push({
        code,date:t.date,
        rangeRatio,volumeRatio,valueRatio,
        foreignRatio,foreignPersistence,
        bodyPct:body,
        closePosition:closePos,
        changePct:prevClose>0 ? (t.close-prevClose)/prevClose : NaN,
        ...future
      });
    }
  }

  console.log("Candidate events:",events.length);

  const eventDefs=[];

  for(const x of TH.range)
    eventDefs.push({name:`RANGE_${x}X`, test:e=>e.rangeRatio>=x});

  for(const x of TH.volume)
    eventDefs.push({name:`VOLUME_${x}X`, test:e=>e.volumeRatio>=x});

  for(const x of TH.value)
    eventDefs.push({name:`VALUE_${x}X`, test:e=>e.valueRatio>=x});

  for(const x of TH.foreign)
    eventDefs.push({name:`FOREIGN_${x}`, test:e=>e.foreignRatio>=x});

  eventDefs.push(
    {name:"PRICE_CLOSE_TOP_25",test:e=>e.closePosition>=0.75},
    {name:"PRICE_BODY_2PCT",test:e=>e.bodyPct>=0.02},
    {name:"PRICE_BODY_3PCT",test:e=>e.bodyPct>=0.03},
    {name:"FOREIGN_PERSIST_80",test:e=>e.foreignPersistence>=0.8}
  );

  const results=[];

  for(const def of eventDefs) {
    const selected=events.filter(def.test);

    for(const h of HOLDINGS) {
      const field=`ret_${h}d`;
      const st=stats(selected,field);

      results.push({
        event:def.name,
        holding:h,
        ...st
      });
    }
  }

  // Fixed chronological OOS: last 30% of dates.
  const dates=[...new Set(events.map(e=>e.date))].sort();
  const split=Math.floor(dates.length*0.70);
  const cutoff=dates[split];

  const oos=events.filter(e=>e.date>=cutoff);

  for(const def of eventDefs) {
    const selected=oos.filter(def.test);

    for(const h of HOLDINGS) {
      const field=`ret_${h}d`;
      const st=stats(selected,field);

      results.push({
        event:def.name,
        holding:h,
        sample:"OOS",
        cutoff,
        ...st
      });
    }
  }

  const stamp=new Date().toISOString().replace(/[:.]/g,"-");

  const csvEscape=v=>{
    if(v===undefined || v===null) return "";
    const s=String(v);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };

  const headers=[...new Set(results.flatMap(x=>Object.keys(x)))];
  const csv=[
    headers.join(","),
    ...results.map(r=>headers.map(h=>csvEscape(r[h])).join(","))
  ].join("\n");

  const csvPath=path.join(OUT,`sf-edge-discovery-${stamp}.csv`);
  fs.writeFileSync(csvPath,csv);

  // Decision table: OOS 5D is the primary gate.
  const decisions=[];

  for(const def of eventDefs) {
    const r=results.find(x=>
      x.sample==="OOS" &&
      x.event===def.name &&
      x.holding===5
    );

    let decision="FAIL";

    if(
      r &&
      r.n>=30 &&
      r.mean>0 &&
      r.median>0 &&
      r.profitFactor>1
    ) decision="PASS";

    decisions.push({
      event:def.name,
      n:r?.n||0,
      mean5d:r?.mean,
      median5d:r?.median,
      winRate:r?.winRate,
      profitFactor:r?.profitFactor,
      decision
    });
  }

  const pass=decisions.filter(x=>x.decision==="PASS");

  const report={
    engine:"SF_EDGE_DISCOVERY_V1",
    period:{start:START,end:END},
    rawRows:raw.length,
    candidateEvents:events.length,
    oosCutoff:cutoff,
    methodology:"Point-in-time event study; signal at completed T, entry at T+1 open.",
    primaryGate:"OOS 5D: n>=30, mean>0, median>0, profitFactor>1",
    decisions,
    passCount:pass.length,
    finalDecision:pass.length ? "EDGE_FOUND" : "NO_EDGE_FOUND"
  };

  const jsonPath=path.join(OUT,`sf-edge-discovery-${stamp}.json`);
  fs.writeFileSync(jsonPath,JSON.stringify(report,null,2));

  console.log("");
  console.log("==============================================");
  console.log("FINAL DECISION");
  console.log("==============================================");
  console.log("OOS cutoff :",cutoff);
  console.log("PASS events :",pass.length);
  console.log("DECISION    :",report.finalDecision);
  console.log("");
  for(const d of decisions) {
    console.log(
      `${d.event.padEnd(24)} N=${String(d.n).padStart(5)} `+
      `Median5D=${Number(d.median5d||0).toFixed(4)} `+
      `PF=${Number(d.profitFactor||0).toFixed(3)} `+
      `${d.decision}`
    );
  }

  console.log("");
  console.log("CSV :",csvPath);
  console.log("JSON:",jsonPath);
})();
