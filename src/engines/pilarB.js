// src/engines/pilarB.js - Oversold & Reversal
function calculatePilarB(stock) {
  let score = 0;
  
  const high = stock.high || 0;
  const low = stock.low || 0;
  const close = stock.close || 0;
  const open = stock.open || 0;
  
  // 1. Posisi Harga terhadap Range (40 poin)
  if (high > 0 && low > 0) {
    const range = high - low;
    const position = range > 0 ? (close - low) / range : 0.5;
    
    // Jika close di dekat low (oversold)
    if (position < 0.2) {
      score += 40;
    } else if (position < 0.4) {
      score += 30;
    } else if (position < 0.6) {
      score += 15;
    }
  }
  
  // 2. Deteksi Pola Candlestick (30 poin)
  if (open > 0 && close > 0 && high > 0 && low > 0) {
    const body = Math.abs(close - open);
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;
    
    // Hammer (sumbu bawah panjang, tubuh kecil di atas)
    if (lowerWick > body * 2 && upperWick < body * 0.5 && body > 0) {
      score += 30;
    }
    // Bullish Engulfing (candle hijau menutupi candle merah sebelumnya)
    // Catatan: Ini butuh data hari sebelumnya, untuk sekarang kita skip
    // Doji (body sangat kecil)
    else if (body < 0.01 * (high - low) && body > 0) {
      score += 15;
    }
  }
  
  // 3. Volume Spike (30 poin)
  // Catatan: Butuh rata-rata volume, kita pakai volume > 2x rata-rata
  // Untuk sekarang, kita asumsikan volume > 10 juta itu spike
  const volume = stock.volume || 0;
  if (volume > 20000000) {
    score += 30;
  } else if (volume > 10000000) {
    score += 15;
  }
  
  return Math.min(100, Math.round(score));
}

module.exports = { calculatePilarB };