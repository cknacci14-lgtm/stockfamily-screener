// src/run.js - VERSION 2.0 (dengan save JSON)
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs');
const { runScreener } = require('./screener');

console.log('[Runner] Memulai screener...');

function loadStocksFromExcel() {
  const dataDir = path.join(__dirname, '../data');
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('[Runner] Folder data/ dibuat. Taruh file Excel di sini.');
    return [];
  }

  const files = fs.readdirSync(dataDir);
  const excelFile = files.find(f => f.endsWith('.xlsx') && f.includes('Ringkasan Saham'));
  
  if (!excelFile) {
    console.error('[Runner] File Excel tidak ditemukan di folder data/');
    console.log('   Pastikan ada file dengan format: Ringkasan Saham-YYYYMMDD.xlsx');
    return [];
  }

  const filePath = path.join(dataDir, excelFile);
  console.log(`[Runner] Membaca file: ${excelFile}`);

  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet);

  return data
    .filter(row => {
      const volume = parseInt(row['Volume'] || row['volume'] || 0);
      return volume > 0;
    })
    .map(row => ({
      code: (row['Kode Saham'] || row['code'] || '').toString().trim(),
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
}

async function main() {
  try {
    const stocks = loadStocksFromExcel();
    if (stocks.length === 0) {
      console.log('[Runner] Tidak ada data saham.');
      return;
    }
    
    console.log(`[Runner] ${stocks.length} saham aktif`);

    // Sinkronkan ke data/database.json — sumber yang sama yang dibaca
    // server.js untuk /api/grandslams, supaya dashboard web ikut ter-update
    // setiap kali screener dijalankan dari CLI (sebelumnya 3 jalur data
    // ini terpisah dan bisa saling beda).
    const dbPath = path.join(__dirname, '../data/database.json');
    fs.writeFileSync(dbPath, JSON.stringify({
      lastUpdated: new Date().toISOString(),
      totalStocks: stocks.length,
      source: 'run.js (Excel manual)',
      stocks
    }, null, 2));

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

    // ===== SAVE KE JSON =====
    const resultsDir = path.join(__dirname, '../results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    const jsonPath = path.join(resultsDir, 'screener_results.json');
    
    // Ambil hanya grandSlams untuk dashboard
    const exportData = {
      summary: result.summary,
      grandSlams: result.grandSlams.map(s => ({
        code: s.code,
        close: s.close,
        volume: s.volume,
        powerScore: s.powerScore,
        pilarA: s.pilarA,
        pilarB: s.pilarB,
        pilarC: s.pilarC,
        breakdown: s.breakdown,
        reasons: s.reasons,
        risks: s.risks,
        isGrandSlam: s.isGrandSlam,
        recommendation: s.recommendation
      }))
    };
    
    fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
    console.log(`\n💾 Data disimpan ke: ${jsonPath}`);
    
  } catch (error) {
    console.error('[Runner] Error:', error);
  }
}

main();