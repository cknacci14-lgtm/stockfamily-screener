const {
  getDates,
  getLatestDate,
  getSnapshot,
  getAllHistory,
  normalizeDate
} = require('../database/historicalDb');

function sma(values, period) {
  if (!values.length) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function buildCompositeIndex(byDate, dates) {
  const series = [];

  for (const date of dates) {
    const rows = byDate[date] || [];
    let totalValue = 0;
    let weightedClose = 0;
    let totalVolume = 0;

    for (const r of rows) {
      const close = Number(r.close) || 0;
      const volume = Number(r.volume) || 0;
      const value = Number(r.value) || close * volume;
      if (close <= 0 || value <= 0) continue;

      weightedClose += close * value;
      totalValue += value;
      totalVolume += volume;
    }

    if (totalValue > 0) {
      series.push({
        date,
        close: weightedClose / totalValue,
        volume: totalVolume
      });
    }
  }

  return series;
}

function computeIndicators(history) {
  if (!history || !history.length) return null;

  const latest = history[history.length - 1];
  const closes = history.map(h => Number(h.close) || 0);
  const volumes = history.map(h => Number(h.volume) || 0);
  const highs = history.map(h => Number(h.high) || 0);

  const pctReturn = n => {
    if (history.length <= n) return 0;
    const past = closes[closes.length - 1 - n];
    return past > 0 ? ((latest.close - past) / past) * 100 : 0;
  };

  const window = history.slice(-60);
  const dailyReturns = [];

  for (let i = 1; i < window.length; i++) {
    const prev = Number(window[i - 1].close) || 0;
    const curr = Number(window[i].close) || 0;
    if (prev > 0 && curr > 0) {
      dailyReturns.push(((curr - prev) / prev) * 100);
    }
  }

  const negReturns = dailyReturns.filter(r => r < 0);
  let downsideDeviation = 2.0;

  if (negReturns.length > 1) {
    const mean = negReturns.reduce((a, b) => a + b, 0) / negReturns.length;
    const variance =
      negReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
      negReturns.length;

    downsideDeviation = Math.sqrt(variance) || 2.0;
  }

  const weeklyHH =
    history.length >= 6 &&
    latest.close >
      Math.max(...history.slice(-6, -1).map(h => Number(h.high) || 0));

  return {
    ...latest,
    avgVolume20: sma(volumes, 20),
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    high52Week: Math.max(...highs),
    weeklyHH,
    return20d: pctReturn(20),
    return60d: pctReturn(60),
    return120d: pctReturn(120),
    downsideDeviation,
    beta: 1.0,
    historyLength: history.length
  };
}

async function buildAlphaTrinityInputs(options = {}) {
  const requestedDate = options.date ? normalizeDate(options.date) : null;

  const dates = await getDates();

  if (!dates.length) {
    return {
      stocks: [],
      ihsgData: [],
      dataPoints: 0,
      latestDate: null,
      note: 'Tidak ada data historis.'
    };
  }

  const availableDates = dates
    .map(normalizeDate)
    .filter(Boolean)
    .sort();

  const latestDate =
    requestedDate
      ? availableDates.filter(d => d <= requestedDate).pop()
      : availableDates[availableDates.length - 1];

  if (!latestDate) {
    return {
      stocks: [],
      ihsgData: [],
      dataPoints: 0,
      latestDate: null,
      note: 'Tidak ada trading day <= tanggal yang diminta.'
    };
  }

  // PENTING:
  // Hanya ambil history sampai latestDate.
  // Tidak boleh mengambil data masa depan saat backtest.
  const rawHistory = await getAllHistory(null, latestDate);

  const byCode = {};

  for (const row of rawHistory || []) {
    const date = normalizeDate(row.date || row.trade_date);
    const code = String(row.code || '').trim().toUpperCase();

    if (!date || !code || date > latestDate) continue;

    const normalized = {
      ...row,
      code,
      date,
      open: Number(row.open) || 0,
      high: Number(row.high) || 0,
      low: Number(row.low) || 0,
      close: Number(row.close) || 0,
      volume: Number(row.volume) || 0,
      value: Number(row.value) || 0
    };

    if (!byCode[code]) byCode[code] = [];
    byCode[code].push(normalized);
  }

  for (const code of Object.keys(byCode)) {
    byCode[code].sort((a, b) => a.date.localeCompare(b.date));
  }

  const snapshot = await getSnapshot(latestDate, {
    includeInactive: false
  });

  const snapshotCodes = new Set(
    (snapshot || [])
      .map(r => String(r.code || '').trim().toUpperCase())
      .filter(Boolean)
  );

  const stocks = [...snapshotCodes]
    .map(code => computeIndicators(byCode[code]))
    .filter(Boolean);

  const byDate = {};

  for (const row of rawHistory || []) {
    const date = normalizeDate(row.date || row.trade_date);
    const code = String(row.code || '').trim().toUpperCase();

    if (!date || !code || date > latestDate) continue;

    if (!byDate[date]) byDate[date] = [];

    byDate[date].push({
      ...row,
      code,
      date,
      close: Number(row.close) || 0,
      volume: Number(row.volume) || 0,
      value: Number(row.value) || 0
    });
  }

  const historyDates = Object.keys(byDate).sort();
  const ihsgData = buildCompositeIndex(byDate, historyDates);

  return {
    stocks,
    ihsgData,
    dataPoints: historyDates.length,
    latestDate,
    note:
      historyDates.length < 200
        ? `Hanya ${historyDates.length} hari data historis tersedia (idealnya >=200 untuk deteksi regime penuh).`
        : null
  };
}

module.exports = {
  buildAlphaTrinityInputs,
  computeIndicators,
  buildCompositeIndex
};
