"use strict";

/**
 * CHARTNALIST QBS Screener — Production Runner
 *
 * Engine: V3 (default) atau V4 (legacy, via env SCREENER_ENGINE=v4)
 * Spec:   docs/qbs-v3-spec.md
 */

const fs = require("fs");
const path = require("path");
const { runStockScreenerV3 } = require("./engine/screenerV3");
const { runStockScreener: runStockScreenerV4 } = require("./engine/screenerEngine");

const ENGINE = (process.env.SCREENER_ENGINE || "v3").toLowerCase();

async function runV3() {
    console.log("Engine: QBS V3 (Supportive only, A/B FULL, T+10 exit)");
    const result = await runStockScreenerV3({
        limitDays: 60,
        limit: 50,
    });

    // Map V3 fields -> UI-compatible fields
    const data = (result.data || []).map((s) => {
        const prev = s.prev_close || s.previousPrice || 0;
        const changePct =
            prev > 0 ? ((s.close - prev) / prev) * 100 : 0;

        return {
            // Identity
            ticker: s.ticker,
            symbol: s.ticker,
            date: s.date,

            // Prices
            open: s.open,
            high: s.high,
            low: s.low,
            close: s.close,
            price: s.close,

            // Volume / Value
            volume: s.volume,
            value: s.value,

            // Change
            changePct: changePct,

            // UI metrics (legacy compatible)
            closePositionPct: (s.close_pos || 0) * 100,
            priceRange20Pct: null,
            bbWidthPct: null,
            volumeSurge: null,
            frequencySurge: null,

            // QBS V3 specific
            qbs_label: s.label,
            qbs_action: s.action,
            qbs_size: s.size,
            qbs_deepFib: s.deepFib,
            qbs_regime: result.regime,
            exit_target: "T+10",

            // Compatibility aliases
            signal: s.label ? "QBS_" + s.label : "QBS",
            status: "active",
            profile: null,

            // Nested features (untuk UI yang baca features.*)
            features: {
                closePosition: s.close_pos,
                fibRatio: s.fib_ratio,
                rvol5d: s.rvol_5d,
                fnet1d: s.fnet_1d,
                fnet3d: s.fnet_3d,
                swingHigh20d: s.swing_high_20d,
                swingLow20d: s.swing_low_20d,
                high10d: s.high_10d,
            },
        };
    });

    return {
        status: "success",
        engine: "v3",
        regime: result.regime,
        regimeDetails: result.regimeDetails,
        lastSync: new Date().toLocaleString("id-ID"),
        total: data.length,
        data: data,
    };
}

async function runV4() {
    console.log("Engine: QBS V4 (legacy)");
    const results = await runStockScreenerV4({
        limitDays: 600,
        limit: 50,
    });

    return {
        status: "success",
        engine: "v4",
        regime: "legacy",
        regimeDetails: null,
        lastSync: new Date().toLocaleString("id-ID"),
        total: results.length,
        data: results,
    };
}

async function main() {
    console.log("============================================================");
    console.log("CHARTNALIST QBS SCREENER");
    console.log("Engine : " + ENGINE);
    console.log("============================================================");
    console.log("");

    let payload;
    try {
        payload = ENGINE === "v4" ? await runV4() : await runV3();
    } catch (err) {
        console.error("Screener gagal:", err.message);
        process.exitCode = 1;
        return;
    }

    console.log("");
    console.log("Total signals: " + payload.total);
    console.log("Regime       : " + payload.regime);
    console.log("");

    const targets = [
        path.join(__dirname, "../screener_results.json"),
        path.join(__dirname, "../public/screener_results.json"),
        path.join(__dirname, "../results/screener_results.json"),
        path.join(__dirname, "../public/results/screener_results.json"),
    ];

    for (const location of targets) {
        try {
            const dir = path.dirname(location);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(
                location,
                JSON.stringify(payload, null, 2),
                "utf8"
            );
            console.log("Written: " + location);
        } catch (error) {
            console.error("Gagal menulis " + location + ":", error.message);
        }
    }

    console.log("");
    console.log("File screener_results.json berhasil diperbarui.");
}

main().catch((error) => {
    console.error("");
    console.error("QBS Screener gagal:");
    console.error(error);
    process.exitCode = 1;
});