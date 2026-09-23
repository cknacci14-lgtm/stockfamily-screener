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
 * SCORE "Quiet Before Storm" v2 - hasil analisa statistik atas data historis riil.
 * Hanya pakai data <= H0.
 *
 * Perubahan dari v1 (berdasarkan analisa 41 tanggal out-of-sample):
 * 1. volRatio TIDAK LAGI "makin kecil makin baik" - sweet spot ada di sekitar 20%
 *    dari rata-rata volume 20 hari. Saham yang volumenya nyaris 0% (benar-benar mati)
 *    ternyata winrate-nya JAUH lebih rendah (10.3%) dibanding yang 15-30% (24.8%).
 * 2. Ditambahkan bidOfferImb - imbalance bid vs offer volume di order book EOD.
 *    Ini sinyal paling kuat: saham dengan minat beli (bid) dominan winrate 25.2%,
 *    vs yang offer dominan cuma 10.6%.
 * 3. rangeRatio juga pakai sweet spot (~35%), bukan makin sempit makin baik.
 *
 * Hasil backtest 41 tanggal out-of-sample (top 30): winrate >3% naik dari 19.0% -> 30.1%,
 * rate >5% ("meledak") naik dari 15.4% -> 18.9%.
 */
function computeQuietScore({ volRatio, valRatio, rangeRatio, bidOfferImb }){
  const clamp = (v)=> Math.min(Math.max(v, 0), 3);
  const vr = clamp(volRatio);
  const va = clamp(valRatio);
  const rr = clamp(rangeRatio);
  const bo = (bidOfferImb==null || isNaN(bidOfferImb)) ? -0.3 : bidOfferImb; // default konservatif kalau data kosong

  // volRatio: skor tertinggi di sekitar 0.20, turun makin jauh dari situ (ke arah 0 ATAU ke arah 0.8)
  const volComp = Math.max(0, 1 - Math.abs(vr - 0.20) / 0.35) * 35;
  // valRatio: tetap "makin kecil makin baik" tapi bobot dikurangi (dari 30 -> 20)
  const valComp = (1 - va) * 20;
  // rangeRatio: sweet spot ~0.35 (kontraksi volatilitas, tapi jangan sampai benar-benar flat)
  const rangeComp = Math.max(0, 1 - Math.abs(rr - 0.35) / 0.5) * 15;
  // bidOfferImb: makin positif (bid dominan) makin baik. Range asli -1..1 -> dipetakan ke 0..30
  const boComp = ((bo + 1) / 2) * 30;

  return Math.round((volComp + valComp + rangeComp + boComp) * 10) / 10;
}

function buildReasonArray({ volRatio, valRatio, rangeRatio, bidOfferImb }){
  const parts = [];
  parts.push(`Vol ${Math.round(volRatio*100)}% avg`);
  if(valRatio < 0.7) parts.push(`Val ${Math.round(valRatio*100)}% avg`);
  if(rangeRatio < 0.7) parts.push(`Range ${Math.round(rangeRatio*100)}% avg`);
  if(bidOfferImb!=null && !isNaN(bidOfferImb)){
    if(bidOfferImb > 0.1) parts.push(`Bid dominan (${(bidOfferImb*100).toFixed(0)}%)`);
    else if(bidOfferImb < -0.5) parts.push(`Offer dominan (${(bidOfferImb*100).toFixed(0)}%)`);
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
  console.log('[Backtest] Loaded symbols:', Object.keys(db).length, 'total dates:', sortedDates.length);

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
  console.log('[Backtest] Using target date:', targetDate, 'idx', targetIdx);

  if(targetIdx < 50) {
    console.log('[Backtest] Not enough history');
    return [];
  }

  const candidates = [];

  // ================= TAHAP 1: SELEKSI (hanya data <= H0) =================
  for(const sym of Object.keys(db)){
    const arr = db[sym];
    const idx = arr.findIndex(r=> r.date === targetDate);
    if(idx < 20) continue;
    const today = arr[idx];
    if(!today) continue;

    const slice20 = arr.slice(idx-20, idx);
    if(slice20.length < 20) continue;

    const avgVol20 = slice20.reduce((s,r)=> s+r.volume,0)/20;
    const avgVal20 = slice20.reduce((s,r)=> s+r.value,0)/20;
    const avgRange20 = slice20.reduce((s,r)=> s+((r.high ?? r.close) - (r.low ?? r.close)),0)/20;

    const todayRange = (today.high ?? today.close) - (today.low ?? today.close);

    const volRatio = avgVol20 > 0 ? today.volume / avgVol20 : 1;
    const valRatio = avgVal20 > 0 ? today.value / avgVal20 : 1;
    const rangeRatio = avgRange20 > 0 ? todayRange / avgRange20 : 1;

    const bidVol = today.bidVolume ?? 0;
    const offerVol = today.offerVolume ?? 0;
    const bidOfferImb = (bidVol + offerVol) > 0 ? (bidVol - offerVol) / (bidVol + offerVol) : null;

    // filter "quiet" dasar - tetap dipertahankan sebagai syarat masuk pool
    if(volRatio > 0.8) continue;
    if(valRatio > 0.9) continue;

    const score = computeQuietScore({ volRatio, valRatio, rangeRatio, bidOfferImb });
    const reasons = buildReasonArray({ volRatio, valRatio, rangeRatio, bidOfferImb });

    candidates.push({
      code: sym,
      date: targetDate,
      close: today.close,
      volume: today.volume,
      avgVol20,
      avgVal20,
      volRatio,
      valRatio,
      rangeRatio,
      bidOfferImb,
      score,
      reasons,
      _idx: idx,
      _arr: arr
    });
  }

  // Sort & potong top 100 BERDASARKAN SCORE (data <= H0), BUKAN berdasarkan hasil masa depan
  candidates.sort((a,b)=> b.score - a.score);
  const selected = candidates.slice(0, 100);
  console.log('[Backtest] Candidates after quiet filter:', candidates.length, '-> selected top:', selected.length);

  // ================= TAHAP 2: UKUR HASIL (data masa depan hanya untuk mengukur, bukan menyeleksi) =================
  const results = selected.map(c => {
    const { _idx: idx, _arr: arr, ...rest } = c;
    const today = arr[idx];
    const future = arr.slice(idx+1, idx+4);
    let d1=0,d2=0,d3=0,max3=0;
    if(future[0]) d1 = ((future[0].close - today.close)/today.close)*100;
    if(future[1]) d2 = ((future[1].close - today.close)/today.close)*100;
    if(future[2]) d3 = ((future[2].close - today.close)/today.close)*100;
    max3 = Math.max(d1,d2,d3);

    return {
      ...rest,
      d1_pct: d1,
      d2_pct: d2,
      d3_pct: d3,
      max3_pct: max3
    };
  });

  console.log('[Backtest] Result count:', results.length);
  return results;
}

module.exports = { getAvailableDates, runBacktest };
