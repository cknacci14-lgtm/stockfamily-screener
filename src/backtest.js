// src/backtest.js
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const { runScreener } = require('./screener');

console.log('📈 Memulai Backtesting...');

// ============================================================
// 1. LOAD DATA HISTORIS (Asumsikan kita punya 5 hari data)
// ============================================================
function loadHistoricalData() {
  const dataDir = path.join(__dirname, '../data');
  const files = fs.readdirSync(dataDir);
  const excelFiles = files.filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
  
  if (excelFiles.length === 0) {
    throw new Error('Tidak ada file Excel di folder data/');
  }

  // Ambil file terbaru
  const latestFile = excelFiles.sort().reverse()[0];
  const filePath = path.join(dataDir, latestFile);
  console.log(`[Backtest] Membaca file: ${latestFile}`);

  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet);

  return data;
}

// ============================================================
// 2. FUNGSI UTAMA BACKTEST
// ============================================================
function runBacktest() {
  try {
    // Load data
    const rawData = loadHistoricalData();
    
    // Konversi ke format saham
    const stocks = rawData
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

    console.log(`[Backtest] Total saham: ${stocks.length}`);

    // Jalankan screener
    const result = runScreener(stocks);
    
    // ============================================================
    // 3. SIMULASI PERFORMANCE (HOLD 5 HARI)
    // ============================================================
    // Catatan: Untuk backtest real, kita butuh data 5 hari ke depan.
    // Untuk sekarang, kita simulasi dengan asumsi:
    // - Return 5 hari = (harga sekarang / harga 5 hari lalu) - 1
    // Karena kita tidak punya data historis, kita gunakan proxy:
    // - Return = (close - open) / open (simulasi 1 hari)
    
    console.log('\n📊 BACKTEST RESULT:');
    console.log('='.repeat(50));
    
    const grandSlams = result.grandSlams;
    
    if (grandSlams.length === 0) {
      console.log('Tidak ada Grand Slam untuk di-backtest.');
      return;
    }

    // Simulasi return 1 hari
    let totalReturn = 0;
    let winCount = 0;
    const details = [];

    grandSlams.forEach((s, i) => {
      const open = s.open || s.close;
      const close = s.close;
      const returnPct = open > 0 ? ((close - open) / open * 100) : 0;
      const isWin = returnPct > 0;
      
      totalReturn += returnPct;
      if (isWin) winCount++;
      
      details.push({
        rank: i + 1,
        code: s.code,
        price: close,
        return: returnPct.toFixed(2) + '%',
        win: isWin ? '✅' : '❌'
      });
    });

    // Tampilkan detail
    console.table(details);

    // Statistik
    const avgReturn = totalReturn / grandSlams.length;
    const winRate = (winCount / grandSlams.length * 100).toFixed(1);
    
    console.log('\n📈 STATISTIK:');
    console.log(`Total Grand Slam: ${grandSlams.length}`);
    console.log(`Win Rate: ${winRate}%`);
    console.log(`Average Return: ${avgReturn.toFixed(2)}%`);
    console.log(`Total Return: ${totalReturn.toFixed(2)}%`);
    
    // Simulasi benchmark IHSG (asumsi 0.5% per hari)
    const ihsgReturn = 0.5 * grandSlams.length;
    console.log(`\n📊 VS IHSG (asumsi 0.5%/hari):`);
    console.log(`Grand Slam Return: ${totalReturn.toFixed(2)}%`);
    console.log(`IHSG Return: ${ihsgReturn.toFixed(2)}%`);
    console.log(`Alpha: ${(totalReturn - ihsgReturn).toFixed(2)}%`);

    // Simpan hasil
    const resultDir = path.join(__dirname, '../results');
    if (!fs.existsSync(resultDir)) {
      fs.mkdirSync(resultDir);
    }
    
    const resultPath = path.join(resultDir, `backtest_${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(resultPath, JSON.stringify({
      date: new Date().toISOString(),
      summary: result.summary,
      grandSlams: grandSlams.map(s => ({
        code: s.code,
        price: s.close,
        powerScore: s.powerScore,
        pilarA: s.pilarA,
        pilarB: s.pilarB,
        pilarC: s.pilarC
      })),
      performance: {
        winRate: winRate,
        avgReturn: avgReturn,
        totalReturn: totalReturn,
        alpha: totalReturn - ihsgReturn
      }
    }, null, 2));
    
    console.log(`\n💾 Hasil backtest disimpan di: ${resultPath}`);

  } catch (error) {
    console.error('[Backtest Error]', error);
  }
}

// Jalankan
runBacktest();