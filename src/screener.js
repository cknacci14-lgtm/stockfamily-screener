// src/screener.js - Main Screener Engine
const { calculatePilarA } = require('./engines/pilarA');
const { calculatePilarB } = require('./engines/pilarB');
const { calculatePilarC } = require('./engines/pilarC');

function runScreener(stocks) {
  console.log(`[Screener] Memproses ${stocks.length} saham...`);
  
  const results = [];
  const grandSlams = [];
  
  stocks.forEach((stock, index) => {
    // Hitung skor masing-masing pilar
    const pilarA = calculatePilarA(stock);
    const pilarB = calculatePilarB(stock);
    const pilarC = calculatePilarC(stock);
    
    // Status lolos
    const isAccumulation = pilarA >= 70;
    const isOversold = pilarB >= 60;
    const isTrusted = pilarC >= 70;
    const isGrandSlam = isAccumulation && isOversold && isTrusted;
    
    // Power Score (bobot: A=50%, B=30%, C=20%)
    const powerScore = (pilarA * 0.5) + (pilarB * 0.3) + (pilarC * 0.2);
    
    const result = {
      ...stock,
      pilarA,
      pilarB,
      pilarC,
      isAccumulation,
      isOversold,
      isTrusted,
      isGrandSlam,
      powerScore: Math.round(powerScore * 10) / 10,
      recommendation: isGrandSlam ? 'GRAND SLAM' : 
                     isAccumulation ? 'BUY' : 
                     isOversold ? 'WATCH' : 'HOLD'
    };
    
    results.push(result);
    
    if (isGrandSlam) {
      grandSlams.push(result);
    }
    
    // Progress setiap 100 saham
    if ((index + 1) % 100 === 0) {
      console.log(`[Screener] Memproses ${index + 1}/${stocks.length}...`);
    }
  });
  
  // Urutkan Grand Slam berdasarkan Power Score
  grandSlams.sort((a, b) => b.powerScore - a.powerScore);
  
  console.log(`[Screener] Selesai!`);
  console.log(`[Screener] Total Grand Slam: ${grandSlams.length}`);
  
  return {
    all: results,
    grandSlams: grandSlams,
    summary: {
      total: results.length,
      accumulation: results.filter(r => r.isAccumulation).length,
      oversold: results.filter(r => r.isOversold).length,
      trusted: results.filter(r => r.isTrusted).length,
      grandSlam: grandSlams.length
    }
  };
}

module.exports = { runScreener };