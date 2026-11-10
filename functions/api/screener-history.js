// GET /api/screener-history
// Riwayat pick screener Top 20 Gainer untuk 15 hari bursa terakhir (fungsi SQL
// cn_screener_history), dengan hasil hari bursa berikutnya. Publik, seperti
// /api/screener-top20. Kunci Supabase hanya dipakai di sisi server.

function json(body, status = 200, cache = 'public, max-age=600') {
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
  try {
    const h = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ p_hari: 15 });
    const [res, dts] = await Promise.all([
      fetch(url + '/rest/v1/rpc/cn_screener_history', { method: 'POST', headers: h, body }),
      fetch(url + '/rest/v1/rpc/cn_riwayat_tanggal', { method: 'POST', headers: h, body })
    ]);
    if (!res.ok) {
      const t = await res.text();
      return json({ success: false, error: 'cn_screener_history gagal (' + res.status + '): ' + t.slice(0, 200) }, 502);
    }
    if (!dts.ok) {
      return json({ success: false, error: 'cn_riwayat_tanggal gagal (' + dts.status + ')' }, 502);
    }
    const rows = await res.json();
    const dates = await dts.json();
    return json({
      success: true,
      dates: Array.isArray(dates) ? dates : [],
      results: Array.isArray(rows) ? rows : []
    });
  } catch (err) {
    return json({ success: false, error: String((err && err.message) || err).slice(0, 200) }, 500);
  }
}
