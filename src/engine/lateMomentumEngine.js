"use strict";
/**
 * Late Momentum Engine (rumus longgar, EKSPERIMENTAL - belum terbukti)
 * Backtest 20 Okt 2026: naik 58% besok / 52% 3 hari (53% / 43% sejak Jul 2026); edge hilang bila masuk di open T+1. Lihat scripts/backtest-late-momentum.js
 *
 * Rules (all must pass):
 *  pos_3 === 3
 *  close_loc_3 > 0.70
 *  vol_ratio > 1.5
 *  0.10 < ret_3d < 0.35
 *  foreign_part < 0.15
 *  volume >= 200000
 *  bid_offer_imb > 0
 */
const {
  fetchHistoricalDataFromSupabase,
} = require("../database/supabaseDataPipeline");

const MIN_LOOKBACK = 8;
const MAX_ROWS = 60;
const MIN_VOLUME = 200000;

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function computeRowFeatures(rows) {
  if (!rows || rows.length < MIN_LOOKBACK) return null;
  const i = rows.length - 1;
  const r = rows[i];
  const close = num(r.close);
  const high = num(r.high);
  const low = num(r.low);
  const volume = num(r.volume);
  if (close <= 0 || high <= 0 || low <= 0 || volume <= 0) return null;

  const closes = rows.map((x) => num(x.close));
  const vols = rows.map((x) => num(x.volume));

  const ret1 = (idx) => {
    if (idx < 1) return null;
    const prev = closes[idx - 1];
    return prev > 0 ? closes[idx] / prev - 1 : null;
  };

  const r0 = ret1(i);
  const r1 = ret1(i - 1);
  const r2 = ret1(i - 2);
  if (r0 == null || r1 == null || r2 == null) return null;

  const pos_3 =
    (r0 > 0 ? 1 : 0) + (r1 > 0 ? 1 : 0) + (r2 > 0 ? 1 : 0);

  const close3 = i >= 3 ? closes[i - 3] : null;
  const ret_3d = close3 > 0 ? close / close3 - 1 : null;
  if (ret_3d == null) return null;

  const loc = (row) => {
    const h = num(row.high);
    const l = num(row.low);
    const c = num(row.close);
    return h === l ? 0 : (c - l) / (h - l);
  };
  const close_loc_3 =
    (loc(rows[i]) + loc(rows[i - 1]) + loc(rows[i - 2])) / 3;

  const ma5 = vols.slice(Math.max(0, i - 4), i + 1);
  const avg5 = ma5.reduce((a, b) => a + b, 0) / ma5.length;
  const vol_ratio = avg5 > 0 ? volume / avg5 : 0;

  const fb = num(r.foreign_buy ?? r.foreignBuy);
  const fs = num(r.foreign_sell ?? r.foreignSell);
  const foreign_part = volume > 0 ? (fb + fs) / volume : 0;

  const bid = num(r.bid_volume ?? r.bidVolume);
  const offer = num(r.offer_volume ?? r.offerVolume);
  const bid_offer_imb =
    bid + offer > 0 ? (bid - offer) / (bid + offer) : 0;

  const prevClose = num(r.previous_price ?? r.previousPrice ?? closes[i - 1]);
  const ticker =
    r.ticker || r.code || r.symbol || String(r.stock_id || r.stockId || "");

  return {
    ticker,
    date: r.trade_date || r.date || r.tradeDate,
    open: num(r.open),
    high,
    low,
    close,
    prev_close: prevClose,
    volume,
    pos_3,
    ret_1d: r0,
    ret_3d,
    close_loc: loc(rows[i]),
    close_loc_3,
    vol_ratio,
    foreign_part,
    bid_offer_imb,
  };
}

function passesLonggar(f) {
  return (
    f.pos_3 === 3 &&
    f.close_loc_3 > 0.7 &&
    f.vol_ratio > 1.5 &&
    f.ret_3d > 0.1 &&
    f.ret_3d < 0.35 &&
    f.foreign_part < 0.15 &&
    f.volume >= MIN_VOLUME &&
    f.bid_offer_imb > 0
  );
}

