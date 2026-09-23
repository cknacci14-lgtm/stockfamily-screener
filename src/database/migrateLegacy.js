// One-time migration helper: data/database.json -> historical repository.
const fs = require('fs');
const path = require('path');
const { ingestSnapshot, normalizeDate } = require('./historicalDb');

async function main() {
  const p = path.join(__dirname, '../../data/database.json');
  if (!fs.existsSync(p)) throw new Error(`Legacy DB tidak ditemukan: ${p}`);
  const db = JSON.parse(fs.readFileSync(p, 'utf8'));
  const grouped = {};
  for (const row of (db.stocks || [])) {
    const date = normalizeDate(row.date);
    if (!date) continue;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(row);
  }
  const dates = Object.keys(grouped).sort();
  console.log(`[Migration] ${dates.length} tanggal, ${db.stocks?.length || 0} records legacy`);
  for (const date of dates) {
    const result = await ingestSnapshot({ date, filename: `legacy-database-${date.replaceAll('-','')}.json`, rows: grouped[date] });
    console.log(`[Migration] ${date}: ${result.rows} rows`);
  }
  console.log('[Migration] selesai');
}

main().catch(err => { console.error(err); process.exit(1); });
