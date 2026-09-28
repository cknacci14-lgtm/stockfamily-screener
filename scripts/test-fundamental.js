require('dotenv').config();
const https = require('https');
const API_KEY = process.env.ARJUM_API_KEY;

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'stock.arjum.com',
      path: path,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY, 'Accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
        catch { reject(new Error('Non-JSON: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  console.log('\n📊 Financial Statements BBCA:');
  const r1 = await get('/api/financial-statements/BBCA');
  console.log('Status:', r1.status);
  console.log(JSON.stringify(r1.json, null, 2).slice(0, 1500));
  
  console.log('\n📊 Market Cap:');
  const r2 = await get('/api/market-cap');
  console.log('Status:', r2.status);
  console.log(JSON.stringify(r2.json, null, 2).slice(0, 800));
}

test().catch(console.error);
