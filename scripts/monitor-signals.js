// ============================================================
// MONITOR SIGNALS ENGINE v3
// - Hanya jalan saat pasar IDX buka (WIB) dan data harus bertanggal hari ini
// - Entry/SL/TP memakai low/high harian, tapi HANYA jika signal/posisi sudah ada sebelum hari ini
// - Harga fill entry disimpan; rata-rata aktual dihitung dari harga fill
// - Semua level TP yang terlewati dicatat (outcome tidak bisa turun)
// - Update atomik: dua run berbarengan tidak menghasilkan notifikasi ganda
// Flag : --dry-run (tanpa tulis DB/Telegram), --force (lewati cek jam pasar & tanggal data)
// Env  : IDX_HOLIDAYS=2026-12-25,2026-12-31 (opsional, tanggal libur bursa)
// ============================================================

try {
  require('dotenv').config();
} catch (e) {
  // dotenv tidak terinstall (GitHub Actions) -> abaikan
}

const { notifySignalEvent } = require('./telegram-notifier.js');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ARJUM_KEY = (process.env.ARJUM_API_KEY || '').trim();
const HOLIDAYS = new Set((process.env.IDX_HOLIDAYS || '').split(',').map(s => s.trim()).filter(Boolean));

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const DEFAULT_PCT = [30, 30, 40];

