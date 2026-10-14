// ============================================================
// TELEGRAM NOTIFIER (pesan ringkas + tombol ke web)
// Format:
//   PUBLISHED : 🆕 GRPH Signal Buy (D1) / catatan singkat      [Lihat Signal]
//   ENTRY_HIT : 🟢 GRPH sekarang ACTIVE / Signal Buy GRPH aktif di Entry 1 (Rp 79)
//   TPn_HIT   : 🎯 GRPH kena Target 1 / Signal GRPH mencapai Target 1 (+45.2%)
//   SL_HIT    : 🔴 GRPH kena Stop / Signal GRPH tersentuh invalidation/stop level (Rp 62)
// Env opsional: SIGNALS_URL (default https://chartnalis.web.id/signals)
// ============================================================

const TELEGRAM_TOKEN = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const SIGNALS_URL = (process.env.SIGNALS_URL || 'https://chartnalis.web.id/signals').trim();
const NOTE_MAX = 80;

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatRp(n) {
  if (n == null || isNaN(n)) return '—';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function formatPct(n) {
  const sign = n >= 0 ? '+' : '';
  return sign + Number(n).toFixed(1).replace('.', ',') + '%';
}

function shortNote(notes) {
  const t = String(notes || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > NOTE_MAX ? t.slice(0, NOTE_MAX - 1).trimEnd() + '…' : t;
}

// Rata-rata entry yang dipakai untuk P/L: aktual bila ada, kalau tidak rencana
function entryBase(signal) {
  const a = Number(signal.actual_entry_avg);
  if (a > 0) return a;
  const p = Number(signal.entry_avg);
  return p > 0 ? p : null;
}

// Entry yang kena pada run terakhir = hit_at paling baru (bisa lebih dari satu sekaligus)
function latestEntryNumbers(signal) {
  const hits = [1, 2, 3]
    .map(i => ({ i, t: signal['entry_' + i + '_hit_at'] }))
    .filter(h => h.t);
  if (!hits.length) return [];
  const newest = hits.reduce((m, h) => (new Date(h.t) > new Date(m) ? h.t : m), hits[0].t);
  return hits.filter(h => new Date(h.t).getTime() === new Date(newest).getTime()).map(h => h.i);
}

function buildMessage(signal, event, price) {
  const ticker = esc(signal.ticker || '—');
  const tf = esc(signal.timeframe || 'D1');
  const priceNum = Number(price);
  const lines = [];

  if (event === 'PUBLISHED') {
    lines.push('🆕 <b>' + ticker + '</b> Signal Buy (' + tf + ')');
    const n = shortNote(signal.notes);
    if (n) lines.push('<i>' + esc(n) + '</i>');
  } else if (event === 'ENTRY_HIT') {
    const nums = latestEntryNumbers(signal);
    const label = nums.length > 1 ? 'Entry ' + nums.join(' & ') : 'Entry ' + (nums[0] || 1);
    lines.push('🟢 <b>' + ticker + ' sekarang ACTIVE</b>');
    lines.push('Signal Buy ' + ticker + ' aktif di ' + label + (priceNum ? ' (' + formatRp(priceNum) + ')' : ''));
  } else if (/^TP[123]_HIT$/.test(event)) {
    const k = event.charAt(2);
    const base = entryBase(signal);
    const tgt = priceNum || Number(signal['target_' + k]);
    const pct = base && tgt ? ((tgt - base) / base) * 100 : null;
    lines.push('🎯 <b>' + ticker + ' kena Target ' + k + '</b>');
    lines.push('Signal ' + ticker + ' mencapai Target ' + k + (pct != null ? ' (' + formatPct(pct) + ')' : ''));
  } else if (event === 'SL_HIT') {
    const base = entryBase(signal);
    const pct = base && priceNum ? ((priceNum - base) / base) * 100 : null;
    lines.push('🔴 <b>' + ticker + ' kena Stop</b>');
    lines.push('Signal ' + ticker + ' tersentuh invalidation/stop level' +
      (priceNum ? ' (' + formatRp(priceNum) + (pct != null ? ', ' + formatPct(pct) : '') + ')' : ''));
  } else {
    lines.push('📊 <b>' + ticker + '</b> ' + esc(event));
  }

  lines.push('');
  lines.push('<i>⚠️ Bukan rekomendasi beli/jual.</i>');
  return lines.join('\n');
}

async function sendTelegram(message, opts) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('  ⚠️ Telegram not configured, skipping');
    return { success: false, error: 'not_configured' };
  }

  const url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (!opts || opts.button !== false) {
    payload.reply_markup = { inline_keyboard: [[{ text: (opts && opts.buttonText) || 'Lihat Signal', url: (opts && opts.url) || SIGNALS_URL }]] };
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(t);

    const data = await res.json();
    if (!data.ok) {
      console.log('  ❌ Telegram error: ' + (data.description || 'unknown'));
      return { success: false, error: data.description };
    }
    return { success: true };
  } catch (err) {
    console.log('  ❌ Telegram fetch error: ' + err.message);
    return { success: false, error: err.message };
  }
}

async function notifySignalEvent(signal, event, price) {
  const message = buildMessage(signal, event, price);
  return await sendTelegram(message);
}

module.exports = { sendTelegram, notifySignalEvent, buildMessage };
