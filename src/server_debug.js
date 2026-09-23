// DEBUG - copy paste this as src/server.js total
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

console.log('=== LOADING BACKTEST ENGINE ===');
let engine;
try{
  engine = require('./engine/backtestEngine');
  console.log('Engine loaded OK, has getAvailableDates:', !!engine.getAvailableDates);
}catch(e){
  console.error('Engine load FAILED:', e.message);
  console.error(e.stack);
  engine = null;
}

// TEST ROUTE - HARUS BISA
app.get('/api/test', (req,res)=>{ res.json({ok:true, time:new Date().toISOString(), engine: !!engine}); });

app.get('/api/backtest/dates', async (req,res)=>{
  console.log('HIT /api/backtest/dates');
  try{
    if(!engine) return res.status(500).json({error:'engine not loaded'});
    const dates = await engine.getAvailableDates();
    res.json({dates, count: dates.length});
  }catch(e){
    console.error(e);
    res.status(500).json({error:e.message});
  }
});

app.get('/api/backtest', async (req,res)=>{
  console.log('HIT /api/backtest date=', req.query.date);
  try{
    if(!engine) return res.status(500).json({error:'engine not loaded'});
    const results = await engine.runBacktest(req.query.date||null);
    res.json({date:req.query.date, count: results.length, results});
  }catch(e){
    console.error(e);
    res.status(500).json({error:e.message});
  }
});

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'../public/index.html')));

app.listen(PORT, ()=>{ console.log('🚀 Server DEBUG at http://localhost:'+PORT); console.log('Test: http://localhost:'+PORT+'/api/test'); });
