require('dotenv').config();
const https = require('https');

const API_KEY = process.env.ARJUM_API_KEY;
const TEST_CODES = ['BBCA', 'BBRI', 'TLKM'];

function arjumGet(path) {
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
  console.log('=== TEST ARJUM API ===\n');
  
  for (const code of TEST_CODES) {
    console.log(`\n--- ${code} ---`);
    
    // Test 1: Price realtime
    try {
      const r1 = await arjumGet(`/api/price/${code}`);
      console.log(`[price/${code}] HTTP ${r1.status}`);
      console.log(JSON.stringify(r1.json, null, 2).slice(0, 600));
    } catch (e) {
      console.log(`[price/${code}] ERROR: ${e.message}`);
    }
    
    // Delay 500ms antar request
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Test done-details (order flow)
  console.log(`\n--- done-details ---`);
  try {
    const r = await arjumGet('/api/done-details');
    console.log(`HTTP ${r.status}`);
    console.log(JSON.stringify(r.json, null, 2).slice(0, 800));
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}

test().catch(console.error);
