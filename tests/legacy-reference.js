// SALINAN VERBATIM kode lama, dipakai hanya sebagai pembanding di tes.
// Sumber: calcRSI di public/app.html; num/valid/mean/last/sma/trueRange/atr di src/lib/smartwatchlist-core.js
// ASUMSI: cabang akhir atr() terpotong di output audit; diasumsikan "undefined".
function calcRSI(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) {
    return null;
  }
  const closes = candles
    .map(c => Number(c?.close))
    .filter(Number.isFinite);
  if (closes.length < period + 1) {
    return null;
  }
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      gainSum += diff;
    } else if (diff < 0) {
      lossSum -= diff;
    }
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }
  if (avgLoss === 0) {
    return avgGain > 0 ? 100 : 50;
  }
  if (avgGain === 0) {
    return 0;
  }
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function valid(values) { return values.filter(Number.isFinite); }
function mean(values) {
  const v = valid(values);
  if (!v.length) { return undefined; }
  return (v.reduce((sum, value) => sum + value, 0) / v.length);
}
function last(rows, n) { return rows.slice(Math.max(0, rows.length - n)); }
function sma(rows, field, n) {
  if (rows.length < n) { return undefined; }
  return mean(last(rows, n).map(row => num(row[field])));
}
function trueRange(row, previousClose) {
  const high = num(row.high);
  const low = num(row.low);
  const previous = num(previousClose);
  if (!Number.isFinite(high) || !Number.isFinite(low)) { return undefined; }
  if (!Number.isFinite(previous)) { return high - low; }
  return Math.max(high - low, Math.abs(high - previous), Math.abs(low - previous));
}
function atr(rows, n = 14) {
  if (rows.length < n + 1) { return undefined; }
  const recent = last(rows, n + 1);
  const ranges = [];
  for (let i = 0; i < recent.length; i++) {
    const previousClose = i > 0 ? recent[i - 1].close : undefined;
    const tr = trueRange(recent[i], previousClose);
    if (Number.isFinite(tr)) { ranges.push(tr); }
  }
  return ranges.length >= n ? mean(last(ranges, n)) : undefined;
}

module.exports = { calcRSI, sma, atr };
