// One-time/local bulk importer: data/Ringkasan Saham-YYYYMMDD.xlsx -> Historical DB.
// Safe to run repeatedly: each trade_date is replaced, never duplicated.
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { ingestSnapshot, normalizeDate } = require('./historicalDb');

function parseFile(filePath) {
  const filename = path.basename(filePath);
  const m = filename.match(/(\d{8})/);
  if (!m) return null;
  const date = normalizeDate(m[1]);
  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(sheet, { defval: 0 });
  const rows = raw.map(row => ({
    code:row['Kode Saham'], name:row['Nama Perusahaan'], remarks:row['Remarks'], previous_price:row['Sebelumnya'],
    open:row['Open Price'], first_trade:row['First Trade'], high:row['Tertinggi'], low:row['Terendah'], close:row['Penutupan'], change_price:row['Selisih'],
    volume:row['Volume'], value:row['Nilai'], frequency:row['Frekuensi'], index_individual:row['Index Individual'], offer:row['Offer'], offer_volume:row['Offer Volume'],
    bid:row['Bid'], bid_volume:row['Bid Volume'], listed_shares:row['Listed Shares'], tradeable_shares:row['Tradeble Shares'], weight_for_index:row['Weight For Index'],
    foreign_sell:row['Foreign Sell'], foreign_buy:row['Foreign Buy'], non_regular_volume:row['Non Regular Volume'], non_regular_value:row['Non Regular Value'], non_regular_frequency:row['Non Regular Frequency']
  }));
  return { filename, date, rows };
}

async function main() {
  const dataDir = path.join(__dirname, '../../data');
  const files = fs.readdirSync(dataDir).filter(f => /^Ringkasan Saham-\d{8}\.xlsx$/i.test(f)).sort();
  if (!files.length) throw new Error('Tidak ada Ringkasan Saham-YYYYMMDD.xlsx di data/');
  console.log(`[Import] ${files.length} Excel ditemukan`);
  for (const filename of files) {
    const item = parseFile(path.join(dataDir, filename));
    const result = await ingestSnapshot(item);
    console.log(`[Import] ${item.date}: ${result.rows} rows ← ${filename}`);
  }
  console.log('[Import] selesai');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { parseFile };
