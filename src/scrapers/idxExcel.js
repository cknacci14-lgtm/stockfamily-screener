const xlsx = require('xlsx');
const path = require('path');

console.log('[Scraper] Membaca data dari file Excel...');

function scrapeIDXFromExcel() {
  try {
    // Cari file Excel di folder data
    const dataDir = path.join(__dirname, '../../data');
    const files = require('fs').readdirSync(dataDir);
    const excelFile = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    
    if (!excelFile) {
      throw new Error('File Excel tidak ditemukan di folder data/');
    }

    const filePath = path.join(dataDir, excelFile);
    console.log(`[Scraper] Membaca file: ${excelFile}`);

    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    console.log(`[Scraper] Ditemukan ${data.length} baris data`);

    const stocks = data
      .filter(row => {
        const volume = parseInt(row['Volume'] || row['volume'] || 0);
        return volume > 0;
      })
      .map(row => ({
        code: (row['Kode Saham'] || row['code'] || '').toString().trim(),
        date: new Date().toISOString().split('T')[0],
        open: parseFloat(row['Open Price'] || row['openPrice'] || row['Open'] || 0),
        high: parseFloat(row['Tertinggi'] || row['High'] || row['high'] || 0),
        low: parseFloat(row['Terendah'] || row['Low'] || row['low'] || 0),
        close: parseFloat(row['Penutupan'] || row['Close'] || row['close'] || 0),
        volume: parseInt(row['Volume'] || row['volume'] || 0),
        value: parseFloat(row['Nilai'] || row['Value'] || row['value'] || 0),
        frequency: parseInt(row['Frekuensi'] || row['Frequency'] || row['frequency'] || 0),
        foreign_buy: parseInt(row['Foreign Buy'] || row['foreignBuy'] || row['foreign_buy'] || 0),
        foreign_sell: parseInt(row['Foreign Sell'] || row['foreignSell'] || row['foreign_sell'] || 0),
        listed_shares: parseFloat(row['Listed Shares'] || row['listedShares'] || row['listed_shares'] || 0),
        tradeable_shares: parseFloat(row['Tradeble Shares'] || row['tradeableShares'] || row['tradeable_shares'] || 0)
      }))
      .filter(item => item.code && /^[A-Z]+$/.test(item.code) && item.code.length >= 2);

    console.log(`[Scraper] Berhasil mengambil ${stocks.length} saham aktif`);
    return stocks;

  } catch (error) {
    console.error('[Scraper] Error:', error.message);
    throw error;
  }
}

async function runIDXScraper() {
  try {
    const stocks = scrapeIDXFromExcel();
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