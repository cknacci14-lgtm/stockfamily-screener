// Pencatat forward test screener top 20 gainer.
// Jalankan SETELAH data harian masuk ke daily_stock_data:
//   $env:SUPABASE_URL = "https://xxxx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "..."
//   node scripts/cn-forward-log.js
//
// Yang dilakukan: (1) mencatat sinyal tanggal data terakhir, (2) mengevaluasi
// sinyal lama yang hari berikutnya sudah tersedia, (3) mencetak ringkasan.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diisi (variabel lingkungan).');
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: 'Bearer ' + key,
  'Content-Type': 'application/json'
};

async function main() {
  const run = await fetch(url + '/rest/v1/rpc/cn_forward_log_run', {
    method: 'POST',
    headers,
    body: '{}'
  });
  if (!run.ok) {
    throw new Error('cn_forward_log_run gagal (' + run.status + '): ' + (await run.text()).slice(0, 300));
  }
  const r = await run.json();
  const row = Array.isArray(r) ? r[0] : r;
  console.log('Dicatat:', row && row.dicatat, '| Dievaluasi:', row && row.dievaluasi);

  const res = await fetch(
    url + '/rest/v1/cn_screener_forward_log?select=rule,masuk_top20_besok,suspensi_besok,ret_besok_pct&evaluated_at=not.is.null&limit=10000',
    { headers }
  );
  if (!res.ok) {
    throw new Error('Gagal membaca ringkasan (' + res.status + ')');
  }
  const rows = await res.json();
  const by = {};
  for (const x of rows) {
    const b = (by[x.rule] = by[x.rule] || { n: 0, hit: 0, susp: 0, ret: 0, retN: 0 });
    b.n++;
    if (x.masuk_top20_besok) b.hit++;
    if (x.suspensi_besok) b.susp++;
    if (x.ret_besok_pct != null) {
      b.ret += Number(x.ret_besok_pct);
      b.retN++;
    }
  }
  const names = Object.keys(by).sort();
  if (!names.length) {
    console.log('Belum ada sinyal yang selesai dievaluasi.');
    return;
  }
  console.log('\nRingkasan forward test (semua pick, suspensi dihitung gagal):');
  for (const k of names) {
    const b = by[k];
    console.log(
      k.padEnd(6),
      'n=' + b.n,
      'hit=' + b.hit,
      'presisi=' + ((100 * b.hit) / b.n).toFixed(1) + '%',
      'suspensi=' + b.susp,
      'rata-rata ret besok=' + (b.retN ? (b.ret / b.retN).toFixed(2) : '-') + '%'
    );
  }
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
