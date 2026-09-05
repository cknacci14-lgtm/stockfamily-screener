const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
require('dotenv').config();

console.log('[Scraper] Memulai scraping IDX...');

async function scrapeIDX() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.setViewport({ width: 1920, height: 1080 });

    const baseUrl = 'https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/ringkasan-saham/';
    console.log(`[Scraper] Mengakses: ${baseUrl}`);

    await page.goto(baseUrl, { 
      waitUntil: 'networkidle2', 
      timeout: 60000 
    });

    await page.waitForTimeout(5000);

    // Klik tombol "Load More" jika ada
    try {
      await page.click('button.load-more, a.load-more, #load-more');
      console.log('[Scraper] Tombol Load More diklik...');
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log('[Scraper] Tidak ada tombol Load More, lanjut...');
    }

    // Ambil HTML
    const html = await page.content();
    const $ = cheerio.load(html);

    // Cari semua tabel
    const tables = $('table');
    console.log(`[Scraper] Ditemukan ${tables.length} tabel`);

    let stocks = [];

    tables.each((tableIndex, table) => {
      const rows = $(table).find('tbody tr');
      if (rows.length === 0) return;

      console.log(`[Scraper] Tabel ${tableIndex + 1}: ${rows.length} baris`);

      rows.each((index, element) => {
        const cells = $(element).find('td');
        if (cells.length < 8) return;

        const code = $(cells[0]).text().trim();
        if (!code || code.includes('Kode') || code.includes('Saham') || code === 'No') {
          return;
        }

        const high = parseInt($(cells[1]).text().replace(/[,.]/g, '')) || 0;
        const low = parseInt($(cells[2]).text().replace(/[,.]/g, '')) || 0;
        const close = parseInt($(cells[3]).text().replace(/[,.]/g, '')) || 0;
        const volume = parseInt($(cells[5]).text().replace(/[,.]/g, '')) || 0;
        const value = parseInt($(cells[6]).text().replace(/[,.]/g, '')) || 0;
        const frequency = parseInt($(cells[7])?.text()?.replace(/[,.]/g, '')) || 0;

        if (code && volume > 0 && /^[A-Z]+$/.test(code) && code.length >= 2) {
          stocks.push({
            code,
            date: new Date().toISOString().split('T')[0],
            open: 0,
            high,
            low,
            close,
            volume,
            value,
            frequency,
            foreign_buy: 0,
            foreign_sell: 0,
            listed_shares: 0,
            tradeable_shares: 0
          });
        }
      });
    });

    console.log(`[Scraper] Total ${stocks.length} saham aktif`);
    return stocks;

  } catch (error) {
    console.error('[Scraper] Error:', error);
    throw error;
  } finally {
    await browser.close();
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