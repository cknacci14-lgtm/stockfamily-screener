// src/server.js
const express = require('express');
const path = require('path');
const { runScreener } = require('./screener');
const xlsx = require('xlsx');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// API: Get Grand Slam results
app.get('/api/grandslams', async (req, res) => {
  try {
    // Baca data dari Excel
    const dataDir = path.join(__dirname, '../data');
    
    // Buat folder data jika belum ada
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const files = fs.readdirSync(dataDir);
    const excelFile = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    
    if (!excelFile) {
      return res.status(404).json({ 
        error: 'File Excel tidak ditemukan. Taruh file Excel di folder data/' 
      });
    }

    const filePath = path.join(dataDir, excelFile);
    console.log(`[Server] Membaca file: ${excelFile}`);

    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    console.log(`[Server] Ditemukan ${data.length} baris data`);

    const stocks = data
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

    console.log(`[Server] ${stocks.length} saham aktif`);

    // Jalankan screener
    const result = runScreener(stocks);
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: result.summary,
      grandSlams: result.grandSlams.slice(0, 10)
    });

  } catch (error) {
    console.error('[Server Error]', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📊 Buka browser dan akses: http://localhost:${PORT}`);
});