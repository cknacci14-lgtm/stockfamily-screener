// GET /api/screener-top20
// Menjalankan fungsi SQL cn_screener() (screener peluang masuk top 20 liquid
// gainer besok) dan mengembalikan hasil untuk tanggal data terakhir.
//
// File ini lebih spesifik daripada functions/api/[[path]].js, jadi Cloudflare
// Pages memakai file ini untuk /api/screener-top20 tanpa menyentuh file besar itu.
// Kunci Supabase hanya dipakai di sisi server (variabel Pages yang sudah ada).

function json(body, status = 200, cache = 'public, max-age=300') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? cache : 'no-store'
    }
  });
}

export async function onRequestGet({ env }) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return json({ success: false, error: 'Supabase server configuration missing' }, 500);
  }

  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  };

  try {
    const [rpc, last] = await Promise.all([
      fetch(url + '/rest/v1/rpc/cn_screener', { method: 'POST', headers, body: '{}' }),
      fetch(
        url + '/rest/v1/daily_stock_data?select=trade_date&order=trade_date.desc&limit=1',
        { headers }
      )
    ]);

    if (!rpc.ok) {
      const t = await rpc.text();
      return json({ success: false, error: 'cn_screener gagal (' + rpc.status + '): ' + t.slice(0, 200) }, 502);
    }
    if (!last.ok) {
      return json({ success: false, error: 'Gagal membaca tanggal data terakhir (' + last.status + ')' }, 502);
    }

    const rows = await rpc.json();
    const lastRows = await last.json();
    const scanDate =
      (Array.isArray(lastRows) && lastRows[0] && lastRows[0].trade_date) ||
      (Array.isArray(rows) && rows[0] && rows[0].signal_date) ||
      null;

    const list = Array.isArray(rows) ? rows : [];
    return json({
      success: true,
      scan_date: scanDate,
      count_a: list.filter(r => r.lane === 'A').length,
      count_b: list.filter(r => r.lane === 'B').length,
      results: list
    });
  } catch (err) {
    return json({ success: false, error: String((err && err.message) || err).slice(0, 200) }, 500);
  }
}
