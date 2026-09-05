console.log('[Scraper] Hello World!');

export async function scrapeIDX() {
  console.log('[Scraper] Fungsi scrapeIDX dipanggil...');
  return [{ code: 'TEST', high: 1000, low: 900, close: 950, volume: 1000 }];
}

export async function runIDXScraper() {
  console.log('[Scraper] Memulai scraper...');
  const data = await scrapeIDX();
  console.log('Data:', data);
  console.log('[Scraper] Selesai!');
}

if (require.main === module) {
  runIDXScraper();
}