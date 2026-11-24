// Jalankan: node tests/replay.test.js   (Node >= 18, tanpa dependensi)
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/assets/chartnalist-replay.js');
const I = require('../public/assets/chartnalist-indicators.js');

// ---------- data uji ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function makeCandles(n, seed) {
  const r = rng(seed); let c = 1000; const out = [];
  for (let i = 0; i < n; i++) {
    const o = c; c = Math.max(50, o + (r() - 0.5) * 40);
    out.push({ time: i + 1, open: o, high: Math.max(o, c) + r() * 10, low: Math.min(o, c) - r() * 10, close: c, volume: 1000 + i });
  }
  return out;
}
// penanda unik per candle: dipakai untuk mendeteksi kebocoran data masa depan
function sentinel(i) { return 7000000 + i * 11 + 0.123; }
function sentinelCandles(n) {
  return Array.from({ length: n }, (_, i) => ({ time: i + 1, open: sentinel(i) + 0.1, high: sentinel(i) + 0.2, low: sentinel(i) + 0.3, close: sentinel(i), volume: 500000 + i }));
}
function fakeScheduler() {
  const s = { fn: null, ms: null, cleared: 0, set: 0 };
  s.setInterval = (f, ms) => { s.fn = f; s.ms = ms; s.set++; return 1; };
  s.clearInterval = () => { s.cleared++; s.fn = null; };
  return s;
}

// ---------- validasi ----------
test('Validasi: input kosong / bukan array / time buruk / tidak menaik / duplikat', () => {
  assert.throws(() => R.createReplay([]), TypeError);
  assert.throws(() => R.createReplay(null), TypeError);
  assert.throws(() => R.createReplay([{ time: NaN }]), TypeError);
  assert.throws(() => R.createReplay([{ close: 1 }]), TypeError);
  assert.throws(() => R.createReplay([{ time: 2 }, { time: 1 }]), RangeError);
  assert.throws(() => R.createReplay([{ time: 1 }, { time: 1 }]), RangeError);
  assert.throws(() => R.createReplay([{ time: 1 }, { time: '2026-01-02' }]), TypeError);
});

// ---------- navigasi ----------
test('Posisi awal: default candle pertama; startAt, startIndex, dan clamp', () => {
  const c = makeCandles(50, 1);
  assert.equal(R.createReplay(c).state().cursor, 0);
  assert.equal(R.createReplay(c, { startAt: 20 }).state().cursor, 19);
  assert.equal(R.createReplay(c, { startAt: 20.5 }).state().cursor, 19);   // candle terakhir <= waktu
  assert.equal(R.createReplay(c, { startAt: -5 }).state().cursor, 0);      // sebelum data -> candle pertama
  assert.equal(R.createReplay(c, { startAt: 9999 }).state().cursor, 49);
  assert.equal(R.createReplay(c, { startIndex: 10 }).state().cursor, 10);
});
test('step, stepBack, seek, seekToTime, batas awal dan akhir', () => {
  const rp = R.createReplay(makeCandles(10, 2), { startIndex: 5 });
  assert.equal(rp.step().cursor, 6); assert.equal(rp.step(3).cursor, 9);
  assert.equal(rp.step(5).cursor, 9);                  // tidak melewati akhir
  assert.equal(rp.state().atEnd, true);
  assert.equal(rp.stepBack(100).cursor, 0); assert.equal(rp.state().atStart, true);
  assert.equal(rp.seek(3).cursor, 3); assert.equal(rp.seekToTime(8).cursor, 7);
  assert.equal(rp.seek('abc').cursor, 0);               // masukan sampah -> aman
});
test('endAt membatasi replay dan candle setelahnya tidak pernah terlihat', () => {
  const c = sentinelCandles(30);
  const rp = R.createReplay(c, { endAt: 12 });
  assert.equal(rp.state().total, 12);
  rp.seek(999);
  assert.equal(rp.visible().length, 12); assert.equal(rp.state().atEnd, true);
  assert.throws(() => R.createReplay(c, { endAt: 0 }), RangeError);
});
test('reset kembali ke posisi awal dan menghentikan pemutaran', () => {
  const sch = fakeScheduler(), rp = R.createReplay(makeCandles(20, 3), { startIndex: 4, scheduler: sch });
  rp.play(); sch.fn(); sch.fn();
  assert.equal(rp.state().cursor, 6);
  const s = rp.reset();
  assert.equal(s.cursor, 4); assert.equal(s.playing, false); assert.equal(sch.fn, null);
});

