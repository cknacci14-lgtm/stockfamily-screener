// Pencatat forward test: (1) screener Top 20 Gainer, (2) Watchlist Harian.
// Jalankan SETELAH data harian masuk ke daily_stock_data:
//   $env:SUPABASE_URL = "https://xxxx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "..."
//   node scripts/cn-forward-log.js
//
// Yang dilakukan: mencatat sinyal tanggal data terakhir, mengevaluasi sinyal lama yang
// hari berikutnya sudah tersedia, lalu mencetak ringkasan. Kegagalan satu bagian tidak
// menghentikan bagian lain, tetapi proses tetap berakhir dengan kode 1.

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

async function rpc(name) {
  const run = await fetch(url + '/rest/v1/rpc/' + name, { method: 'POST', headers, body: '{}' });
  if (!run.ok) {
    throw new Error(name + ' gagal (' + run.status + '): ' + (await run.text()).slice(0, 300));
  }
  const r = await run.json();
  return Array.isArray(r) ? r[0] : r;
}

async function summarize(title, table, ruleField, retField) {
  const res = await fetch(
    url + '/rest/v1/' + table + '?select=' + ruleField + ',masuk_top20_besok,suspensi_besok,' + retField +
      '&evaluated_at=not.is.null&limit=10000',
    { headers }
  );
  if (!res.ok) throw new Error('Gagal membaca ringkasan ' + table + ' (' + res.status + ')');
  const rows = await res.json();
  const by = {};
  for (const x of rows) {
    const b = (by[x[ruleField]] = by[x[ruleField]] || { n: 0, hit: 0, susp: 0, ret: 0, retN: 0 });
    b.n++;
    if (x.masuk_top20_besok) b.hit++;
    if (x.suspensi_besok) b.susp++;
    if (x[retField] != null) { b.ret += Number(x[retField]); b.retN++; }
  }
  const names = Object.keys(by).sort();
  if (!names.length) {
    console.log(title + ': belum ada sinyal yang selesai dievaluasi.');
    return;
  }
  console.log('\n' + title + ' (semua pick, suspensi dihitung gagal):');
  for (const k of names) {
    const b = by[k];
    console.log(
      String(k).padEnd(6),
      'n=' + b.n,
      'hit=' + b.hit,
      'presisi=' + ((100 * b.hit) / b.n).toFixed(1) + '%',
      'suspensi=' + b.susp,
      'rata-rata ret besok=' + (b.retN ? (b.ret / b.retN).toFixed(2) : '-') + '%'
    );
  }
}

async function section(label, fn, ok) {
  try {
    await fn();
  } catch (e) {
    console.error('[' + label + '] ' + (e.message || e));
    ok.value = false;
  }
}

async function main() {
  const ok = { value: true };

  await section('top20', async () => {
    const row = await rpc('cn_forward_log_run');
    console.log('Top 20 Gainer | Dicatat:', row && row.dicatat, '| Dievaluasi:', row && row.dievaluasi);
    await summarize('Ringkasan Top 20 Gainer', 'cn_screener_forward_log', 'rule', 'ret_besok_pct');
  }, ok);

  await section('watchlist', async () => {
    const row = await rpc('cn_watch_forward_run');
    console.log('Watchlist     | Dicatat:', row && row.dicatat, '| Dievaluasi:', row && row.dievaluasi);
    await summarize('Ringkasan Watchlist', 'cn_watch_forward_log', 'aturan', 'ret_besok_pct');
  }, ok);

  if (!ok.value) process.exit(1);
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
