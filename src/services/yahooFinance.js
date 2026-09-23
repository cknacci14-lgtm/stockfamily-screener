// src/services/yahooFinance.js

export async function fetchIDXChart(ticker, range = '1mo', interval = '1d') {
  const symbol = ticker.endsWith('.JK') ? ticker : `${ticker}.JK`;
  
  // Menggunakan URL proxy atau query langsung
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
      throw new Error("Data tidak ditemukan untuk ticker " + symbol);
    }

    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const quotes = result.indicators.quote[0] || {};

    const candleData = [];
    const volumeData = [];

    for (let i = 0; i < timestamps.length; i++) {
      const open = quotes.open[i];
      const high = quotes.high[i];
      const low = quotes.low[i];
      const close = quotes.close[i];
      const volume = quotes.volume ? quotes.volume[i] : 0;

      // Filter data valid
      if (open !== null && high !== null && low !== null && close !== null) {
        candleData.push({
          time: timestamps[i],
          open: open,
          high: high,
          low: low,
          close: close,
        });

        volumeData.push({
          time: timestamps[i],
          value: volume || 0,
          color: close >= open ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'
        });
      }
    }

    return { candleData, volumeData, meta: result.meta };
  } catch (error) {
    console.error("Error fetching Yahoo Finance data:", error);
    throw error;
  }
}