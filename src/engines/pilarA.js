// src/engines/pilarA.js - Accumulation Zone
function calculatePilarA(stock) {
  let score = 0;
  
  // 1. Komponen Foreign (50 poin)
  const netForeign = (stock.foreign_buy || 0) - (stock.foreign_sell || 0);
  
  if (netForeign > 0) {
    // Skala: 0-50 poin berdasarkan net foreign
    const maxForeign = 10000000; // 10 juta saham
    const foreignScore = Math.min(50, (netForeign / maxForeign) * 50);
    score += foreignScore;
  }
  
  // 2. Komponen Volume (30 poin)
  const avgVolume = stock.volume || 0;
  if (avgVolume > 10000000) {
    score += 30;
  } else if (avgVolume > 5000000) {
    score += 20;
  } else if (avgVolume > 1000000) {
    score += 10;
  }
  
  // 3. Komponen Likuiditas (20 poin)
  const listedShares = stock.listed_shares || 0;
  if (listedShares > 10000000000) {
    score += 20;
  } else if (listedShares > 5000000000) {
    score += 10;
  }
  
  return Math.min(100, Math.round(score));
}

module.exports = { calculatePilarA };