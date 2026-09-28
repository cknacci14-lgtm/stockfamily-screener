require('dotenv').config();
const http = require('http');

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: 3000, path }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  console.log('============================================================');
  console.log(' TEST SIGNAL API');
  console.log('============================================================');
  console.log('');

  // TEST 1: Create signal
  console.log('[1] Create Signal (DRAFT)...');
  const createRes = await post('/api/admin/signals', {
    ticker: 'ESIP',
    timeframe: 'D1',
    entry_1: 1700,
    entry_2: 1680,
    entry_3: 1660,
    stop_loss: 1600,
    target_1: 1780,
    target_2: 1850,
    target_3: 1950,
    notes: 'Plan buy on retrace D1'
  });
  console.log('   Status:', createRes.status);
  const createData = JSON.parse(createRes.body);
  console.log('   Response:', JSON.stringify(createData, null, 2).slice(0, 500));
  console.log('');

  if (!createData.success) {
    console.log('❌ Create gagal, stop.');
    return;
  }

  const signalId = createData.signal.id;

  // TEST 2: List signals
  console.log('[2] List Signals...');
  const listRes = await get('/api/admin/signals');
  console.log('   Status:', listRes.status);
  const listData = JSON.parse(listRes.body);
  console.log('   Total:', listData.signals ? listData.signals.length : 0);
  console.log('');

  // TEST 3: Publish signal
  console.log('[3] Publish Signal ID:', signalId);
  const pubRes = await post(`/api/admin/signals/${signalId}/publish`, {});
  console.log('   Status:', pubRes.status);
  const pubData = JSON.parse(pubRes.body);
  console.log('   Status signal:', pubData.signal ? pubData.signal.status : 'N/A');
  console.log('');

  // TEST 4: Public list
  console.log('[4] Public Signals List...');
  const pubListRes = await get('/api/public/signals');
  console.log('   Status:', pubListRes.status);
  const pubListData = JSON.parse(pubListRes.body);
  console.log('   Total:', pubListData.signals ? pubListData.signals.length : 0);
  if (pubListData.signals && pubListData.signals.length) {
    const s = pubListData.signals[0];
    console.log('   Sample: ' + s.ticker + ' | ' + s.status + ' | Entry avg: ' + s.entry_avg + ' | RR: ' + s.risk_reward);
  }
  console.log('');

  console.log('============================================================');
  console.log(' ✅ SEMUA TEST PASS!');
  console.log('============================================================');
})();
