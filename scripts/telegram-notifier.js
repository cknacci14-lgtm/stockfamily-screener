// ============================================================
// TELEGRAM NOTIFIER
// Kirim notifikasi ke grup Telegram saat signal event
// ============================================================

const TELEGRAM_TOKEN = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

const EVENT_EMOJI = {
  PUBLISHED: '📢',
  ENTRY_HIT: '🎯',
  TP1_HIT: '✅',
  TP2_HIT: '🎉',
  TP3_HIT: '🏆',
  SL_HIT: '🛑'
};

const EVENT_TITLE = {
  PUBLISHED: 'NEW SIGNAL PUBLISHED',
  ENTRY_HIT: 'ENTRY HIT',
  TP1_HIT: 'TARGET 1 HIT',
  TP2_HIT: 'TARGET 2 HIT',
  TP3_HIT: 'TARGET 3 HIT',
  SL_HIT: 'STOP LOSS HIT'
};

function formatRp(n) {
  if (n == null || isNaN(n)) return '—';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function formatPct(n) {
  if (n == null || isNaN(n)) return '';
  const sign = n >= 0 ? '+' : '';
  return '(' + sign + Number(n).toFixed(2) + '%)';
}

function buildMessage(signal, event, price) {
  const emoji = EVENT_EMOJI[event] || '📊';
  const title = EVENT_TITLE[event] || event;
  const ticker = signal.ticker || '—';
  const tf = signal.timeframe || 'D1';
  
  const entryAvg = Number(signal.entry_avg);
  const priceNum = Number(price);
  let plPct = null;
  if (entryAvg && priceNum) {
    plPct = ((priceNum - entryAvg) / entryAvg) * 100;
  }
  
  let lines = [];
  lines.push(emoji + ' <b>' + title + '</b>');
  lines.push('');
  lines.push('📈 <b>' + ticker + '</b> (' + tf + ')');
  lines.push('━━━━━━━━━━━━━━━━━━');
  
  if (priceNum) {
    lines.push('💰 Last Price : <b>' + formatRp(priceNum) + '</b>');
  }
  if (entryAvg) {
    lines.push('📊 Entry Avg  : ' + formatRp(entryAvg));
  }
  if (plPct != null) {
    const pctStr = formatPct(plPct);
    const emoji2 = plPct >= 0 ? '🟢' : '🔴';
    lines.push('📈 P/L        : ' + emoji2 + ' ' + pctStr);
  }
  
  if (event === 'PUBLISHED' || event === 'ENTRY_HIT') {
    lines.push('');
    lines.push('📍 Entry 1: ' + formatRp(signal.entry_1));
    if (signal.entry_2) lines.push('📍 Entry 2: ' + formatRp(signal.entry_2));
    if (signal.entry_3) lines.push('📍 Entry 3: ' + formatRp(signal.entry_3));
    lines.push('🛑 SL     : ' + formatRp(signal.stop_loss));
    lines.push('🎯 TP1    : ' + formatRp(signal.target_1));
    if (signal.target_2) lines.push('🎯 TP2    : ' + formatRp(signal.target_2));
    if (signal.target_3) lines.push('🎯 TP3    : ' + formatRp(signal.target_3));
    if (signal.risk_reward) {
      lines.push('⚖️  R:R    : ' + Number(signal.risk_reward).toFixed(2) + 'R');
    }
  }
  
  if (signal.notes) {
    lines.push('');
    lines.push('💬 <i>' + signal.notes + '</i>');
  }
  
  lines.push('');
  const now = new Date();
  const dateStr = now.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) + ' WIB';
  lines.push('📅 ' + dateStr);
  lines.push('');
  lines.push('<i>⚠️ Bukan rekomendasi beli/jual.</i>');
  
  return lines.join('\n');
}

async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('  ⚠️ Telegram not configured, skipping');
    return { success: false, error: 'not_configured' };
  }
  
  const url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
  
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
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
