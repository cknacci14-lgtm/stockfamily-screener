(function () {
  'use strict';
  function volText(v) {
    v = Number(v) || 0;
    if (v >= 1e9) return (v / 1e9).toFixed(1).replace('.', ',') + 'mlr';
    if (v >= 1e6) return Math.round(v / 1e6) + 'jt';
    if (v >= 1e3) return Math.round(v / 1e3) + 'rb';
    return String(v);
  }
  function build(data) {
    var candleArr = (data.candles || []).map(function (c) {
      return { time: String(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) };
    });
    var idxOf = {};
    candleArr.forEach(function (c, i) { idxOf[c.time] = i; });
    var volMap = {};
    (data.volumes || []).forEach(function (v) { volMap[String(v.time)] = Number(v.value) || 0; });
    return { candleArr: candleArr, idxOf: idxOf, volMap: volMap };
  }
  // Hanya memakai informasi yang tersedia pada hari kejadian. 'fwd' adalah hasil SESUDAHNYA (informasi saja).
  function classify(bt, ctx) {
    var out = { dir: 0, position: null, scale: null, fwd: null, known: false };
    var i = ctx.idxOf[String(bt.time)];
    if (i == null) return out;
    var arr = ctx.candleArr, c = arr[i];
    out.known = true;
    var ref = (isFinite(c.open) && c.open > 0) ? c.open : (i > 0 ? arr[i - 1].close : NaN);
    out.dir = isFinite(ref) ? (c.close > ref ? 1 : (c.close < ref ? -1 : 0)) : 0;
    var hi = -Infinity, lo = Infinity;
    for (var k = Math.max(0, i - 30); k <= i; k++) {
      if (arr[k].high > hi) hi = arr[k].high;
      if (arr[k].low < lo) lo = arr[k].low;
    }
    out.position = hi > lo ? Math.round((c.close - lo) / (hi - lo) * 100) : 50;
    var s = 0, n = 0;
    for (var j = Math.max(0, i - 20); j < i; j++) {
      var vv = ctx.volMap[arr[j].time];
      if (vv > 0) { s += vv; n++; }
    }
    if (n >= 5 && s > 0) out.scale = Number(bt.volume) / (s / n);
    if (i + 3 < arr.length) out.fwd = (arr[i + 3].close / c.close - 1) * 100;
    return out;
  }
  function markers(trades, ctx, opts) {
    opts = opts || {};
    var limit = opts.limit || 10, base = opts.sizeBase || 1;
    var rank = opts.rank === 'scale'
      ? function (b) { var s = classify(b, ctx).scale; return s == null ? -1 : s; }
      : function (b) { return Number(b.volume); };
    var list = trades.map(function (b) { return { b: b, r: rank(b) }; })
      .sort(function (x, y) { return y.r - x.r; }).slice(0, limit).map(function (x) { return x.b; });
    var maxV = 1;
    list.forEach(function (b) { if (Number(b.volume) > maxV) maxV = Number(b.volume); });
    var out = list.map(function (bt) {
      var cl = classify(bt, ctx);
      var t = opts.timeAs === 'sec' ? Math.floor(new Date(String(bt.time) + 'T00:00:00+07:00').getTime() / 1000) : String(bt.time);
      return {
        time: t, position: 'aboveBar',
        color: cl.dir > 0 ? '#00E676' : (cl.dir < 0 ? '#FF5252' : '#A855F7'),
        shape: 'arrowDown', text: volText(bt.volume), size: base * (1 + Number(bt.volume) / maxV)
      };
    });
    out.sort(function (a, b) { return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0); });
    return out;
  }
  window.CNBT = { build: build, classify: classify, markers: markers, volText: volText };
})();