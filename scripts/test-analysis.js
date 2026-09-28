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
        catch { reject(new Error('Non-JSON')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  console.log('=== ANALISIS KOMPREHENSIF BBCA ===\n');
  try {
    const r = await get('/api/analysis/BBCA');
    console.log('Status:', r.status);
    console.log(JSON.stringify(r.json, null, 2).slice(0, 2500));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

test().catch(console.error);
