const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
require('dotenv').config();

// Gunakan stealth plugin untuk menghindari deteksi
puppeteer.use(StealthPlugin());

console.log('[Scraper] Memulai scraping IDX dengan stealth...');

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

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Set User-Agent real
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Tambahkan extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    });

    const url = process.env.IDX_BASE_URL || 'https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/ringkasan-saham/';
    console.log(`[Scraper] Mengakses: ${url}`);

    // Navigation dengan timeout panjang
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 60000 
    });

    // Tunggu sebentar agar halaman selesai render
    await page.waitForTimeout(5000);

    // Scroll ke bawah untuk memuat semua data
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(2000);

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

        // Coba deteksi header
        const firstText = $(cells[0]).text().trim();
        if (firstText.includes('Kode') || firstText.includes('Saham') || firstText === 'No') {
          return;
        }

        const code = $(cells[0]).text().trim();
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