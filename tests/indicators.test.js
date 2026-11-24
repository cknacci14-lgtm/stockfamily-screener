// Jalankan: node tests/indicators.test.js   (Node >= 18, tanpa dependensi)
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../public/assets/chartnalist-indicators.js');
const L = require('./legacy-reference.js');

// ---------- data uji ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function candles(n, seed) {
  const r = rng(seed); let c = 1000; const out = [];
  for (let i = 0; i < n; i++) {
    const o = c, d = (r() - 0.5) * 40;
    c = Math.max(50, o + d);
    const h = Math.max(o, c) + r() * 15, l = Math.min(o, c) - r() * 15;
    out.push({ time: i, open: o, high: h, low: l, close: c, volume: Math.round(1e5 + r() * 9e5) });
  }
  return out;
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
function seriesClose(a, b, eps) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null || b[i] == null) assert.equal(a[i], b[i], 'null mismatch @' + i);
    else assert.ok(close(a[i], b[i], eps), `beda @${i}: ${a[i]} vs ${b[i]}`);
  }
}

// ---------- nilai yang dihitung tangan ----------
test('SMA: nilai tangan dan pemanasan null', () => {
  const s = I.sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(s, [null, null, 2, 3, 4]);
});
test('SMA: jendela dengan nilai non-finite -> null (tidak menebak)', () => {
  assert.deepEqual(I.sma([1, 2, NaN, 4, 5, 6], 3), [null, null, null, null, null, 5]);
});
test('EMA: benih SMA, alpha 2/(n+1) (deret 1..10, n=3 -> nilai-1)', () => {
  const e = I.ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  assert.deepEqual(e.slice(0, 2), [null, null]);
  e.slice(2).forEach((v, k) => assert.ok(close(v, k + 2), `idx ${k + 2}: ${v}`));
});
test('RSI Wilder: kasus kecil dihitung tangan [10,11,10,12], n=2 -> 50 lalu 83.3333', () => {
  const r = I.rsi([10, 11, 10, 12], 2);
  assert.deepEqual(r.slice(0, 2), [null, null]);
  assert.ok(close(r[2], 50)); assert.ok(close(r[3], 100 - 100 / 6));
});
test('RSI: aturan tepi (datar=50, naik terus=100, turun terus=0)', () => {
  assert.equal(I.rsi(Array(20).fill(5), 14).at(-1), 50);
  assert.equal(I.rsi(Array.from({ length: 20 }, (_, i) => i), 14).at(-1), 100);
  assert.equal(I.rsi(Array.from({ length: 20 }, (_, i) => 100 - i), 14).at(-1), 0);
});
test('Bollinger: simpangan baku populasi (deret 1..20, n=20 -> sd = sqrt(399/12))', () => {
  const b = I.bollinger(Array.from({ length: 20 }, (_, i) => i + 1), 20, 2);
  const sd = Math.sqrt(399 / 12);
  assert.ok(close(b.middle[19], 10.5)); assert.ok(close(b.upper[19], 10.5 + 2 * sd)); assert.ok(close(b.lower[19], 10.5 - 2 * sd));
});
test('Bollinger: deret konstan -> pita menyatu', () => {
  const b = I.bollinger(Array(25).fill(7), 20, 2);
  assert.equal(b.upper[24], 7); assert.equal(b.lower[24], 7);
});
test('MACD: indeks pertama garis = slow-1, sinyal = slow-1+signal-1, hist = macd-signal', () => {
  const v = candles(80, 7).map(c => c.close);
  const m = I.macd(v, 12, 26, 9);
  assert.equal(m.macd.findIndex(x => x != null), 25);
  assert.equal(m.signal.findIndex(x => x != null), 33);
  for (let i = 0; i < v.length; i++) if (m.hist[i] != null) assert.ok(close(m.hist[i], m.macd[i] - m.signal[i]));
});
test('TrueRange & ATR Wilder: kasus kecil', () => {
  const rows = [{ high: 12, low: 10, close: 11 }, { high: 13, low: 11, close: 12 }, { high: 15, low: 12, close: 14 }];
  assert.equal(I.trueRange(rows[0]), 2);          // tanpa previous close -> high-low
  assert.equal(I.trueRange(rows[2], rows[1].close), 3);
  const a = I.atr(rows, 2, 'wilder');             // benih = rata2 TR[0..1] = (2+2)/2 = 2 ; lalu (2*1+3)/2 = 2.5
  assert.deepEqual(a.map(x => x == null ? null : x), [null, 2, 2.5]);
});

// ---------- tanpa look-ahead: memotong data tidak boleh mengubah nilai sebelumnya ----------
test('Tanpa look-ahead (invarian prefiks) untuk semua seri', () => {
  const rows = candles(300, 42), v = rows.map(c => c.close);
  const cuts = [60, 111, 199, 300];
  const full = { sma: I.sma(v, 20), ema: I.ema(v, 20), rsi: I.rsi(v, 14), m: I.macd(v), b: I.bollinger(v), a1: I.atr(rows, 14), a2: I.atr(rows, 14, 'wilder') };
  for (const k of cuts) {
    const p = rows.slice(0, k), pv = v.slice(0, k);
    seriesClose(I.sma(pv, 20), full.sma.slice(0, k), 0);
    seriesClose(I.ema(pv, 20), full.ema.slice(0, k), 0);
    seriesClose(I.rsi(pv, 14), full.rsi.slice(0, k), 0);
    const m = I.macd(pv);
    seriesClose(m.macd, full.m.macd.slice(0, k), 0); seriesClose(m.signal, full.m.signal.slice(0, k), 0);
    const b = I.bollinger(pv);
    seriesClose(b.upper, full.b.upper.slice(0, k), 0);
    seriesClose(I.atr(p, 14), full.a1.slice(0, k), 0); seriesClose(I.atr(p, 14, 'wilder'), full.a2.slice(0, k), 0);
  }
});

