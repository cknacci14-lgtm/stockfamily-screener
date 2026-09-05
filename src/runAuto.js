// src/runAuto.js
const fs = require('fs');
const path = require('path');
const { runScreener } = require('./screener');

console.log('[Runner] Memulai screener dari auto data...');

function loadStocksFromJSON() {
  const dataDir = path.join(__dirname, '../data');
  const files = fs.readdirSync(dataDir);
  const jsonFile = files.find(f => f.startsWith('auto_daily_') && f.endsWith('.json'));
  
  if (!jsonFile) {
    console.error('[Runner] File JSON auto_daily tidak ditemukan.');
    console.log('   Jalankan: node src/scrapers/autoScraper.js');
    return [];
  }

  const filePath = path.join(dataDir, jsonFile);
  console.log(`[Runner] Membaca file: ${jsonFile}`);
  
  const rawData = fs.readFileSync(filePath, 'utf8');
  const stocks = JSON.parse(rawData);
  
  console.log(`[Runner] ${stocks.length} saham aktif`);
  return stocks;
}

async function main() {
  try {
    const stocks = loadStocksFromJSON();
    if (stocks.length === 0) {
      console.log('[Runner] Tidak ada data saham.');
      return;
    }
    
    const result = await runScreener(stocks);
    
    console.log('\n📊 SUMMARY:');
    console.log(`Total saham: ${result.summary.total}`);
    console.log(`✅ Accumulation (Pilar A ≥ 70): ${result.summary.accumulation}`);
    console.log(`✅ Oversold (Pilar B ≥ 60): ${result.summary.oversold}`);
    console.log(`✅ Trusted (Pilar C ≥ 70): ${result.summary.trusted}`);
    console.log(`🏆 GRAND SLAM: ${result.summary.grandSlam}`);
    
    if (result.grandSlams.length > 0) {
      console.log('\n🏆 TOP 5 GRAND SLAM:');
      result.grandSlams.slice(0, 5).forEach((s, i) => {
        console.log(`${i+1}. ${s.code} | Power: ${s.powerScore} | A:${s.pilarA} B:${s.pilarB} C:${s.pilarC}`);
      });
    }
    
  } catch (error) {
    console.error('[Runner] Error:', error);
  }
}

main();