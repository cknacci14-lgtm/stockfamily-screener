// ============================================================
// Price Fetcher (Arjum + Yahoo fallback)
// ============================================================

export async function fetchPriceFromArjum(env, code) {
  if (!env.ARJUM_API_KEY) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://stock.arjum.com/api/price/' + encodeURIComponent(code), {
      headers: { 'X-API-Key': env.ARJUM_API_KEY, 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.last_price) {
      return { price: Number(data.last_price), source: 'arjum', date: data.source_date };
    }
    return null;
  } catch (err) {
    return null;
  }
}

export async function fetchPriceFromYahoo(code) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(code) + '.JK?range=1d&interval=1d', { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (meta && meta.regularMarketPrice) {
      return { price: Number(meta.regularMarketPrice), source: 'yahoo', date: new Date().toISOString().slice(0, 10) };
    }
    return null;
  } catch (err) {
    return null;
  }
}

export async function fetchPrice(env, code) {
  let p = await fetchPriceFromArjum(env, code);
  if (p) return p;
  p = await fetchPriceFromYahoo(code);
  if (p) return p;
  return null;
}