// ---------- paritas dengan kode lama ----------
test('Paritas RSI: rsiLast == calcRSI lama (data bersih, banyak seed dan periode)', () => {
  for (let seed = 1; seed <= 40; seed++) for (const p of [2, 5, 14, 21]) {
    const c = candles(30 + seed * 3, seed);
    assert.equal(I.rsiLast(c, p), L.calcRSI(c, p), `seed ${seed} p ${p}`);
  }
});
test('Paritas RSI: data kotor (NaN, null, string, undefined) identik dengan kode lama', () => {
  const dirt = [NaN, null, undefined, 'abc', '', '12.5', Infinity];
  for (let seed = 1; seed <= 40; seed++) {
    const c = candles(60, seed), r = rng(seed * 9);
    c.forEach(x => { if (r() < 0.12) x.close = dirt[Math.floor(r() * dirt.length)]; });
    if (seed % 7 === 0) c[3] = null;
    assert.equal(I.rsiLast(c, 14), L.calcRSI(c, 14), `seed ${seed}`);
  }
});
test('Paritas RSI: input terlalu pendek / bukan array', () => {
  assert.equal(I.rsiLast([], 14), L.calcRSI([], 14));
  assert.equal(I.rsiLast(null, 14), L.calcRSI(null, 14));
  assert.equal(I.rsiLast(candles(14, 1), 14), L.calcRSI(candles(14, 1), 14)); // 14 < 15 -> null
});
test('Seri RSI: nilai terakhir == calcRSI lama', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const c = candles(120, seed);
    assert.ok(close(I.rsi(c.map(x => x.close), 14).at(-1), L.calcRSI(c, 14)));
  }
});
test('Paritas SMA: smaLast == sma lama (bersih dan kotor)', () => {
  for (let seed = 1; seed <= 40; seed++) for (const n of [5, 20, 50]) {
    const c = candles(80, seed), r = rng(seed);
    if (seed % 2) c.forEach(x => { if (r() < 0.1) x.close = [NaN, null, undefined, 'x'][Math.floor(r() * 4)]; });
    assert.equal(I.smaLast(c, 'close', n), L.sma(c, 'close', n), `seed ${seed} n ${n}`);
  }
  assert.equal(I.smaLast(candles(3, 1), 'close', 5), L.sma(candles(3, 1), 'close', 5)); // undefined
});
test('Paritas ATR: atrLast == atr lama (bersih dan kotor)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const c = candles(60, seed), r = rng(seed * 3);
    if (seed % 2) c.forEach(x => { if (r() < 0.08) x.high = [NaN, null, undefined][Math.floor(r() * 3)]; if (r() < 0.05) x.close = NaN; });
    assert.equal(I.atrLast(c, 14), L.atr(c, 14), `seed ${seed}`);
    assert.equal(I.atrLast(c.slice(0, 15), 14), L.atr(c.slice(0, 15), 14));
  }
  assert.equal(I.atrLast(candles(14, 1), 14), L.atr(candles(14, 1), 14)); // undefined
});
test('Seri ATR (sma) pada data bersih: nilai di indeks i == atr lama pada rows[0..i]', () => {
  const c = candles(100, 5), s = I.atr(c, 14);
  for (let i = 14; i < c.length; i++) assert.ok(close(s[i], L.atr(c.slice(0, i + 1), 14)), 'idx ' + i);
  assert.equal(s.findIndex(x => x != null), 14);
});
test('Seri SMA pada data bersih == smaLast per indeks', () => {
  const c = candles(100, 11), s = I.sma(c.map(x => x.close), 20);
  for (let i = 19; i < c.length; i++) assert.equal(s[i], L.sma(c.slice(0, i + 1), 'close', 20));
});
test('rollingVWAP identik dengan calcRollingVWAP lama', () => {
  // salinan verbatim dari app.html (baris 60-70, penutup fungsi disimpulkan dari polanya)
  function legacy(candles, volumeByTime, win) {
    const out = [];
    for (let i = 0; i < candles.length; i++) {
      let pv = 0, vv = 0;
      for (let j = Math.max(0, i - win + 1); j <= i; j++) {
        const v = volumeByTime.get(candles[j].time) || 0;
        pv += ((candles[j].high + candles[j].close + candles[j].low) / 3) * v;
        vv += v;
      }
      out.push({ time: candles[i].time, value: vv > 0 ? pv / vv : candles[i].close });
    }
    return out;
  }
  const c = candles(60, 3), vm = new Map(c.map(x => [x.time, x.volume])); vm.delete(5);
  assert.deepEqual(I.rollingVWAP(c, vm, 20), legacy(c, vm, 20));
});