// ---------- pemutaran ----------
test('Play/pause: tiap tick maju satu candle; berhenti otomatis di akhir', () => {
  const sch = fakeScheduler(), rp = R.createReplay(makeCandles(5, 4), { scheduler: sch });
  assert.equal(rp.play(), true); assert.equal(sch.ms, 1000);
  for (let k = 0; k < 10 && sch.fn; k++) sch.fn();
  assert.equal(rp.state().cursor, 4); assert.equal(rp.state().playing, false); assert.equal(sch.fn, null);
  assert.equal(rp.play(), false);                       // di akhir: tidak memulai ulang diam-diam
});
test('Kecepatan: interval = 1000/speed, berubah saat sedang play, nilai buruk ditolak', () => {
  const sch = fakeScheduler(), rp = R.createReplay(makeCandles(30, 5), { scheduler: sch, speed: 2 });
  rp.play(); assert.equal(sch.ms, 500);
  rp.setSpeed(10); assert.equal(sch.ms, 100); assert.equal(rp.state().speed, 10);
  assert.throws(() => rp.setSpeed(0), RangeError); assert.throws(() => rp.setSpeed(-1), RangeError); assert.throws(() => rp.setSpeed('x'), RangeError);
  rp.pause(); assert.equal(sch.fn, null);
});
test('Subscribe: menerima snapshot saat berubah; unsubscribe berhenti; error listener terisolasi', () => {
  const rp = R.createReplay(makeCandles(10, 6)), seen = [];
  const off = rp.subscribe(s => seen.push(s.cursor));
  const origErr = console.error; console.error = () => {};
  rp.subscribe(() => { throw new Error('x'); });
  rp.step(); rp.step(); off(); rp.step();
  console.error = origErr;
  assert.deepEqual(seen, [1, 2]); assert.equal(rp.state().cursor, 3);
});

// ---------- INTI: tidak ada kebocoran masa depan ----------
test('Tanpa kebocoran: seluruh keluaran API di setiap posisi tidak memuat penanda candle masa depan', () => {
  const N = 40, c = sentinelCandles(N);
  const rp = R.createReplay(c);
  const payloads = [];
  rp.subscribe(s => payloads.push(JSON.stringify(s)));
  for (let k = 0; k < N; k++) {
    rp.seek(k);
    const blob = JSON.stringify([rp.visible(), rp.current(), rp.state(), rp.compute(v => v.map(x => x.close)), payloads.slice(-1)]);
    for (let j = k + 1; j < N; j++) {
      assert.ok(!blob.includes(String(sentinel(j))), `bocor: candle #${j} terlihat di posisi ${k}`);
      assert.ok(!blob.includes(String(sentinel(j) + 0.2)), `bocor (high) #${j} di posisi ${k}`);
    }
    assert.equal(rp.visible().length, k + 1);
    assert.equal(rp.visible().at(-1).close, sentinel(k));
    assert.equal(rp.state().time, rp.visible().at(-1).time, 'state().time harus = waktu candle terlihat terakhir');
    assert.equal(rp.state().count, k + 1); assert.equal(rp.current().time, rp.visible().at(-1).time);
  }
});
test('Tanpa kebocoran: mengubah hasil visible() tidak memengaruhi data internal; candle dibekukan', () => {
  const src = makeCandles(10, 7), rp = R.createReplay(src, { startIndex: 5 });
  const v = rp.visible(); v.length = 0; v.push({ time: 999, close: -1 });
  assert.equal(rp.visible().length, 6); assert.equal(rp.visible()[5].time, 6);
  assert.throws(() => { 'use strict'; rp.current().close = 0; }, TypeError);
  src[3].close = -12345; assert.notEqual(rp.visible()[3].close, -12345);   // salinan terpisah dari sumber
});
test('Indikator di atas replay: nilai pada posisi k == seri penuh pada indeks k (tanpa look-ahead)', () => {
  const c = makeCandles(120, 8), full = c.map(x => x.close);
  const fRsi = I.rsi(full, 14), fEma = I.ema(full, 20), fM = I.macd(full), fB = I.bollinger(full, 20);
  const rp = R.createReplay(c);
  for (let k = 0; k < c.length; k++) {
    rp.seek(k);
    const v = rp.compute(rows => I.closes(rows));
    const pick = (a) => a[a.length - 1];
    const eq = (a, b) => a === b || (a != null && b != null && Math.abs(a - b) < 1e-12);
    assert.ok(eq(pick(I.rsi(v, 14)), fRsi[k]), 'rsi @' + k);
    assert.ok(eq(pick(I.ema(v, 20)), fEma[k]), 'ema @' + k);
    assert.ok(eq(pick(I.macd(v).signal), fM.signal[k]), 'macd @' + k);
    assert.ok(eq(pick(I.bollinger(v, 20).upper), fB.upper[k]), 'bb @' + k);
  }
});

