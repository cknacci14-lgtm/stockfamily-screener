// src/notifier.js - Versi dengan Axios (Tanpa Library Telegram)
const axios = require('axios');
const { runScreener } = require('./screener');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ============================================================
// 1. KONFIGURASI
// ============================================================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'your_telegram_bot_token') {
  console.error('[Notifier] ❌ TELEGRAM_TOKEN tidak ditemukan di .env');
  console.log('   Tambahkan: TELEGRAM_TOKEN=your_bot_token');
  process.exit(1);
}

if (!TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === 'your_telegram_chat_id') {
  console.error('[Notifier] ❌ TELEGRAM_CHAT_ID tidak ditemukan di .env');
  console.log('   Tambahkan: TELEGRAM_CHAT_ID=your_chat_id');
  process.exit(1);
}

// ============================================================
// 2. FUNGSI KIRIM PESAN TELEGRAM (Dengan Axios)
// ============================================================
async function sendTelegramMessage(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    });
    return response.data;
  } catch (error) {
    console.error('[Notifier] ❌ Gagal kirim pesan:', error.response?.data || error.message);
    throw error;
  }
}

// ============================================================
// 3. FUNGSI LOAD DATA
// ============================================================
function loadStocks() {
  const dataDir = path.join(__dirname, '../data');
  
  if (!fs.existsSync(dataDir)) {
    console.error('[Notifier] Folder data/ tidak ditemukan');
    return [];
  }

  const files = fs.readdirSync(dataDir);
  
  let excelFile = files.find(f => f.endsWith('.xlsx') && f.includes('Ringkasan Saham'));
  if (!excelFile) {
    excelFile = files.find(f => f.startsWith('auto_daily_') && f.endsWith('.json'));
  }
  
  if (!excelFile) {
    console.error('[Notifier] Tidak ada file data (Excel atau JSON) di folder data/');
    return [];
  }

  const filePath = path.join(dataDir, excelFile);
  console.log(`[Notifier] Membaca file: ${excelFile}`);

  let stocks = [];

  if (excelFile.endsWith('.xlsx')) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    stocks = data
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
  } else {
    const rawData = fs.readFileSync(filePath, 'utf8');
    stocks = JSON.parse(rawData);
  }

  console.log(`[Notifier] ${stocks.length} saham aktif`);
  return stocks;
}

// ============================================================
// 4. FUNGSI UTAMA
// ============================================================
async function sendGrandSlamNotification() {
  try {
    console.log('[Notifier] Memeriksa Grand Slam...');
    
    const stocks = loadStocks();
    if (stocks.length === 0) {
      console.log('[Notifier] Tidak ada data saham.');
      return;
    }
    
    const result = await runScreener(stocks);
    
    if (result.grandSlams.length === 0) {
      console.log('[Notifier] Tidak ada Grand Slam hari ini.');
      return;
    }

    let message = `🏆 *GRAND SLAM ALERT!*\n`;
    message += `📅 ${new Date().toISOString().split('T')[0]}\n`;
    message += `📊 Total Grand Slam: ${result.grandSlams.length}\n\n`;
    message += `*Top 5 Grand Slam:*\n`;

    result.grandSlams.slice(0, 5).forEach((s, i) => {
      message += `${i+1}. *${s.code}* | Power: ${s.powerScore} | A:${s.pilarA} B:${s.pilarB} C:${s.pilarC}\n`;
      message += `   Harga: ${s.close} | Vol: ${s.volume.toLocaleString()}\n`;
    });

    message += `\n🔗 Lihat detail: http://localhost:3000`;

    await sendTelegramMessage(message);
    console.log('[Notifier] ✅ Notifikasi terkirim!');

    // Simpan log
    const logDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, `notification_${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(logPath, JSON.stringify({
      date: new Date().toISOString(),
      grandSlams: result.grandSlams.map(s => ({
        code: s.code,
        powerScore: s.powerScore,
        pilarA: s.pilarA,
        pilarB: s.pilarB,
        pilarC: s.pilarC,
        price: s.close,
        volume: s.volume
      }))
    }, null, 2));

  } catch (error) {
    console.error('[Notifier] ❌ Error:', error.message);
  }
}

// ============================================================
// 5. EKSEKUSI
// ============================================================
sendGrandSlamNotification();