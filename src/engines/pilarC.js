// src/engines/pilarC.js - Trust Score
function calculatePilarC(stock) {
  let score = 0;
  
  // 1. Likuiditas (40 poin)
  const volume = stock.volume || 0;
  if (volume > 20000000) {
    score += 40;
  } else if (volume > 10000000) {
    score += 30;
  } else if (volume > 5000000) {
    score += 20;
  } else if (volume > 1000000) {
    score += 10;
  }
  
  // 2. Ukuran Perusahaan (30 poin)
  const listedShares = stock.listed_shares || 0;
  if (listedShares > 10000000000) {
    score += 30;
  } else if (listedShares > 5000000000) {
    score += 20;
  } else if (listedShares > 1000000000) {
    score += 10;
  }
  
  // 3. Foreign Interest (30 poin)
  const netForeign = (stock.foreign_buy || 0) - (stock.foreign_sell || 0);
  if (netForeign > 5000000) {
    score += 30;
  } else if (netForeign > 1000000) {
    score += 20;
  } else if (netForeign > 0) {
    score += 10;
  }
  
  return Math.min(100, Math.round(score));
}

module.exports = { calculatePilarC };