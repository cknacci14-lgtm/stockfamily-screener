// ============================================================
// Supabase Helper (fetch-based, no dependency)
// ============================================================

export async function sbFetch(env, path, options = {}) {
  const url = env.SUPABASE_URL + '/rest/v1/' + path;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
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

export async function getLatestTradeDate(env) {
  const rows = await sbFetch(env, 'daily_stock_data?select=trade_date&order=trade_date.desc&limit=1');
  if (!rows || !rows.length) return null;
  return rows[0].trade_date;
}

export function rangeToStartDate(range, endDate) {
  if (!endDate) return null;
  const end = new Date(endDate);
  const ranges = {
    '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825
  };
  const days = ranges[range] || 90;
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return start.toISOString().slice(0, 10);
}
