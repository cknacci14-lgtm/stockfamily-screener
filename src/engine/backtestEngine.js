const { fetchHistoricalDataFromSupabase } = require('../database/supabaseDataPipeline');

async function getAvailableDates(){
  const db = await fetchHistoricalDataFromSupabase({limitDays: 600});
  if(!db) return [];
  const datesSet = new Set();
  Object.values(db).forEach(arr=> arr.forEach(r=> datesSet.add(r.date)));
  const dates = Array.from(datesSet).sort();
  console.log('[Backtest] Total unique dates in DB:', dates.length, 'last:', dates.slice(-3));
  return dates;
}

/**
 * SCORE "Quiet Accumulation Teroptimasi" v3
 */
function computeQuietScore({ close, volRatio5, spread, offerBidRatio }){
  const closeScore = ((200 - close) / 200) * 35;
  const volScore = Math.max(0, (1 - volRatio5)) * 30;
  const spreadScore = Math.max(0, ((0.05 - spread) / 0.05)) * 20;
  const obRatioClamped = Math.min(offerBidRatio || 1, 10);
  const obScore = obRatioClamped * 15;

  return Math.round((closeScore + volScore + spreadScore + obScore) * 10) / 10;
}

function buildReasonArray({ volRatio5, freqRatio5, spread, offerBidRatio }){
  const parts = [];
  parts.push(`Vol MA5 ${Math.round(volRatio5 * 100)}%`);
  parts.push(`Freq MA5 ${Math.round(freqRatio5 * 100)}%`);
  parts.push(`Spread ${(spread * 100).toFixed(1)}%`);
  if (offerBidRatio > 1.0) {
    parts.push(`Offer Wall (${offerBidRatio.toFixed(1)}x)`);
  }
  return parts;
}

async function runBacktest(targetDateStr){
  console.log('[Backtest] runBacktest target:', targetDateStr);
  const db = await fetchHistoricalDataFromSupabase({limitDays: 600});
  if(!db) return [];
  const datesSet = new Set();
  Object.values(db).forEach(arr=> arr.forEach(r=> datesSet.add(r.date)));
  const sortedDates = Array.from(datesSet).sort();

  let targetIdx = sortedDates.length - 1;
  if(targetDateStr){
    const idx = sortedDates.indexOf(targetDateStr);
    if(idx>=0) targetIdx = idx;
    else {
      const before = sortedDates.filter(d=> d <= targetDateStr).pop();
      if(before) targetIdx = sortedDates.indexOf(before);
    }
  }
  const targetDate = sortedDates[targetIdx];

  if(targetIdx < 50) return [];

  const candidates = [];

  // ================= TAHAP 1: SELEKSI & HITUNG H0 =================
  for(const sym of Object.keys(db)){
    const arr = db[sym];
    const idx = arr.findIndex(r=> r.date === targetDate);
    if(idx < 20) continue;
    const today = arr[idx];
    if(!today) continue;

    const prevClose = arr[idx-1]?.close || today.close;
    
    const slice5 = arr.slice(idx-5, idx);
    const slice20 = arr.slice(idx-20, idx);
    if(slice5.length < 5 || slice20.length < 20) continue;

    const avgVol5 = slice5.reduce((s,r)=> s + (r.volume || 0), 0) / 5;
    const avgFreq5 = slice5.reduce((s,r)=> s + (r.frequency || 0), 0) / 5;
    const avgVol20 = slice20.reduce((s,r)=> s + (r.volume || 0), 0) / 20;
    const avgVal20 = slice20.reduce((s,r)=> s + (r.value || 0), 0) / 20;

    const todayRange = (today.high ?? today.close) - (today.low ?? today.close);
    const spread = prevClose > 0 ? todayRange / prevClose : 0;
    
    // Perubahan % Hari H0 dibanding Close H-1
    const h0_pct = prevClose > 0 ? ((today.close - prevClose) / prevClose) * 100 : 0;

    const volRatio5 = avgVol5 > 0 ? today.volume / avgVol5 : 1;
    const freqRatio5 = avgFreq5 > 0 ? (today.frequency || 0) / avgFreq5 : 1;
    
    const bidVol = today.bidVolume ?? 0;
    const offerVol = today.offerVolume ?? 0;
    const offerBidRatio = bidVol > 0 ? offerVol / bidVol : 0;

    // --- KRITERIA FILTER ---
    if (today.close <= 50 || today.close > 200) continue;
    if (today.value < 100_000_000 || today.value > 500_000_000) continue;
    if (volRatio5 > 0.85) continue;
    if ((today.frequency || 0) > 500 || freqRatio5 > 0.80) continue;
    if (spread > 0.05) continue;
    if (offerBidRatio <= 1.0) continue;
    if (h0_pct < -1.5 || h0_pct > 2.0) continue;

    const score = computeQuietScore({ close: today.close, volRatio5, spread, offerBidRatio });
    const reasons = buildReasonArray({ volRatio5, freqRatio5, spread, offerBidRatio });

    candidates.push({
      code: sym,
      date: targetDate,
      close: today.close,
      volume: today.volume,
      avgVol20,
      avgVal20,
      volRatio: volRatio5,
      valRatio: today.value / (avgVal20 || 1),
      rangeRatio: spread,
      h0_pct, // <-- Mengirimkan perubahan % Hari H0
      score,
      reasons,
      _idx: idx,
      _arr: arr
    });
  }

  candidates.sort((a,b)=> b.score - a.score);
  const selected = candidates.slice(0, 100);

  // ================= TAHAP 2: UKUR HASIL MASA DEPAN =================
  const results = selected.map(c => {
    const { _idx: idx, _arr: arr, ...rest } = c;
    const today = arr[idx];
    const future = arr.slice(idx+1, idx+4);
    let d1=0, d2=0, d3=0, max3=0;
    if(future[0]) d1 = ((future[0].close - today.close) / today.close) * 100;
    if(future[1]) d2 = ((future[1].close - today.close) / today.close) * 100;
    if(future[2]) d3 = ((future[2].close - today.close) / today.close) * 100;
    max3 = Math.max(d1, d2, d3);

    return {
      ...rest,
      d0_pct: rest.h0_pct, // Ekspor variabel d0_pct / h0_pct untuk frontend UI
      d1_pct: d1,
      d2_pct: d2,
      d3_pct: d3,
      max3_pct: max3
    };
  });

  return results;
}

module.exports = { getAvailableDates, runBacktest };