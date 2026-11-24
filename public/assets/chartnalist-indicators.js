/*
 * Chartnalist Indicators - modul indikator bersama (UMD: browser + Node).
 * Dimuat di halaman lewat <script src="/assets/chartnalist-indicators.js"></script>
 * -> window.ChartnalistIndicators ; di Node: require('./public/assets/chartnalist-indicators.js')
 *
 * ATURAN MODUL
 * 1) Tanpa look-ahead: nilai di indeks i hanya memakai data indeks <= i
 *    (diuji: memotong data tidak mengubah nilai sebelumnya).
 * 2) Seri (sma, ema, rsi, macd, bollinger, atr, ...) selalu sepanjang input; periode pemanasan = null.
 * 3) Nilai non-finite pada input dilewati (tidak merusak keadaan), outputnya null di indeks itu.
 * 4) Fungsi "...Last" mereproduksi PERSIS perilaku kode lama (calcRSI di app.html;
 *    sma/atr di src/lib/smartwatchlist-core.js) agar migrasi tidak mengubah angka.
 * 5) Konvensi (tertulis, bisa dibandingkan dengan platform lain):
 *    - EMA : alpha = 2/(n+1), benih = SMA dari n nilai pertama (seperti ta.ema Pine).
 *    - RSI : Wilder (RMA), benih = rata-rata n perubahan pertama.
 *    - MACD: EMA(fast)-EMA(slow); sinyal = EMA(signal) dari garis MACD, berbenih SMA.
 *    - Bollinger: simpangan baku POPULASI (dibagi n), sama dengan ta.stdev Pine.
 *    - ATR : default 'sma' (rata-rata n True Range terakhir, sama dengan kode lama);
 *            opsi 'wilder' (RMA, benih SMA n TR pertama, TR bar pertama = high-low).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChartnalistIndicators = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var isNum = Number.isFinite;

  // ---------- util ----------
  function compact(values) {
    var vals = [], idx = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (typeof v === 'number' && isNum(v)) { vals.push(v); idx.push(i); }
    }
    return { vals: vals, idx: idx };
  }
  function mapBack(out, idx, length) {
    var res = new Array(length);
    for (var i = 0; i < length; i++) res[i] = null;
    for (var k = 0; k < out.length; k++) res[idx[k]] = out[k];
    return res;
  }
  function field(rows, name) {
    var out = new Array(rows.length);
    for (var i = 0; i < rows.length; i++) { var r = rows[i]; out[i] = Number(r == null ? undefined : r[name]); }
    return out;
  }
  function closes(rows) { return field(rows, 'close'); }

  // ---------- SMA ----------
  // Jendela harus berisi n nilai finite; kalau tidak, null.
  function sma(values, n) {
    var out = new Array(values.length);
    for (var i = 0; i < values.length; i++) {
      out[i] = null;
      if (i < n - 1) continue;
      var s = 0, ok = true;
      for (var j = i - n + 1; j <= i; j++) {
        var v = values[j];
        if (typeof v !== 'number' || !isNum(v)) { ok = false; break; }
        s += v;
      }
      if (ok) out[i] = s / n;
    }
    return out;
  }

  // ---------- EMA ----------
  function emaCompact(vals, n) {
    var out = [];
    if (vals.length < n) return out;
    var alpha = 2 / (n + 1), s = 0, k;
    for (k = 0; k < n; k++) s += vals[k];
    var prev = s / n;
    for (k = 0; k < n - 1; k++) out.push(null);
    out.push(prev);
    for (k = n; k < vals.length; k++) { prev = alpha * vals[k] + (1 - alpha) * prev; out.push(prev); }
    return out;
  }
  function ema(values, n) {
    var c = compact(values);
    return mapBack(emaCompact(c.vals, n), c.idx, values.length);
  }

  // ---------- RSI (Wilder) ----------
  function rsiFromAvg(avgGain, avgLoss) {
    // aturan tepi identik dengan calcRSI lama
    if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
    if (avgGain === 0) return 0;
    var rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  function rsiCompact(vals, period) {
    var out = [], i;
    for (i = 0; i < vals.length; i++) out.push(null);
    if (vals.length < period + 1) return out;
    var gainSum = 0, lossSum = 0, diff;
    for (i = 1; i <= period; i++) {
      diff = vals[i] - vals[i - 1];
      if (diff > 0) gainSum += diff; else if (diff < 0) lossSum -= diff;
    }
    var avgGain = gainSum / period, avgLoss = lossSum / period;
    out[period] = rsiFromAvg(avgGain, avgLoss);
    for (i = period + 1; i < vals.length; i++) {
      diff = vals[i] - vals[i - 1];
      var gain = diff > 0 ? diff : 0, loss = diff < 0 ? -diff : 0;
      avgGain = ((avgGain * (period - 1)) + gain) / period;
      avgLoss = ((avgLoss * (period - 1)) + loss) / period;
      out[i] = rsiFromAvg(avgGain, avgLoss);
    }
    return out;
  }
  function rsi(values, period) {
    period = period || 14;
    var c = compact(values);
    return mapBack(rsiCompact(c.vals, period), c.idx, values.length);
  }

  // ---------- MACD ----------
  function macd(values, fast, slow, signal) {
    fast = fast || 12; slow = slow || 26; signal = signal || 9;
    var ef = ema(values, fast), es = ema(values, slow), n = values.length, i;
    var line = new Array(n);
    for (i = 0; i < n; i++) line[i] = (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null;
    var c = compact(line);
    var sig = mapBack(emaCompact(c.vals, signal), c.idx, n);
    var hist = new Array(n);
    for (i = 0; i < n; i++) hist[i] = (line[i] != null && sig[i] != null) ? line[i] - sig[i] : null;
    return { macd: line, signal: sig, hist: hist };
  }

  // ---------- Bollinger ----------
  function bollinger(values, n, mult) {
    n = n || 20; mult = mult == null ? 2 : mult;
    var mid = sma(values, n), up = [], lo = [], i, j;
    for (i = 0; i < values.length; i++) {
      if (mid[i] == null) { up.push(null); lo.push(null); continue; }
      var sq = 0;
      for (j = i - n + 1; j <= i; j++) { var d = values[j] - mid[i]; sq += d * d; }
      var sd = Math.sqrt(sq / n);
      up.push(mid[i] + mult * sd); lo.push(mid[i] - mult * sd);
    }
    return { middle: mid, upper: up, lower: lo };
  }

  // ---------- True Range & ATR ----------
  // Sama dengan trueRange lama: tanpa previousClose finite -> high-low.
  function trueRange(row, previousClose) {
    var high = Number(row == null ? undefined : row.high);
    var low = Number(row == null ? undefined : row.low);
    var prev = Number(previousClose);
    if (!isNum(high) || !isNum(low)) return undefined;
    if (!isNum(prev)) return high - low;
    return Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev));
  }
  function trSeries(rows) {
    var out = new Array(rows.length);
    for (var i = 0; i < rows.length; i++) {
      var tr = trueRange(rows[i], i > 0 ? rows[i - 1].close : undefined);
      out[i] = isNum(tr) ? tr : null;
    }
    return out;
  }
  function atr(rows, n, method) {
    n = n || 14; method = method || 'sma';
    var tr = trSeries(rows), out = new Array(rows.length), i, j;
    for (i = 0; i < rows.length; i++) out[i] = null;
    if (method === 'wilder') {
      var prev = null, seeded = false, buf = [];
      for (i = 0; i < tr.length; i++) {
        if (tr[i] == null) continue;
        if (!seeded) {
          buf.push(tr[i]);
          if (buf.length === n) { var s = 0; for (j = 0; j < n; j++) s += buf[j]; prev = s / n; seeded = true; out[i] = prev; }
        } else { prev = ((prev * (n - 1)) + tr[i]) / n; out[i] = prev; }
      }
      return out;
    }
    // mulai di i = n: semua TR di jendela memakai previousClose (sama dengan kode lama)
    for (i = n; i < tr.length; i++) {
      var sum = 0, ok = true;
      for (j = i - n + 1; j <= i; j++) { if (tr[j] == null) { ok = false; break; } sum += tr[j]; }
      if (ok) out[i] = sum / n;
    }
    return out;
  }

  // ---------- Rolling VWAP (drop-in untuk calcRollingVWAP di app.html) ----------
  function rollingVWAP(candles, volumeByTime, win) {
    var out = [];
    for (var i = 0; i < candles.length; i++) {
      var pv = 0, vv = 0;
      for (var j = Math.max(0, i - win + 1); j <= i; j++) {
        var v = volumeByTime.get(candles[j].time) || 0;
        pv += ((candles[j].high + candles[j].close + candles[j].low) / 3) * v;
        vv += v;
      }
      out.push({ time: candles[i].time, value: vv > 0 ? pv / vv : candles[i].close });
    }
    return out;
  }

  // ---------- Pengganti persis kode lama (nilai terakhir saja) ----------
  // calcRSI(candles, period) di app.html
  function rsiLast(candles, period) {
    period = period == null ? 14 : period;
    if (!Array.isArray(candles) || candles.length < period + 1) return null;
    var cl = candles.map(function (c) { return Number(c == null ? undefined : c.close); }).filter(Number.isFinite);
    if (cl.length < period + 1) return null;
    var out = rsiCompact(cl, period);
    return out[out.length - 1];
  }
  function numOrUndef(v) { var n = Number(v); return isNum(n) ? n : undefined; }
  function meanValid(values) {
    var v = values.filter(Number.isFinite);
    if (!v.length) return undefined;
    return v.reduce(function (s, x) { return s + x; }, 0) / v.length;
  }
  function lastN(rows, n) { return rows.slice(Math.max(0, rows.length - n)); }
  // sma(rows, field, n) di smartwatchlist-core.js
  function smaLast(rows, fieldName, n) {
    if (rows.length < n) return undefined;
    return meanValid(lastN(rows, n).map(function (r) { return numOrUndef(r[fieldName]); }));
  }
  // atr(rows, n) di smartwatchlist-core.js (rata-rata n True Range terakhir; BUKAN Wilder)
  function atrLast(rows, n) {
    n = n == null ? 14 : n;
    if (rows.length < n + 1) return undefined;
    var recent = lastN(rows, n + 1), ranges = [];
    for (var i = 0; i < recent.length; i++) {
      var tr = trueRange(recent[i], i > 0 ? recent[i - 1].close : undefined);
      if (isNum(tr)) ranges.push(tr);
    }
    return ranges.length >= n ? meanValid(lastN(ranges, n)) : undefined;
  }

  return {
    version: '1.0.0',
    closes: closes, field: field,
    sma: sma, ema: ema, rsi: rsi, macd: macd, bollinger: bollinger,
    trueRange: trueRange, atr: atr, rollingVWAP: rollingVWAP,
    rsiLast: rsiLast, smaLast: smaLast, atrLast: atrLast
  };
});