// ============================================================
// WAKTU (WIB = UTC+7)
// ============================================================
function wibDate(d) {
  return new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
function todayWIB() {
  return wibDate(Date.now());
}
function isMarketWindow() {
  const w = new Date(Date.now() + 7 * 3600 * 1000);
  const day = w.getUTCDay();
  const mins = w.getUTCHours() * 60 + w.getUTCMinutes();
  if (day === 0 || day === 6) return false;
  if (HOLIDAYS.has(todayWIB())) return false;
  return mins >= 9 * 60 && mins <= 16 * 60 + 15; // 09:00 - 16:15 (termasuk harga penutupan)
}

// ============================================================
// SUPABASE REST HELPER
// ============================================================
async function sb(path, options = {}) {
  const url = SUPABASE_URL + '/rest/v1/' + path;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Supabase ' + res.status + ': ' + text.substring(0, 200));
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return null;
}

// ============================================================
// HARGA & DATA PASAR
// ============================================================
async function fetchJson(url, headers) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { headers: headers || {}, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchArjum(code) {
  if (!ARJUM_KEY) return null;
  const d = await fetchJson('https://stock.arjum.com/api/price/' + encodeURIComponent(code), {
    'X-API-Key': ARJUM_KEY,
    'Accept': 'application/json'
  });
  if (!d || !d.last_price) return null;
  return {
    price: Number(d.last_price),
    date: d.source_date ? String(d.source_date).slice(0, 10) : null,
    source: 'arjum'
  };
}

async function fetchYahoo(code) {
  const d = await fetchJson(
    'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(code) + '.JK?range=1d&interval=1d',
    { 'User-Agent': 'Mozilla/5.0' }
  );
  const r = d && d.chart && d.chart.result && d.chart.result[0];
  const m = r && r.meta;
  if (!m || !m.regularMarketPrice) return null;
  const q = r.indicators && r.indicators.quote && r.indicators.quote[0];
  const first = arr => (Array.isArray(arr) && arr.length && arr[0] != null) ? Number(arr[0]) : null;
  return {
    price: Number(m.regularMarketPrice),
    date: m.regularMarketTime ? wibDate(m.regularMarketTime * 1000) : null,
    high: m.regularMarketDayHigh != null ? Number(m.regularMarketDayHigh) : null,
    low: m.regularMarketDayLow != null ? Number(m.regularMarketDayLow) : null,
    open: q ? first(q.open) : null,
    source: 'yahoo'
  };
}

// Mengembalikan { ok, price, open, low, high, date, source } atau { ok:false, reason }
async function fetchMarketData(code) {
  const [a, y] = await Promise.all([fetchArjum(code), fetchYahoo(code)]);
  const today = todayWIB();
  const fresh = x => x && (FORCE || x.date === today);
  let base = null;
  if (fresh(a)) base = a;
  else if (fresh(y)) base = y;
  if (!base) {
    const any = a || y;
    return { ok: false, reason: any ? 'data basi (tanggal ' + (any.date || '?') + ')' : 'tidak ada harga' };
  }
  const yOk = y && fresh(y);
  return {
    ok: true,
    source: base.source,
    date: base.date || today,
    price: base.price,
    open: yOk ? y.open : null,
    low: yOk && y.low != null ? Math.min(y.low, base.price) : null,
    high: yOk && y.high != null ? Math.max(y.high, base.price) : null
  };
}

// ============================================================
// LOGIKA SIGNAL
// ============================================================
function entryFill(entryPrice, md, useRange) {
  // Tanpa data range: order limit langsung terisi di harga pasar bila sudah di bawah entry
  if (!useRange) return Math.min(entryPrice, md.price);
  // Dengan range: terisi di harga entry, kecuali gap-down (terisi di harga open)
  return (md.open != null && md.open < entryPrice) ? md.open : entryPrice;
}

// Mengembalikan null (tidak ada perubahan) atau { update, events:[{event, price, notify}] }
function checkSignalStatus(signal, md, nowIso) {
  if (signal.status !== 'PUBLISHED' && signal.status !== 'ACTIVE') return null;

  const today = todayWIB();
  const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
  const sl = num(signal.stop_loss);
  const tps = [num(signal.target_1), num(signal.target_2), num(signal.target_3)];
  const wasActive = signal.status === 'ACTIVE';
  const update = {};
  const events = [];

  // ---- ENTRY ----
  // low harian hanya dipakai bila signal sudah dipublish sebelum hari ini
  const published = signal.published_at ? wibDate(signal.published_at) : today;
  const entryRangeOk = published < today && md.low != null;
  const lowEntry = entryRangeOk ? md.low : md.price;

  const entries = [1, 2, 3].map(i => ({
    i,
    price: num(signal['entry_' + i]),
    pct: num(signal['entry_' + i + '_pct']) || DEFAULT_PCT[i - 1],
    hitAt: signal['entry_' + i + '_hit_at'] || null,
    fill: num(signal['entry_' + i + '_fill_price'])
  })).filter(e => e.price !== null);

  let newHits = 0;
  let lastFill = null;
  for (const e of entries) {
    if (!e.hitAt && lowEntry <= e.price) {
      e.hitAt = nowIso;
      e.fill = entryFill(e.price, md, entryRangeOk);
      lastFill = e.fill;
      update['entry_' + e.i + '_hit_at'] = nowIso;
      update['entry_' + e.i + '_fill_price'] = e.fill;
      newHits++;
    }
  }

  if (!wasActive && newHits === 0) return null; // PUBLISHED, belum ada entry kena

  if (newHits > 0) {
    const hit = entries.filter(e => e.hitAt);
    const w = hit.reduce((s, e) => s + e.pct, 0);
    const sum = hit.reduce((s, e) => s + (e.fill != null ? e.fill : e.price) * e.pct, 0);
    update.actual_entry_avg = w > 0 ? Math.round((sum / w) * 100) / 100 : null;
    if (!wasActive) {
      update.status = 'ACTIVE';
      update.entry_hit_at = nowIso;
    }
    events.push({ event: 'ENTRY_HIT', price: lastFill, notify: true });
  }

  // ---- EXIT (TP / SL) ----
  // low/high harian hanya dipakai bila posisi sudah aktif sejak sebelum hari ini
  const exitRangeOk = wasActive && md.low != null && md.high != null &&
    signal.entry_hit_at && wibDate(signal.entry_hit_at) < today;
  const lowExit = exitRangeOk ? md.low : md.price;
  const highExit = exitRangeOk ? md.high : md.price;

  const prevTp = signal.tp3_hit_at ? 3 : signal.tp2_hit_at ? 2 : signal.tp1_hit_at ? 1 : 0;
  let reached = 0;
  tps.forEach((t, k) => { if (t !== null && highExit >= t) reached = k + 1; });
  const slHit = sl !== null && !signal.sl_hit_at && lowExit <= sl;

  if (slHit) {
    // Jika SL dan TP sama-sama mungkin dalam satu range, SL didahulukan (konservatif)
    const slPrice = exitRangeOk
      ? ((md.open != null && md.open < sl) ? md.open : sl)
      : Math.min(sl, md.price);
    update.sl_hit_at = nowIso;
    update.outcome = prevTp > 0 ? 'TP' + prevTp : 'SL';
    update.status = 'CLOSED';
    update.closed_at = nowIso;
    events.push({ event: 'SL_HIT', price: slPrice, notify: true });
  } else if (reached > prevTp) {
    for (let k = prevTp + 1; k <= reached; k++) {
      if (!signal['tp' + k + '_hit_at']) update['tp' + k + '_hit_at'] = nowIso;
      events.push({ event: 'TP' + k + '_HIT', price: tps[k - 1], notify: k === reached });
    }
    update.outcome = 'TP' + reached;
    if (reached === 3) {
      update.status = 'CLOSED';
      update.closed_at = nowIso;
    }
  }

  return Object.keys(update).length ? { update, events } : null;
}

// PATCH atomik: hanya berhasil jika status & kolom *_hit_at masih seperti saat dibaca
async function patchSignal(signal, update) {
  const data = { ...update };
  const filters = ['status=eq.' + encodeURIComponent(signal.status)];
  Object.keys(update).forEach(k => { if (/_hit_at$/.test(k)) filters.push(k + '=is.null'); });
  const path = 'signals?id=eq.' + signal.id + '&' + filters.join('&');
  const attempt = d => sb(path, { method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(d) });
  try {
    return await attempt(data);
  } catch (err) {
    if (/fill_price/.test(err.message)) {
      console.log('  [WARN] kolom *_fill_price belum ada di tabel signals -> disimpan tanpa kolom itu (jalankan SQL migrasi).');
      Object.keys(data).forEach(k => { if (/_fill_price$/.test(k)) delete data[k]; });
      return await attempt(data);
    }
    throw err;
  }
}

// ============================================================
// MAIN
// ============================================================
const fmt = n => (n == null ? '-' : Number(n).toLocaleString('id-ID'));

async function main() {
  console.log('');
  console.log('============================================================');
  console.log(' SIGNAL MONITOR ENGINE v3' + (DRY_RUN ? ' [DRY RUN]' : '') + (FORCE ? ' [FORCE]' : ''));
  console.log('============================================================');
  console.log(' Started: ' + new Date().toISOString() + '  (WIB ' + todayWIB() + ')');
  console.log('');
  console.log('ENV CHECK:');
  console.log('  SUPABASE_URL  :', SUPABASE_URL ? 'SET (' + SUPABASE_URL.length + ' chars)' : 'MISSING');
  console.log('  SUPABASE_KEY  :', SUPABASE_KEY ? 'SET (' + SUPABASE_KEY.length + ' chars)' : 'MISSING');
  console.log('  ARJUM_API_KEY :', ARJUM_KEY ? 'SET (' + ARJUM_KEY.length + ' chars)' : 'MISSING (pakai Yahoo)');
  console.log('');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak diset!');
    process.exit(1);
  }

  if (!FORCE && !isMarketWindow()) {
    console.log('Pasar IDX tutup (di luar Senin-Jumat 09:00-16:15 WIB atau hari libur). Skip. Pakai --force untuk uji.');
    return;
  }

  console.log('[SIGNALS] Fetching signals (PUBLISHED/ACTIVE)...');
  const signals = await sb('signals?status=in.(PUBLISHED,ACTIVE)&select=*&order=id.asc');
  console.log('  Got: ' + signals.length + ' signal(s)');
  console.log('');
  if (!signals.length) {
    console.log('No active signals. Exit.');
    return;
  }

  const tickers = [...new Set(signals.map(s => s.ticker))];
  console.log('[PRICES] ' + tickers.join(', '));
  const mdMap = {};
  for (const code of tickers) {
    const md = await fetchMarketData(code);
    mdMap[code] = md;
    if (md.ok) {
      console.log('  ' + code + ' -> Rp ' + fmt(md.price) + ' (' + md.source + ', ' + md.date + ')' +
        (md.low != null ? ' L ' + fmt(md.low) + ' H ' + fmt(md.high) : ''));
    } else {
      console.log('  ' + code + ' -> SKIP: ' + md.reason);
    }
  }
  console.log('');

  const nowIso = new Date().toISOString();
  const changes = [];
  for (const signal of signals) {
    const md = mdMap[signal.ticker];
    if (!md || !md.ok) {
      console.log('SKIP  ' + signal.ticker + ' #' + signal.id + ' - ' + (md ? md.reason : 'tidak ada harga'));
      continue;
    }
    const res = checkSignalStatus(signal, md, nowIso);
    if (!res) {
      console.log('OK    ' + signal.ticker + ' #' + signal.id + ' [' + signal.status + '] - no change');
      continue;
    }
    console.log('HIT   ' + signal.ticker + ' #' + signal.id + ' - ' +
      res.events.map(e => e.event + ' @ ' + fmt(e.price)).join(', '));
    changes.push({ signal, update: res.update, events: res.events, source: md.source });
  }

  console.log('');
  console.log('[TOTAL] Perubahan: ' + changes.length);
  if (!changes.length) {
    console.log('Nothing to update.');
    return;
  }

  if (DRY_RUN) {
    console.log('');
    console.log('[DRY RUN] tidak menulis DB / Telegram. Rincian update:');
    for (const c of changes) {
      console.log('  #' + c.signal.id + ' ' + c.signal.ticker + ' ' + JSON.stringify(c.update));
    }
    return;
  }

  console.log('[SAVE] Applying updates...');
  for (const c of changes) {
    const label = '#' + c.signal.id + ' ' + c.signal.ticker;
    try {
      const rows = await patchSignal(c.signal, c.update);
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log('SKIP  ' + label + ' - sudah diperbarui run lain (tidak ada notifikasi ganda)');
        continue;
      }
      for (const ev of c.events) {
        try {
          await sb('signal_events', {
            method: 'POST',
            body: JSON.stringify({
              signal_id: c.signal.id,
              event_type: ev.event,
              price_at_event: ev.price,
              note: 'Auto-detected by monitor engine v3 (' + c.source + ')'
            })
          });
        } catch (err) {
          console.error('  event log gagal (' + ev.event + '): ' + err.message);
        }
        console.log('SAVED ' + label + ' - ' + ev.event);
        if (ev.notify) {
          try {
            const r = await notifySignalEvent(rows[0], ev.event, ev.price);
            console.log('  Telegram: ' + (r && r.success ? 'terkirim' : 'gagal (' + ((r && r.error) || 'unknown') + ')'));
          } catch (err) {
            console.log('  Telegram error: ' + err.message);
          }
        }
      }
    } catch (err) {
      console.error('FAIL  ' + label + ' - ' + err.message);
    }
  }

  console.log('');
  console.log('============================================================');
  console.log(' DONE');
  console.log('============================================================');
}

if (require.main === module) {
  main().catch(err => {
    console.error('FATAL:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { checkSignalStatus, entryFill };