// ---------- agregasi timeframe lebih tinggi ----------
function dailyIso(start, n) {   // hari kerja berurutan mulai 'YYYY-MM-DD' (hanya Sen-Jum)
  const out = []; let d = new Date(start + 'T00:00:00Z'), i = 0;
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) { const s = d.toISOString().slice(0, 10); out.push({ time: s, open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, volume: 100 }); i++; }
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
test('weekKey/monthKey: string dan unix detik (WIB = UTC+7, batas hari tidak bergeser)', () => {
  assert.equal(R.weekKey('2026-11-23'), '2026-11-23');                    // Senin
  assert.equal(R.weekKey('2026-11-27'), '2026-11-23');                    // Jumat
  assert.equal(R.weekKey('2026-11-22'), '2026-11-16');                    // Minggu masuk pekan sebelumnya
  const mondayWib = Date.UTC(2026, 10, 22, 17, 0, 0) / 1000;               // Sen 23 Nov 00:00 WIB = Min 22 Nov 17:00 UTC
  assert.equal(R.weekKey(mondayWib), '2026-11-23');
  const sundayWib = Date.UTC(2026, 10, 22, 10, 0, 0) / 1000;               // Min 22 Nov 17:00 WIB
  assert.equal(R.weekKey(sundayWib), '2026-11-16');
  assert.equal(R.monthKey('2026-12-31'), '2026-12');
  assert.equal(R.monthKey(Date.UTC(2026, 10, 30, 17, 0, 0) / 1000), '2026-12');   // 1 Des 00:00 WIB
  assert.throws(() => R.weekKey('23/11/2026'), TypeError);
});
test('aggregateBy: OHLCV mingguan benar (buka pertama, tertinggi, terendah, tutup terakhir, volume jumlah)', () => {
  const d = dailyIso('2026-11-23', 5).map((x, i) => ({ ...x, open: 10 + i, high: 20 + i * 2, low: 5 - i, close: 12 + i }));
  const w = R.aggregateBy(d, R.weekKey);
  assert.equal(w.length, 1);
  assert.deepEqual(w[0], { time: '2026-11-23', open: 10, high: 28, low: 1, close: 16, volume: 500, count: 5 });
});
test('Replay + agregasi: candle mingguan terakhir hanya dibangun dari hari yang sudah terlihat', () => {
  const d = dailyIso('2026-11-02', 15);          // 3 pekan penuh
  const full = R.aggregateBy(d, R.weekKey);
  const rp = R.createReplay(d);
  for (let k = 0; k < d.length; k++) {
    rp.seek(k);
    const w = R.aggregateBy(rp.visible(), R.weekKey), last = w[w.length - 1];
    const seen = d.slice(0, k + 1).filter(x => R.weekKey(x.time) === R.weekKey(d[k].time));
    assert.equal(last.count, seen.length);
    assert.equal(last.close, d[k].close);                                     // tutup = candle terakhir yang terlihat
    assert.equal(last.high, Math.max(...seen.map(x => x.high)));
    assert.equal(last.volume, seen.length * 100);
    if (k < d.length - 1) assert.ok(last.count <= 5);
  }
  assert.deepEqual(R.aggregateBy(rp.seek(d.length - 1) && rp.visible(), R.weekKey), full);   // di akhir == agregasi penuh
});
