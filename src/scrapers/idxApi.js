const axios = require('axios');
require('dotenv').config();

console.log('[Scraper] Memulai scraping IDX via API...');

async function scrapeIDX() {
  try {
    // Endpoint API IDX untuk ringkasan saham
    const url = 'https://www.idx.co.id/primary/StockData/GetStockData';
    
    console.log(`[Scraper] Mengakses API: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    // Cek apakah response berupa array
    let data = response.data;
    
    // Jika data adalah string JSON, parse dulu
    if (typeof data === 'string') {
      data = JSON.parse(data);
    }

    // Jika data berbentuk { data: [...] }
    if (data && data.data && Array.isArray(data.data)) {
      data = data.data;
    }

    // Jika data adalah array langsung
    if (!Array.isArray(data)) {
      console.log('[Scraper] Format data tidak dikenali:', typeof data);
      console.log('[Scraper] Sample:', JSON.stringify(data).slice(0, 200));
      return [];
    }

    console.log(`[Scraper] Ditemukan ${data.length} saham`);

    const stocks = data
      .filter(item => item.Volume > 0) // Filter saham dengan volume > 0
      .map(item => ({
        code: item.KodeSaham || item.kodeSaham || item.code || '',
        date: new Date().toISOString().split('T')[0],
        open: parseInt(item.OpenPrice || item.openPrice || item.open || 0),
        high: parseInt(item.High || item.high || item.Tertinggi || 0),
        low: parseInt(item.Low || item.low || item.Terendah || 0),
        close: parseInt(item.Close || item.close || item.Penutupan || 0),
        volume: parseInt(item.Volume || item.volume || 0),
        value: parseInt(item.Value || item.value || item.Nilai || 0),
        frequency: parseInt(item.Frequency || item.frequency || item.Frekuensi || 0),
        foreign_buy: parseInt(item.ForeignBuy || item.foreignBuy || 0),
        foreign_sell: parseInt(item.ForeignSell || item.foreignSell || 0),
        listed_shares: parseInt(item.ListedShares || item.listedShares || 0),
        tradeable_shares: parseInt(item.TradeableShares || item.tradeableShares || 0)
      }))
      .filter(item => item.code && /^[A-Z]+$/.test(item.code));

    console.log(`[Scraper] Berhasil mengambil ${stocks.length} saham aktif`);
    return stocks;

  } catch (error) {
    console.error('[Scraper] Error:', error.message);
    if (error.response) {
      console.error('[Scraper] Status:', error.response.status);
      console.error('[Scraper] Data:', error.response.data);
    }
    throw error;
  }
}

async function runIDXScraper() {
  try {
    const stocks = await scrapeIDX();
    console.log('Sample data (5 saham pertama):');
    console.log(JSON.stringify(stocks.slice(0, 5), null, 2));
    console.log(`[Scraper] Total ${stocks.length} saham berhasil diambil!`);
    console.log('[Scraper] Selesai!');
  } catch (error) {
    console.error('[Scraper] Gagal:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runIDXScraper();
}