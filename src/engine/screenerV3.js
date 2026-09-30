"use strict";

/**
 * CHARTNALIST - QBS Screener V3 (Standalone)
 *
 * Policy: docs/qbs-v3-spec.md
 * Regime: Supportive only
 * Label:  A & B -> FULL | C -> SKIP
 * Exit:   Close T+10 (hard time-stop)
 *
 * Input:  fetchHistoricalDataFromSupabase()
 * Output: { status, regime, regimeDetails, total, data }
 */

const {
    fetchHistoricalDataFromSupabase,
} = require("../database/supabaseDataPipeline");

const qbsV3 = require("../lib/qbs-v3");

const MIN_LOOKBACK = 25;
const MAX_ROWS_PER_STOCK = 60;

function computeFeatures(rows) {
    if (!rows || rows.length < MIN_LOOKBACK) return null;

    const i = rows.length - 1;
    const r = rows[i];
    const hist = rows.slice(0, i + 1);

    // Close position hari terakhir
    const cp =
        r.high === r.low
            ? 0
            : (r.close - r.low) / (r.high - r.low);

    // CPos 3d max (dari 3 hari terakhir)
    const last3 = hist.slice(-3);
    const cp3d = Math.max(
        ...last3.map((x) =>
            x.high === x.low
                ? 0
                : (x.close - x.low) / (x.high - x.low)
        )
    );

    // Swing 20d
    const last20 = hist.slice(-20);
    const sh = Math.max(...last20.map((x) => x.high));
    const sl = Math.min(...last20.map((x) => x.low));
    const rng = sh - sl;
    const fib = rng === 0 ? 0 : (sh - r.close) / rng;

    // High 10d untuk koreksi
    const high10 = Math.max(...hist.slice(-10).map((x) => x.high));

    // RVOL 5d
    const vol5 =
        hist.slice(-5).reduce((a, x) => a + x.volume, 0) / 5;
    const rvol = vol5 === 0 ? 0 : r.volume / vol5;

    // Foreign net (per row sudah tersedia: foreignNet)
    const fnet1 = r.foreignNet || 0;
    const fnet3 = hist
        .slice(-3)
        .reduce((a, x) => a + (x.foreignNet || 0), 0);

    return {
        date: r.date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        prev_close: r.previousPrice,
        volume: r.volume,
        value: r.value,
        bid_volume: r.bidVolume || 0,
        offer_volume: r.offerVolume || 0,
        close_pos: cp,
        close_pos_3d_max: cp3d,
        swing_high_20d: sh,
        swing_low_20d: sl,
        fib_ratio: fib,
        high_10d: high10,
        rvol_5d: rvol,
        fnet_1d: fnet1,
        fnet_3d: fnet3,
    };
}

async function runStockScreenerV3(options) {
    const opts = options || {};
    const limitDays = Number.isFinite(Number(opts.limitDays))
        ? Number(opts.limitDays)
        : MAX_ROWS_PER_STOCK;
    const limit = Number.isFinite(Number(opts.limit))
        ? Number(opts.limit)
        : 50;

    console.log("");
    console.log("============================================================");
    console.log("CHARTNALIST QBS SCREENER V3");
    console.log("============================================================");
    console.log("Policy       : Supportive only, A/B FULL, C SKIP");
    console.log("Exit target  : T+10 (hard time-stop)");
    console.log("History days : " + limitDays);
    console.log("");

    const db = await fetchHistoricalDataFromSupabase({ limitDays });
    if (!db || typeof db !== "object") {
        console.log("Database kosong / tidak tersedia.");
        return {
            status: "error",
            regime: null,
            regimeDetails: null,
            total: 0,
            data: [],
        };
    }

    const allLatest = [];
    const candidates = [];

    for (const ticker of Object.keys(db)) {
        const rows = db[ticker];
        const feat = computeFeatures(rows);
        if (!feat) continue;

        const stock = Object.assign({ ticker: ticker }, feat);
        allLatest.push(stock);

        if (qbsV3.passesFilter(stock)) {
            candidates.push(stock);
        }
    }

    console.log("Tickers loaded    : " + Object.keys(db).length);
    console.log("Features computed : " + allLatest.length);
    console.log("Filter passed     : " + candidates.length);

    const regime = qbsV3.classifyRegime(allLatest);

    console.log("Regime            : " + regime.regime);
    console.log(
        "  pctUp           : " + (regime.pctUp * 100).toFixed(1) + "%"
    );
    console.log(
        "  meanFnet        : " + Math.round(regime.meanFnet)
    );
    console.log("  universeSize    : " + regime.universeSize);
    console.log("");

    if (regime.regime !== "Supportive") {
        console.log(
            "Market NON-SUPPORTIVE. V3 policy = SKIP semua signal."
        );
        return {
            status: "success",
            regime: regime.regime,
            regimeDetails: regime,
            total: 0,
            data: [],
        };
    }

    const signals = candidates
        .map((c) => {
            const result = qbsV3.evaluateStock(c, regime.regime);
            return Object.assign({}, c, {
                action: result.action,
                label: result.label,
                size: result.size,
                deepFib: result.deepFib,
                filterPass: result.filterPass,
                failReasons: result.failReasons,
            });
        })
        .filter((c) => c.action !== "SKIP")
        .sort((a, b) => {
            // Sort by: label A > B, lalu close_pos_3d_max desc
            if (a.label !== b.label) {
                return a.label < b.label ? -1 : 1;
            }
            return b.close_pos_3d_max - a.close_pos_3d_max;
        })
        .slice(0, limit);

    console.log("Signals (post-policy): " + signals.length);
    console.log("");

    return {
        status: "success",
        regime: regime.regime,
        regimeDetails: regime,
        total: signals.length,
        data: signals,
    };
}

module.exports = { runStockScreenerV3, computeFeatures };