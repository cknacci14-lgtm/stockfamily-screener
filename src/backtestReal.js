// src/backtestReal.js
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const { runScreener } = require('./screener');

console.log('📈 Memulai BACKTEST REAL (Multi-Hari)...');

// ============================================================
// 1. LOAD DATA HISTORIS (5 Hari)
// ============================================================
function loadAllHistoricalData() {
  const dataDir = path.join(__dirname, '../data');
  const files = fs.readdirSync(dataDir);
  const excelFiles = files.filter(f => f.endsWith('.xlsx') && f.includes('Ringkasan Saham'));
  
  if (excelFiles.length < 2) {
    console.error(`❌ Butuh minimal 2 file Excel. Saat ini hanya ${excelFiles.length} file.`);
    console.log('📥 Download data IDX 5 hari berturut-turut dan taruh di folder data/');
    process.exit(1);
  }

  // Urutkan berdasarkan tanggal (asumsi format: Ringkasan Saham-YYYYMMDD.xlsx)
  excelFiles.sort();

  console.log(`📂 Ditemukan ${excelFiles.length} file Excel:`);
  excelFiles.forEach(f => console.log(`   - ${f}`));

  const allData = {};

  excelFiles.forEach(file => {
    const filePath = path.join(dataDir, file);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    // Ambil tanggal dari nama file
    const dateMatch = file.match(/(\d{8})/);
    const date = dateMatch ? dateMatch[1] : file;

    // Konversi ke map berdasarkan kode saham
    const stockMap = {};
    data.forEach(row => {
      const code = (row['Kode Saham'] || '').toString().trim();
      if (code && /^[A-Z]+$/.test(code)) {
        stockMap[code] = {
          code,
          date,
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
        };
      }
    });

    allData[date] = stockMap;
  });

  return allData;
}

// ============================================================
// 2. BACKTEST ENGINE
// ============================================================
function runRealBacktest() {
  const allData = loadAllHistoricalData();
  const dates = Object.keys(allData).sort();
  
  console.log(`\n📊 Backtest dari ${dates[0]} sampai ${dates[dates.length - 1]}`);
  console.log('='.repeat(60));

  const results = [];

  // Loop setiap hari (kecuali hari terakhir, karena butuh data besok)
  for (let i = 0; i < dates.length - 1; i++) {
    const today = dates[i];
    const tomorrow = dates[i + 1];
    
    console.log(`\n📅 Screening: ${today} → Prediksi untuk ${tomorrow}`);

    // Ambil data hari ini
    const todayData = allData[today];
    const stocks = Object.values(todayData).filter(s => s.volume > 0);

    // Jalankan screener hari ini
    const screenerResult = runScreener(stocks);
    const grandSlams = screenerResult.grandSlams;

    if (grandSlams.length === 0) {
      console.log(`   Tidak ada Grand Slam di ${today}`);
      continue;
    }

    console.log(`   Grand Slam: ${grandSlams.length} saham`);

    // Hitung return besok untuk setiap Grand Slam
    const tomorrowData = allData[tomorrow];
    let dailyReturn = 0;
    let winCount = 0;

    grandSlams.forEach(s => {
      const tomorrowStock = tomorrowData[s.code];
      if (tomorrowStock && tomorrowStock.close > 0) {
        const returnPct = ((tomorrowStock.close - s.close) / s.close) * 100;
        dailyReturn += returnPct;
        if (returnPct > 0) winCount++;
        
        // Log detail
        console.log(`   ${s.code}: ${s.close} → ${tomorrowStock.close} (${returnPct.toFixed(2)}%)`);
      }
    });

    const avgReturn = dailyReturn / grandSlams.length;
    const winRate = (winCount / grandSlams.length) * 100;

    results.push({
      date: today,
      grandSlams: grandSlams.length,
      avgReturn: avgReturn,
      winRate: winRate,
      winCount: winCount
    });

    console.log(`   📊 Avg Return: ${avgReturn.toFixed(2)}% | Win Rate: ${winRate.toFixed(0)}%`);
  }

  // ============================================================
  // 3. STATISTIK AKHIR
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('📈 HASIL BACKTEST REAL:');
  
  if (results.length === 0) {
    console.log('❌ Tidak ada data untuk backtest.');
    return;
  }

  const totalReturns = results.reduce((sum, r) => sum + r.avgReturn, 0);
  const avgAllReturn = totalReturns / results.length;
  const avgWinRate = results.reduce((sum, r) => sum + r.winRate, 0) / results.length;

  console.log(`Total Hari Screening: ${results.length}`);
  console.log(`Rata-rata Return per Hari: ${avgAllReturn.toFixed(2)}%`);
  console.log(`Rata-rata Win Rate: ${avgWinRate.toFixed(1)}%`);
  console.log(`Total Return Kumulatif: ${totalReturns.toFixed(2)}%`);

  // Bandingkan dengan IHSG (asumsi 0.1% per hari)
  const ihsgReturn = results.length * 0.1;
  console.log(`\n📊 VS IHSG (asumsi 0.1%/hari):`);
  console.log(`Grand Slam Return: ${totalReturns.toFixed(2)}%`);
  console.log(`IHSG Return: ${ihsgReturn.toFixed(2)}%`);
  console.log(`Alpha: ${(totalReturns - ihsgReturn).toFixed(2)}%`);

  // Simpan hasil
  const resultDir = path.join(__dirname, '../results');
  if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir);
  }
  const resultPath = path.join(resultDir, `backtest_real_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(resultPath, JSON.stringify({
    dates: dates,
    results: results,
    summary: {
      totalDays: results.length,
      avgReturn: avgAllReturn,
      avgWinRate: avgWinRate,
      totalReturn: totalReturns,
      alpha: totalReturns - ihsgReturn
    }
  }, null, 2));
  
  console.log(`\n💾 Hasil disimpan di: ${resultPath}`);
}

// Jalankan
runRealBacktest();