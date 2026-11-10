// GET /api/admin/cn-forward-test
// Ringkasan forward test screener top 20 gainer (tabel cn_screener_forward_log).
//
// File ini lebih spesifik daripada functions/api/[[path]].js, jadi penjaga admin
// di app Hono TIDAK berlaku di sini. Karena itu token dan peran admin diverifikasi
// sendiri, dengan logika yang sama seperti penjaga di [[path]].js.

const BACKTEST = { A_L1: 63, A_S2R: 47, B_L: 14 }; // persen, in-sample, sampel kecil

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// Selang kepercayaan Wilson 95% untuk proporsi (dalam persen).
function wilson(hit, n) {
  if (!n) return null;
  const z = 1.96, p = hit / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, ((c - m) / d) * 100), Math.min(100, ((c + m) / d) * 100)];
}

async function requireAdmin(request, env) {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: json({ success: false, error: 'Authentication required' }, 401) };
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: json({ success: false, error: 'Supabase server configuration missing' }, 500) };

  const u = await fetch(url + '/auth/v1/user', { headers: { Authorization: 'Bearer ' + match[1], apikey: key } });
  if (!u.ok) return { error: json({ success: false, error: 'Invalid or expired session' }, 401) };
  const user = await u.json();
  if (!user || !user.id) return { error: json({ success: false, error: 'Invalid or expired session' }, 401) };

  const p = await fetch(url + '/rest/v1/profiles?select=role&id=eq.' + encodeURIComponent(user.id), {
    headers: { apikey: key, Authorization: 'Bearer ' + key }
  });
  const profile = p.ok ? (await p.json())[0] : null;
  if (!profile || profile.role !== 'admin') {
    return { error: json({ success: false, error: 'Admin access required' }, 403) };
  }
  return { user };
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (auth.error) return auth.error;

    const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await fetch(
      url + '/rest/v1/cn_screener_forward_log' +
        '?select=signal_date,code,rule,lane,naik_pct,risiko_suspensi,target_date,masuk_top20_besok,suspensi_besok,ret_besok_pct,evaluated_at' +
        '&order=signal_date.desc&limit=5000',
      { headers: { apikey: key, Authorization: 'Bearer ' + key } }
    );
    if (!r.ok) {
      return json({ success: false, error: 'Gagal membaca log (' + r.status + ')' }, 502);
    }
    const rows = await r.json();
    const list = Array.isArray(rows) ? rows : [];

    const by = {};
    const days = new Set();
    for (const x of list) {
      days.add(x.signal_date);
      const b = (by[x.rule] = by[x.rule] || { rule: x.rule, lane: x.lane, dicatat: 0, n: 0, hit: 0, suspensi: 0, ret_sum: 0, ret_n: 0 });
      b.dicatat++;
      if (x.evaluated_at) {
        b.n++;
        if (x.masuk_top20_besok) b.hit++;
        if (x.suspensi_besok) b.suspensi++;
        if (x.ret_besok_pct != null) { b.ret_sum += Number(x.ret_besok_pct); b.ret_n++; }
      }
    }

    const summary = Object.keys(by).sort().map(k => {
      const b = by[k];
      const ci = wilson(b.hit, b.n);
      return {
        rule: b.rule,
        lane: b.lane,
        dicatat: b.dicatat,
        n: b.n,
        menunggu: b.dicatat - b.n,
        hit: b.hit,
        precision_pct: b.n ? +(100 * b.hit / b.n).toFixed(1) : null,
        ci_low: ci ? +ci[0].toFixed(1) : null,
        ci_high: ci ? +ci[1].toFixed(1) : null,
        backtest_pct: BACKTEST[b.rule] != null ? BACKTEST[b.rule] : null,
        suspensi: b.suspensi,
        avg_ret_pct: b.ret_n ? +(b.ret_sum / b.ret_n).toFixed(2) : null
      };
    });

    const dates = Array.from(days).sort();
    const lastDate = dates.length ? dates[dates.length - 1] : null;
    const latest = list.filter(x => x.signal_date === lastDate).map(x => ({
      code: x.code, rule: x.rule, naik_pct: x.naik_pct, risiko_suspensi: x.risiko_suspensi
    }));

    return json({
      success: true,
      data: { days: dates.length, first_date: dates[0] || null, last_log_date: lastDate, summary, latest }
    });
  } catch (err) {
    return json({ success: false, error: String((err && err.message) || err).slice(0, 200) }, 500);
  }
}
