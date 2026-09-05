// src/scrapers/autoScraper.js
const fs = require('fs');
const path = require('path');
const { getDailyDataFromYahoo } = require('../connectors/yahooConnector');
const { getBrokerSummary } = require('../connectors/stockbitConnector');
const { getSeasonality } = require('../connectors/arjumConnector');

console.log('[AutoScraper] Memulai pengambilan data otomatis...');

async function autoScrape() {
  console.log('[AutoScraper] Step 1: Mengambil data dari Yahoo Finance...');
  const yahooData = await getDailyDataFromYahoo();
  
  console.log(`[AutoScraper] Step 2: Mendapatkan ${yahooData.length} saham dari Yahoo`);

  // Simpan ke file
  const outputDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `auto_daily_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(yahooData, null, 2));
  
  console.log(`[AutoScraper] Data disimpan di: ${outputPath}`);
  console.log(`[AutoScraper] Total ${yahooData.length} saham`);
  
  return yahooData;
}

// Jalankan jika dipanggil langsung
if (require.main === module) {
  autoScrape()
    .then(() => console.log('[AutoScraper] Selesai!'))
    .catch(err => console.error('[AutoScraper] Error:', err));
}

module.exports = { autoScrape };