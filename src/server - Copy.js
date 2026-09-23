// src/server.js - FINAL MERGED - WORKING
const express = require('express');
const path = require('path');
const { runScreener } = require('./screener');
const xlsx = require('xlsx');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

console.log('=== LOADING ENGINES ===');
let backtestEngine = null;
try{
  backtestEngine = require('./engine/backtestEngine');
  console.log('✅ Backtest Engine loaded');
}catch(e){
  console.error('❌ Backtest Engine FAILED:', e.message);
}

// TEST
app.get('/api/test', (req,res)=> res.json({ok:true, engine: !!backtestEngine, time: new Date().toISOString()}));

// BACKTEST - 600 DAYS
app.get('/api/backtest/dates', async (req,res)=>{
  console.log('HIT /api/backtest/dates');
  try{
    if(!backtestEngine || !backtestEngine.getAvailableDates) return res.json({dates: []});
    const dates = await backtestEngine.getAvailableDates();
    res.json({dates, count: dates.length});
  }catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

app.get('/api/backtest', async (req,res)=>{
  console.log('HIT /api/backtest date=', req.query.date);
  try{
    if(!backtestEngine) return res.status(500).json({error:'engine not loaded'});
    const results = await backtestEngine.runBacktest(req.query.date||null);
    let stats={total:results.length,avg1:0,avg2:0,avg3:0,winrate:0};
    if(results.length>0){
      let a=0,b=0,c=0,w=0;
      results.forEach(r=>{a+=r.d1_pct||0; b+=r.d2_pct||0; c+=r.d3_pct||0; if((r.max3_pct||0)>3) w++;});
      stats.avg1=a/results.length; stats.avg2=b/results.length; stats.avg3=c/results.length; stats.winrate=w/results.length*100;
    }
    res.json({date: req.query.date||'latest', stats, results});
  }catch(e){ console.error(e); res.status(500).json({error:e.message, stack:e.stack}); }
});

// GRANDSLAMS - ORIGINAL
app.get('/api/grandslams', async (req, res) => {
  try {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const files = fs.readdirSync(dataDir);
    const excelFile = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    if (!excelFile) return res.status(404).json({ error: 'File Excel tidak ditemukan di folder data/' });
    const filePath = path.join(dataDir, excelFile);
    console.log(`[Server] Membaca file: ${excelFile}`);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);
    const stocks = data.filter(row=>parseInt(row['Volume']||row['volume']||0)>0)
      .map(row=>({
        code: (row['Kode Saham']||row['code']||'').toString().trim(),
        open: parseFloat(row['Open Price']||row['openPrice']||row['Open']||0),
        high: parseFloat(row['Tertinggi']||row['High']||row['high']||0),
        low: parseFloat(row['Terendah']||row['Low']||row['low']||0),
        close: parseFloat(row['Penutupan']||row['Close']||row['close']||0),
        volume: parseInt(row['Volume']||row['volume']||0),
        value: parseFloat(row['Nilai']||row['Value']||row['value']||0),
        frequency: parseInt(row['Frekuensi']||row['Frequency']||row['frequency']||0),
        foreign_buy: parseInt(row['Foreign Buy']||row['foreignBuy']||0),
        foreign_sell: parseInt(row['Foreign Sell']||row['foreignSell']||0),
        listed_shares: parseFloat(row['Listed Shares']||0),
        tradeable_shares: parseFloat(row['Tradeble Shares']||0)
      })).filter(item=>item.code && /^[A-Z]+$/.test(item.code) && item.code.length>=2);
    console.log(`[Server] ${stocks.length} saham aktif`);
    const result = runScreener(stocks);
    res.json({success:true,timestamp:new Date().toISOString(),summary:result.summary,grandSlams:result.grandSlams.slice(0,10)});
  } catch (error) {
    console.error('[Server Error]', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.listen(PORT, () => {
  console.log(`🚀 Server FINAL running at http://localhost:${PORT}`);
  console.log(`📊 Grandslam: http://localhost:${PORT}/api/grandslams`);
  console.log(`📅 Backtest dates: http://localhost:${PORT}/api/backtest/dates`);
  console.log(`📈 Backtest: http://localhost:${PORT}/backtest.html`);
});