/** Map to fields public/screener.html already understands */
function toUiRow(f) {
  const changePct =
    f.prev_close > 0 ? ((f.close - f.prev_close) / f.prev_close) * 100 : 0;
  return {
    ticker: f.ticker,
    symbol: f.ticker,
    date: f.date,
    open: f.open,
    high: f.high,
    low: f.low,
    close: f.close,
    confirm_close: f.close,
    prev_close: f.prev_close,
    change_pct: Number(changePct.toFixed(2)),
    volume: f.volume,
    closePositionPct: Number((f.close_loc * 100).toFixed(1)),
    close_loc_3: Number(f.close_loc_3.toFixed(3)),
    vol_ratio: Number(f.vol_ratio.toFixed(2)),
    ret_1d_pct: Number((f.ret_1d * 100).toFixed(2)),
    ret_3d_pct: Number((f.ret_3d * 100).toFixed(2)),
    foreign_part_pct: Number((f.foreign_part * 100).toFixed(1)),
    bid_offer_imb: Number(f.bid_offer_imb.toFixed(3)),
    setup: "LATE_MOMENTUM",
    label: "LATE MOMENTUM",
    engine: "late_momentum_longgar_v1",
  };
}

async function runLateMomentumScreener(options = {}) {
  const limitDays = options.limitDays || MAX_ROWS;
  const hist = await fetchHistoricalDataFromSupabase({
    limitDays,
    ...(options.targetDate ? { targetDate: options.targetDate } : {}),
  });

  // hist expected: { [ticker]: rows[] } or array of stocks — normalize
  let groups = [];
  if (Array.isArray(hist)) {
    const by = new Map();
    for (const row of hist) {
      const k = row.ticker || row.code || row.stock_id || row.stockId;
      if (!k) continue;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(row);
    }
    groups = [...by.entries()];
  } else if (hist && typeof hist === "object") {
    if (hist.data && typeof hist.data === "object") {
      groups = Object.entries(hist.data);
    } else {
      groups = Object.entries(hist);
    }
  }

  // Patch 45: tanggal data terbaru di seluruh saham. Saham tanpa baris pada tanggal itu tidak dinilai.
  const rowDate = (r) => String(r.trade_date || r.date || r.tradeDate || "").slice(0, 10);
  let latestDate = "";
  for (const [, rows] of groups) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) { const d = rowDate(r); if (d > latestDate) latestDate = d; }
  }

  const signals = [];
  for (const [key, rows] of groups) {
    if (!Array.isArray(rows) || rows.length < MIN_LOOKBACK) continue;
    const sorted = [...rows].sort(
      (a, b) =>
        new Date(a.trade_date || a.date || a.tradeDate) -
        new Date(b.trade_date || b.date || b.tradeDate)
    );
    const slice = sorted.slice(-limitDays);
    const f = computeRowFeatures(slice);
    if (!f) continue;
    if (latestDate && String(f.date || "").slice(0, 10) !== latestDate) continue;
    if (!f.ticker) f.ticker = String(key);
    if (passesLonggar(f)) signals.push(toUiRow(f));
  }

    signals.sort((a, b) => (b.ret_3d_pct || 0) - (a.ret_3d_pct || 0));

  // Tanggal scan = tanggal baris terakhir di data (meski 0 sinyal)
  let scanDate = latestDate || signals[0]?.date || null;
  if (!scanDate) {
    for (const [, rows] of groups) {
      if (!Array.isArray(rows) || !rows.length) continue;
      const sorted = [...rows].sort(
        (a, b) =>
          new Date(a.trade_date || a.date || a.tradeDate) -
          new Date(b.trade_date || b.date || b.tradeDate)
      );
      const d = sorted[sorted.length - 1]?.date
        || sorted[sorted.length - 1]?.trade_date
        || sorted[sorted.length - 1]?.tradeDate;
      if (d && (!scanDate || new Date(d) > new Date(scanDate))) scanDate = d;
    }
  }

  return {
    status: "ok",
    engine: "late_momentum_longgar_v1",
    formula: "pos3 + closeLoc3>0.70 + vol>1.5 + ret3d 10-35% + foreign<15% + vol>=200k + bidImb>0",
    validation: "Eksperimental. Backtest 2025-09 s/d 2026-10: naik 58% besok, edge hilang bila masuk di open T+1. Forward test berjalan.",
    total: signals.length,
    scan_date: scanDate,
    scanDate: scanDate,
    data: signals,
    results: signals,
    signals,
  };
}

module.exports = { runLateMomentumScreener, passesLonggar, computeRowFeatures };