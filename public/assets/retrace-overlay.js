/*
 * Chartnalist retrace overlay (informational only, not a signal).
 * compute(candles) finds the latest rising legs (zigzag swings) and the
 * Fibonacci retrace levels 0.5 / 0.618 / 0.81, with the invalidation at the
 * leg's swing low. apply(series, result) draws them as price lines.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChartnalistRetrace = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = { scales: [0.25, 0.5], minLeg: 0.25, levels: [0.5, 0.618, 0.81], lo: 0.5, hi: 0.81, tol: 0.04, maxBars: 60, maxLegs: 2 };

  function zigzag(rows, T) {
    var piv = [], dir = 0, extI = 0, hiI = 0, loI = 0, i;
    for (i = 1; i < rows.length; i++) {
      if (dir === 0) {
        if (rows[i].h > rows[hiI].h) hiI = i;
        if (rows[i].l < rows[loI].l) loI = i;
        if (rows[hiI].h / rows[loI].l - 1 >= T) {
          if (loI < hiI) { piv.push({ i: loI, p: rows[loI].l, t: 'L' }); dir = 1; extI = hiI; }
          else { piv.push({ i: hiI, p: rows[hiI].h, t: 'H' }); dir = -1; extI = loI; }
        }
      } else if (dir === 1) {
        if (rows[i].h > rows[extI].h) extI = i;
        else if (rows[i].l <= rows[extI].h * (1 - T)) { piv.push({ i: extI, p: rows[extI].h, t: 'H' }); dir = -1; extI = i; }
      } else {
        if (rows[i].l < rows[extI].l) extI = i;
        else if (rows[i].h >= rows[extI].l * (1 + T)) { piv.push({ i: extI, p: rows[extI].l, t: 'L' }); dir = 1; extI = i; }
      }
    }
    return { piv: piv, dir: dir, extI: extI };
  }

  function lastLeg(rows, T) {
    var z = zigzag(rows, T), pv = z.piv, h, l;
    if (z.dir === -1) {
      h = pv[pv.length - 1]; l = pv[pv.length - 2];
      if (h && l && h.t === 'H' && l.t === 'L') return { Hi: h.i, H: h.p, Li: l.i, L: l.p };
    } else if (z.dir === 1) {
      l = pv[pv.length - 1];
      if (l && l.t === 'L') return { Hi: z.extI, H: rows[z.extI].h, Li: l.i, L: l.p };
    }
    return null;
  }

  function round(x) { return Math.abs(x) >= 1000 ? Math.round(x) : Math.round(x * 100) / 100; }

  function compute(candles, options) {
    var o = {}, k, rows = [], i, n;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    if (options) for (k in options) o[k] = options[k];

    for (i = 0; i < (candles || []).length; i++) {
      var c = candles[i], h = Number(c.high), l = Number(c.low), cl = Number(c.close);
      if (h > 0 && l > 0 && cl > 0) rows.push({ h: h, l: l, c: cl, time: c.time });
    }
    n = rows.length;
    if (n < 40) return { legs: [], lastTime: n ? rows[n - 1].time : null, price: n ? rows[n - 1].c : null };

    var price = rows[n - 1].c, seen = {}, legs = [], s;
    for (s = 0; s < o.scales.length; s++) {
      var g = lastLeg(rows, o.scales[s]);
      if (!g) continue;
      var key = g.L + '|' + g.H;
      if (seen[key]) continue;
      seen[key] = true;
      var span = g.H - g.L;
      if (!(g.H / g.L - 1 >= o.minLeg) || !(span > 0)) continue;

      var since = n - 1 - g.Hi, minLow = Infinity, j;
      for (j = g.Hi + 1; j < n; j++) if (rows[j].l < minLow) minLow = rows[j].l;
      var depth = (g.H - price) / span;

      var state;
      if (since < 1) state = 'DI_PUNCAK';
      else if (price < g.L || minLow < g.L) state = 'RUSAK';
      else if (depth < o.lo - o.tol) state = 'DANGKAL';
      else if (depth <= o.hi + o.tol) state = 'DI_ZONA';
      else state = 'LEWAT_ZONA';

      legs.push({
        scale: o.scales[s], L: round(g.L), H: round(g.H), legPct: Math.round((g.H / g.L - 1) * 100),
        since: since, stale: since > o.maxBars, depth: Math.round(depth * 100) / 100, state: state,
        invalidation: round(g.L),
        levels: o.levels.map(function (r) { return { r: r, price: round(g.H - r * span) }; })
      });
    }
    var RANK = { DI_ZONA: 0, DANGKAL: 1, LEWAT_ZONA: 2, DI_PUNCAK: 3, RUSAK: 4 };
    legs.sort(function (x, y) {
      var rx = RANK[x.state] + (x.stale ? 10 : 0), ry = RANK[y.state] + (y.stale ? 10 : 0);
      return (rx - ry) || (x.since - y.since);
    });
    return { legs: legs.slice(0, o.maxLegs), lastTime: rows[n - 1].time, price: price };
  }

  var LABEL = { DI_PUNCAK: 'Harga di swing high', RUSAK: 'Struktur rusak', DANGKAL: 'Retrace dangkal', DI_ZONA: 'Di zona retrace', LEWAT_ZONA: 'Melewati zona' };

  function summary(result) {
    if (!result || !result.legs.length) return 'Tidak ada leg naik aktif';
    var g = result.legs[0];
    return LABEL[g.state] + ' (' + Math.round(g.depth * 100) + '% dari ' + g.L + '-' + g.H + ')' + (g.stale ? ', leg lama' : '');
  }

  function apply(series, result) {
    var lines = [];
    function add(price, color, title, style) {
      lines.push(series.createPriceLine({ price: price, color: color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title: title }));
    }
    var colors = ['#ffb020', '#7aa2ff'];
    (result.legs || []).filter(function (g) { return g.state !== 'RUSAK'; }).forEach(function (g, idx) {
      var col = colors[idx % colors.length], tag = idx === 0 ? '' : ' b';
      add(g.H, '#d6dde3', 'H ' + g.H + tag, 2);
      g.levels.forEach(function (lv) { add(lv.price, col, 'R' + lv.r + tag, 2); });
      add(g.invalidation, '#ff4d4d', 'Invalidasi ' + g.invalidation + tag, 0);
    });
    return { remove: function () { lines.forEach(function (l) { try { series.removePriceLine(l); } catch (e) {} }); lines = []; } };
  }

  return { compute: compute, apply: apply, summary: summary, defaults: DEFAULTS };
});