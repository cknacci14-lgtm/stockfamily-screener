/*
 * Chartnalist Replay - mesin replay candle (UMD: browser + Node). Tanpa DOM, tanpa dependensi.
 * -> window.ChartnalistReplay ; di Node: require('./public/assets/chartnalist-replay.js')
 *
 * JAMINAN UTAMA: tidak ada API publik yang mengembalikan candle di atas kursor (atau di atas titik akhir).
 *   - candle disalin dan dibekukan saat dibuat; array internal tidak pernah dikembalikan.
 *   - visible() selalu array baru berisi candle [0..kursor].
 *   - nilai turunan (indikator, candle timeframe lebih tinggi) harus dihitung dari visible():
 *     lihat compute(fn) dan aggregateBy(visible, keyFn). Candle HTF terakhir otomatis "belum selesai"
 *     karena hanya dibangun dari candle yang sudah terlihat.
 *
 * time: angka (unix detik, seperti lightweight-charts) atau string 'YYYY-MM-DD'. Wajib menaik ketat.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChartnalistReplay = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var isNum = Number.isFinite;

  function cmp(a, b) {
    if (typeof a !== typeof b) throw new TypeError('tipe time campur (angka dan string)');
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function createReplay(candles, opts) {
    opts = opts || {};
    if (!Array.isArray(candles) || candles.length === 0) throw new TypeError('candles harus array tidak kosong');

    var data = [], i;
    for (i = 0; i < candles.length; i++) {
      var c = candles[i];
      var t = c == null ? undefined : c.time;
      if (!((typeof t === 'number' && isNum(t)) || typeof t === 'string')) throw new TypeError('candles[' + i + '].time tidak valid');
      if (i > 0 && cmp(data[i - 1].time, t) >= 0) throw new RangeError('time tidak menaik ketat di indeks ' + i + ' (urutan salah atau duplikat)');
      data.push(Object.freeze(Object.assign({}, c)));
    }

    function lastIndexAtOrBefore(time) {
      var lo = 0, hi = data.length - 1, ans = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (cmp(data[mid].time, time) <= 0) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans;
    }

    var endIdx = data.length - 1;
    if (opts.endAt != null) {
      endIdx = lastIndexAtOrBefore(opts.endAt);
      if (endIdx < 0) throw new RangeError('endAt sebelum candle pertama');
    }
    function clamp(k) { return Math.max(0, Math.min(endIdx, k)); }

    var initial = 0;
    if (opts.startAt != null) initial = clamp(lastIndexAtOrBefore(opts.startAt));
    else if (opts.startIndex != null) initial = clamp(Math.trunc(Number(opts.startIndex)) || 0);

    var cursor = initial, speed = 1, playing = false, handle = null, listeners = [];
    var baseMs = opts.baseIntervalMs > 0 ? opts.baseIntervalMs : 1000;
    var sched = opts.scheduler || {
      setInterval: function (f, ms) { return setInterval(f, ms); },
      clearInterval: function (h) { clearInterval(h); }
    };
    if (opts.speed != null) setSpeedValue(opts.speed);

    function setSpeedValue(x) {
      x = Number(x);
      if (!isNum(x) || x <= 0) throw new RangeError('speed harus angka > 0');
      speed = x;
    }

    function state() {
      return {
        cursor: cursor, time: data[cursor].time, count: cursor + 1, total: endIdx + 1,
        playing: playing, speed: speed, atStart: cursor === 0, atEnd: cursor === endIdx,
        progress: endIdx === 0 ? 1 : cursor / endIdx
      };
    }
    function emit() {
      var s = state();
      listeners.slice().forEach(function (fn) {
        try { fn(s); } catch (e) { if (typeof console !== 'undefined' && console.error) console.error('replay listener error', e); }
      });
    }
    function stopTimer() { if (handle !== null) { sched.clearInterval(handle); handle = null; } }
    function startTimer() { stopTimer(); handle = sched.setInterval(tick, baseMs / speed); }
    function tick() { step(1); }

    function seek(k) {
      var next = clamp(Math.trunc(Number(k)) || 0);
      var changed = next !== cursor;
      cursor = next;
      if (playing && cursor >= endIdx) { playing = false; stopTimer(); changed = true; }
      if (changed) emit();
      return state();
    }
    function step(n) { return seek(cursor + (n == null ? 1 : n)); }
    function stepBack(n) { return seek(cursor - (n == null ? 1 : n)); }
    function seekToTime(time) {
      var k = lastIndexAtOrBefore(time);
      return seek(k < 0 ? 0 : k);
    }
    function play() {
      if (playing) return true;
      if (cursor >= endIdx) return false;      // di titik akhir: tidak memulai ulang diam-diam; panggil reset()
      playing = true; startTimer(); emit(); return true;
    }
    function pause() {
      if (!playing) return;
      playing = false; stopTimer(); emit();
    }
    function setSpeed(x) {
      setSpeedValue(x);
      if (playing) startTimer();
      emit();
      return state();
    }
    function reset() {
      var was = playing;
      playing = false; stopTimer();
      var moved = cursor !== initial;
      cursor = initial;
      if (was || moved) emit();
      return state();
    }
    function subscribe(fn) {
      if (typeof fn !== 'function') throw new TypeError('listener harus fungsi');
      listeners.push(fn);
      return function () { var k = listeners.indexOf(fn); if (k >= 0) listeners.splice(k, 1); };
    }
    function destroy() { playing = false; stopTimer(); listeners = []; }

    return {
      state: state,
      visible: function () { return data.slice(0, cursor + 1); },
      current: function () { return data[cursor]; },
      compute: function (fn) { return fn(data.slice(0, cursor + 1)); },
      seek: seek, seekToTime: seekToTime, step: step, stepBack: stepBack,
      play: play, pause: pause, setSpeed: setSpeed, reset: reset,
      subscribe: subscribe, destroy: destroy
    };
  }

  // ---------- Agregasi timeframe lebih tinggi (dipakai pada hasil visible()) ----------
  // Zona waktu bursa: Asia/Jakarta = UTC+7 (tanpa DST). time angka dianggap unix DETIK.
  var JAKARTA_OFFSET_SEC = 7 * 3600;
  function ymd(time) {
    if (typeof time === 'string') {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(time);
      if (!m) throw new TypeError('format time string harus YYYY-MM-DD: ' + time);
      return { y: +m[1], m: +m[2], d: +m[3] };
    }
    var dt = new Date((time + JAKARTA_OFFSET_SEC) * 1000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function weekKey(time) {
    var p = ymd(time);
    var dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();   // 0 = Minggu
    var monday = new Date(Date.UTC(p.y, p.m - 1, p.d - ((dow + 6) % 7)));
    return monday.getUTCFullYear() + '-' + pad(monday.getUTCMonth() + 1) + '-' + pad(monday.getUTCDate());
  }
  function monthKey(time) { var p = ymd(time); return p.y + '-' + pad(p.m); }

  function aggregateBy(candles, keyFn) {
    var out = [], curKey = null, cur = null;
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i], k = keyFn(c.time);
      var vol = isNum(Number(c.volume)) ? Number(c.volume) : 0;
      if (cur === null || k !== curKey) {
        cur = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: vol, count: 1 };
        out.push(cur); curKey = k;
      } else {
        if (c.high > cur.high) cur.high = c.high;
        if (c.low < cur.low) cur.low = c.low;
        cur.close = c.close; cur.volume += vol; cur.count += 1;
      }
    }
    return out;
  }

  return { version: '1.0.0', createReplay: createReplay, aggregateBy: aggregateBy, weekKey: weekKey, monthKey: monthKey };
});
