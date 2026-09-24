/**
 * GEM Score Engine
 * Quiet Accumulation / Hidden Gem Indicator
 * Compatible with supabaseDataPipeline format
 */

const { fetchHistoricalDataFromSupabase } = require("../database/supabaseDataPipeline");

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Hitung GEM Score untuk 1 hari
 * history = array of daily objects (sorted ascending by date)
 * index   = posisi hari yang sedang dihitung
 */
function calculateGemScore(history, index) {
  if (!Array.isArray(history) || index < 20) {
    return {
      gem_score: null,
      gem_signal: null,
      vol_ratio: null,
      foreign_net20: null,
      foreign_net5: null,
      price_pos: null,
      vol_std20: null,
      ret_20: null,
      ret_5: null,
      ma_dist: null,
    };
  }

  const window20 = history.slice(index - 19, index + 1);
  const window5 = history.slice(index - 4, index + 1);
  const windowRet = history.slice(index - 20, index + 1);

  if (window20.length !== 20 || window5.length !== 5 || windowRet.length !== 21) {
    return {
      gem_score: null,
      gem_signal: null,
      vol_ratio: null,
      foreign_net20: null,
      foreign_net5: null,
      price_pos: null,
      vol_std20: null,
      ret_20: null,
      ret_5: null,
      ma_dist: null,
    };
  }

  function numberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /*
   * Data integrity:
   * Jangan mengubah missing/invalid menjadi 0.
   *
   * Semua field berikut dibutuhkan oleh scoring GEM.
   * Nilai 0 tetap valid dan tidak dianggap missing.
   */
  const requiredFields = [
    "volume",
    "close",
    "high",
    "low",
    "foreignBuy",
    "foreignSell",
    "frequency",
  ];

  for (const row of windowRet) {
    for (const field of requiredFields) {
      if (numberOrNull(row?.[field]) === null) {
        return {
          gem_score: null,
          gem_signal: null,
          vol_ratio: null,
          foreign_net20: null,
          foreign_net5: null,
          price_pos: null,
          vol_std20: null,
          ret_20: null,
          ret_5: null,
          ma_dist: null,
        };
      }
    }
  }

  const volumes20 = window20.map(d => numberOrNull(d.volume));
  const volumes5 = window5.map(d => numberOrNull(d.volume));

  const closes20 = window20.map(d => numberOrNull(d.close));
  const closesRet = windowRet.map(d => numberOrNull(d.close));

  const highs20 = window20.map(d => numberOrNull(d.high));
  const lows20 = window20.map(d => numberOrNull(d.low));

  const foreignBuys20 = window20.map(d => numberOrNull(d.foreignBuy));
  const foreignSells20 = window20.map(d => numberOrNull(d.foreignSell));

  const freqs20 = window20.map(d => numberOrNull(d.frequency));

  const volMa20 = average(volumes20);
  const volMa5 = average(volumes5);

  /*
   * Volume ratio tetap 5D average / 20D average.
   * Tetapi volume nol tidak lagi diberi fallback "1"
   * yang akan menghasilkan bonus volume palsu.
   */
  const volRatio =
    volMa20 > 0
      ? volMa5 / volMa20
      : null;

  const foreignNet20 =
    foreignBuys20.reduce((a, b) => a + b, 0) -
    foreignSells20.reduce((a, b) => a + b, 0);

  const foreignNet5 =
    window5.reduce(
      (sum, d) => sum + numberOrNull(d.foreignBuy),
      0
    ) -
    window5.reduce(
      (sum, d) => sum + numberOrNull(d.foreignSell),
      0
    );

  const high20 = Math.max(...highs20);
  const low20 = Math.min(...lows20);

  const close = closes20[closes20.length - 1];

  const pricePos =
    high20 > low20
      ? (close - low20) / (high20 - low20)
      : 0.5;

  /*
   * FIX OFF-BY-ONE
   *
   * ret20:
   * Close[t] dibanding Close[t-20]
   *
   * ret5:
   * Close[t] dibanding Close[t-5]
   */
  const close20Ago = numberOrNull(history[index - 20]?.close);
  const close5Ago = numberOrNull(history[index - 5]?.close);

  if (close20Ago === null || close5Ago === null) {
    return {
      gem_score: null,
      gem_signal: null,
      vol_ratio: null,
      foreign_net20: null,
      foreign_net5: null,
      price_pos: null,
      vol_std20: null,
      ret_20: null,
      ret_5: null,
      ma_dist: null,
    };
  }

  const ret20 =
    close20Ago > 0
      ? (close - close20Ago) / close20Ago
      : null;

  const ret5 =
    close5Ago > 0
      ? (close - close5Ago) / close5Ago
      : null;

  /*
   * FIX VOLATILITY
   *
   * 21 closes -> 20 daily returns.
   */
  const returns = [];

  for (let i = 1; i < closesRet.length; i++) {
    const previous = closesRet[i - 1];
    const current = closesRet[i];

    if (previous > 0) {
      returns.push((current - previous) / previous);
    }
  }

  const volStd20 =
    returns.length === 20
      ? standardDeviation(returns)
      : null;

  const freqMa20 = average(freqs20);
  const closeMa20 = average(closes20);

  const maDist =
    closeMa20 > 0
      ? (close - closeMa20) / closeMa20
      : null;

  // ===== SCORING (0-100) =====

  let score = 0;

  // 1. Volume Acceleration (0-25)
  if (volRatio !== null) {
    if (volRatio >= 2.5) score += 25;
    else if (volRatio >= 1.8) score += 20;
    else if (volRatio >= 1.4) score += 15;
    else if (volRatio >= 1.2) score += 10;
    else if (volRatio >= 1.0) score += 5;
  }

  // 2. Foreign Smart Money (0-25)
  if (foreignNet20 > 5_000_000 && foreignNet5 > 0) score += 25;
  else if (foreignNet20 > 1_000_000 && foreignNet5 >= 0) score += 20;
  else if (foreignNet20 > 200_000) score += 15;
  else if (foreignNet20 > 0) score += 10;
  else if (foreignNet20 > -500_000) score += 3;

  // 3. Price Structure (0-20)
  if (maDist !== null && maDist > 0.03 && pricePos > 0.7) score += 20;
  else if (maDist !== null && maDist > 0 && pricePos > 0.55) score += 15;
  else if (maDist !== null && maDist > -0.02 && pricePos > 0.45) score += 10;
  else if (pricePos > 0.4) score += 5;

  // 4. Controlled Volatility + Quietness (0-15)
  if (volStd20 !== null) {
    if (volStd20 < 0.03 && freqMa20 < 300) score += 15;
    else if (volStd20 < 0.045 && freqMa20 < 600) score += 12;
    else if (volStd20 < 0.06 && freqMa20 < 1000) score += 8;
    else if (volStd20 < 0.08) score += 4;
  }

  // 5. Momentum Quality (0-15)
  if (ret20 !== null && ret5 !== null) {
    if (ret20 > -0.05 && ret20 < 0.25 && ret5 > 0) score += 15;
    else if (ret20 > -0.1 && ret20 < 0.35 && ret5 > -0.03) score += 10;
    else if (ret20 > -0.15 && ret20 < 0.45) score += 5;
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  let signal = "WEAK / DIST";

  if (score >= 75) signal = "STRONG ACCUM";
  else if (score >= 60) signal = "ACCUMULATING";
  else if (score >= 45) signal = "WATCH";
  else if (score >= 30) signal = "NEUTRAL";

  return {
    gem_score: score,
    gem_signal: signal,
    vol_ratio: volRatio !== null
      ? Number(volRatio.toFixed(3))
      : null,
    foreign_net20: Math.round(foreignNet20),
    foreign_net5: Math.round(foreignNet5),
    price_pos: Number(pricePos.toFixed(3)),
    vol_std20: volStd20 !== null
      ? Number(volStd20.toFixed(4))
      : null,
    ret_20: ret20 !== null
      ? Number(ret20.toFixed(4))
      : null,
    ret_5: ret5 !== null
      ? Number(ret5.toFixed(4))
      : null,
    ma_dist: maDist !== null
      ? Number(maDist.toFixed(4))
      : null,
  };
}

/**
 * Historical GEM Score untuk 1 ticker
 */
async function calculateGemScoreForTicker(code) {
  const raw = await fetchHistoricalDataFromSupabase({
    ticker: code.toUpperCase(),
    limitDays: 400,
  });

  if (!raw || !raw[code.toUpperCase()]) {
    return [];
  }

  const history = raw[code.toUpperCase()];
  // sudah di-sort di pipeline, tapi pastikan lagi
  history.sort((a, b) => new Date(a.date) - new Date(b.date));

  const results = [];
  for (let i = 0; i < history.length; i++) {
    const scoreData = calculateGemScore(history, i);
    results.push({
      code: code.toUpperCase(),
      trade_date: history[i].date,
      close: history[i].close,
      ...scoreData,
    });
  }
  return results;
}

/**
 * Latest GEM Score untuk banyak ticker
 */
async function calculateLatestGemScores(codes = []) {
  const results = [];

  for (const code of codes) {
    try {
      const upper = code.toUpperCase();
      const raw = await fetchHistoricalDataFromSupabase({
        ticker: upper,
        limitDays: 60,
      });

      if (!raw || !raw[upper] || raw[upper].length < 25) continue;

      const history = raw[upper];
      history.sort((a, b) => new Date(a.date) - new Date(b.date));

      const lastIndex = history.length - 1;
      const scoreData = calculateGemScore(history, lastIndex);

      results.push({
        code: upper,
        trade_date: history[lastIndex].date,
        close: history[lastIndex].close,
        ...scoreData,
      });
    } catch (err) {
      console.error(`GEM Score error ${code}:`, err.message);
    }
  }

  return results;
}

module.exports = {
  calculateGemScore,
  calculateGemScoreForTicker,
  calculateLatestGemScores,
};