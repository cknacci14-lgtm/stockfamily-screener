const fs = require("fs");
const path = require("path");
const Module = require("module");

const {
    fetchHistoricalDataFromSupabase,
} = require("../database/supabaseDataPipeline");

const CANONICAL_PATH = path.join(
    __dirname,
    "../../scripts/qbs-cross-stock-cross-sectional-v4.9.1.js"
);

function loadCanonicalQbs() {
    const source = fs.readFileSync(CANONICAL_PATH, "utf8");

    const cliMarker = "\nmain().catch(";
    const cliIndex = source.lastIndexOf(cliMarker);

    if (cliIndex === -1) {
        throw new Error(
            "Canonical QBS V4.9.1: marker main().catch(...) tidak ditemukan."
        );
    }

    const librarySource = source.slice(0, cliIndex);

    const exportBlock = `

module.exports = {
    prepareDatabase,
    buildDateIndex,
    detectQbs,
    calculateFeatures,
    buildH0Profile,
    buildOutcome,
    qualifies,
};
`;

    const executable =
        `${librarySource}\n${exportBlock}\n`;

    /*
     * Buat require yang resolusinya berasal dari file canonical,
     * bukan dari src/engine/screenerEngine.js.
     */
    const canonicalModule =
        new Module(CANONICAL_PATH, module);

    canonicalModule.filename =
        CANONICAL_PATH;

    canonicalModule.paths =
        Module._nodeModulePaths(
            path.dirname(CANONICAL_PATH)
        );

    const canonicalRequire =
        Module.createRequire(CANONICAL_PATH);

    const moduleObject = {
        exports: {},
    };

    const fn = new Function(
        "module",
        "exports",
        "require",
        "__dirname",
        "__filename",
        executable
    );

    fn(
        moduleObject,
        moduleObject.exports,
        canonicalRequire,
        path.dirname(CANONICAL_PATH),
        CANONICAL_PATH
    );

    const requiredFunctions = [
        "prepareDatabase",
        "buildDateIndex",
        "detectQbs",
        "calculateFeatures",
        "buildH0Profile",
        "buildOutcome",
        "qualifies",
    ];

    for (const name of requiredFunctions) {
        if (
            typeof moduleObject.exports[name] !==
            "function"
        ) {
            throw new Error(
                `Canonical QBS V4.9.1: fungsi ${name} tidak berhasil diexport.`
            );
        }
    }

    return moduleObject.exports;
}

function finiteNumber(value) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}

function normalizeDate(value) {
    if (!value) return null;

    if (
        value instanceof Date &&
        !Number.isNaN(value.getTime())
    ) {
        return value
            .toISOString()
            .slice(0, 10);
    }

    const text =
        String(value).trim();

    const isoMatch =
        text.match(/^(\d{4}-\d{2}-\d{2})/);

    if (isoMatch) {
        return isoMatch[1];
    }

    const date =
        new Date(text);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date
        .toISOString()
        .slice(0, 10);
}

function buildScreenerRow(event) {
    const pair =
        event?.pair ||
        event ||
        {};

    const features =
        event?.features ||
        pair?.features ||
        event?.candidateSnapshot?.features ||
        {};

    const h0 =
        features?.h0 ||
        event?.h0 ||
        event?.candidateSnapshot?.h0 ||
        {};

    const ticker =
        pair?.ticker ||
        event?.ticker ||
        event?.candidateSnapshot?.ticker ||
        null;

    const eventDate =
        normalizeDate(
            pair?.eventDate ||
            event?.eventDate ||
            event?.candidateSnapshot?.eventDate
        );

    const profile =
        event?.profile ||
        event?.candidateSnapshot?.profile ||
        {};

    const close =
        finiteNumber(
            h0.close ??
            h0.Close ??
            profile.close
        );

    const previousPrice =
        finiteNumber(
            h0.previousPrice ??
            h0.previous_price ??
            h0.previous ??
            profile.previousPrice
        );

    const open =
        finiteNumber(
            h0.open ??
            h0.Open
        );

    const high =
        finiteNumber(
            h0.high ??
            h0.High
        );

    const low =
        finiteNumber(
            h0.low ??
            h0.Low
        );

    const value =
        finiteNumber(
            h0.value ??
            h0.Value ??
            h0.transactionValue ??
            profile.value
        );

    const volume =
        finiteNumber(
            h0.volume ??
            h0.Volume ??
            profile.volume
        );

    const frequency =
        finiteNumber(
            h0.frequency ??
            h0.Frequency ??
            profile.frequency
        );

    const changePrice =
        finiteNumber(
            h0.changePrice ??
            h0.change_price ??
            h0.change
        );

    let changePct =
        finiteNumber(
            features.changePct ??
            h0.changePct ??
            profile.changePct
        );

    if (
        changePct === null &&
        previousPrice !== null &&
        previousPrice !== 0 &&
        close !== null
    ) {
        changePct =
            ((close - previousPrice) /
                previousPrice) *
            100;
    }

    const volumeSurge =
        finiteNumber(
            features.volumeSurge
        );

    const frequencySurge =
        finiteNumber(
            features.frequencySurge
        );

    const bbWidth =
        finiteNumber(
            features.bbWidth
        );

    const priceRange20 =
        finiteNumber(
            features.priceRange20
        );

    const closePosition =
        finiteNumber(
            features.closePosition
        );

    return {
        ticker,
        date: eventDate,

        close,
        previousPrice,
        changePct,
        changePrice,

        open,
        high,
        low,

        value,
        volume,
        frequency,

        volumeSurge,
        frequencySurge,

        bbWidthPct:
            bbWidth === null
                ? null
                : bbWidth * 100,

        priceRange20Pct:
            priceRange20 === null
                ? null
                : priceRange20 * 100,

        closePositionPct:
            closePosition === null
                ? null
                : closePosition * 100,

        signal: "QBS",

        status: "QBS_DETECTED",

        eventId:
            event?.eventId ||
            pair?.eventId ||
            event?.candidateSnapshot?.eventId ||
            null,

        profile,
    };
}

async function runStockScreener(options) {
    const opts =
        options || {};

    const limitDays =
        Number.isFinite(
            Number(opts.limitDays)
        )
            ? Number(opts.limitDays)
            : 600;

    const limit =
        Number.isFinite(
            Number(opts.limit)
        )
            ? Number(opts.limit)
            : 50;

    console.log("");
    console.log(
        "============================================================"
    );
    console.log(
        "STOCKFAMILY QBS SCREENER V1.0.0"
    );
    console.log(
        "============================================================"
    );
    console.log(
        "Engine       : Canonical QBS V4.9.1"
    );
    console.log(
        "Formula      : LOCKED"
    );
    console.log(
        `History days : ${limitDays}`
    );
    console.log("");

    const db =
        await fetchHistoricalDataFromSupabase({
            limitDays,
        });

    if (
        !db ||
        typeof db !== "object"
    ) {
        console.log(
            "Database kosong / tidak tersedia."
        );

        return [];
    }

    const canonical =
        loadCanonicalQbs();

    console.log(
        `Database tickers : ${Object.keys(db).length}`
    );

    const preparedDatabase =
        canonical.prepareDatabase(db);

    const detection =
        canonical.detectQbs(
            preparedDatabase
        );

    const events =
        Array.isArray(
            detection?.events
        )
            ? detection.events
            : Array.isArray(detection)
                ? detection
                : [];

    console.log(
        `Canonical QBS events : ${events.length}`
    );

    if (events.length === 0) {
        console.log(
            "Tidak ada event QBS yang terdeteksi."
        );

        return [];
    }

    const eventDates =
        events
            .map((event) => {
                const pair =
                    event?.pair ||
                    event;

                return normalizeDate(
                    pair?.eventDate ||
                    event?.eventDate ||
                    event?.candidateSnapshot?.eventDate
                );
            })
            .filter(Boolean);

    const latestDate =
        eventDates.length > 0
            ? eventDates.reduce(
                (latest, current) =>
                    current > latest
                        ? current
                        : latest
            )
            : null;

    console.log(
        `Latest QBS date      : ${latestDate || "N/A"}`
    );

    const latestEvents =
        latestDate
            ? events.filter(
                (event) => {
                    const pair =
                        event?.pair ||
                        event;

                    const date =
                        normalizeDate(
                            pair?.eventDate ||
                            event?.eventDate ||
                            event?.candidateSnapshot?.eventDate
                        );

                    return (
                        date ===
                        latestDate
                    );
                }
            )
            : [];

    console.log(
        `Latest QBS matches   : ${latestEvents.length}`
    );

    const results =
        latestEvents
            .map(buildScreenerRow)
            .filter(
                (row) =>
                    row.ticker &&
                    row.date
            );

    results.sort(
        (a, b) => {
            const volumeA =
                a.volumeSurge ??
                -Infinity;

            const volumeB =
                b.volumeSurge ??
                -Infinity;

            if (
                volumeB !==
                volumeA
            ) {
                return (
                    volumeB -
                    volumeA
                );
            }

            const frequencyA =
                a.frequencySurge ??
                -Infinity;

            const frequencyB =
                b.frequencySurge ??
                -Infinity;

            if (
                frequencyB !==
                frequencyA
            ) {
                return (
                    frequencyB -
                    frequencyA
                );
            }

            return String(
                a.ticker
            ).localeCompare(
                String(
                    b.ticker
                )
            );
        }
    );

    const top =
        results.slice(
            0,
            limit
        );

    console.log("");
    console.log(
        `QBS Screener results : ${top.length}`
    );

    if (top.length > 0) {
        console.table(
            top.map(
                (row) => ({
                    ticker:
                        row.ticker,

                    date:
                        row.date,

                    close:
                        row.close,

                    changePct:
                        row.changePct !==
                        null
                            ? Number(
                                row.changePct
                            ).toFixed(2)
                            : null,

                    volumeSurge:
                        row.volumeSurge !==
                        null
                            ? Number(
                                row.volumeSurge
                            ).toFixed(2)
                            : null,

                    frequencySurge:
                        row.frequencySurge !==
                        null
                            ? Number(
                                row.frequencySurge
                            ).toFixed(2)
                            : null,

                    bbWidthPct:
                        row.bbWidthPct !==
                        null
                            ? Number(
                                row.bbWidthPct
                            ).toFixed(2)
                            : null,

                    priceRange20Pct:
                        row.priceRange20Pct !==
                        null
                            ? Number(
                                row.priceRange20Pct
                            ).toFixed(2)
                            : null,

                    closePositionPct:
                        row.closePositionPct !==
                        null
                            ? Number(
                                row.closePositionPct
                            ).toFixed(2)
                            : null,
                })
            )
        );
    }

    console.log("");
    console.log(
        "QBS V1.0.0 formula tetap menggunakan canonical V4.9.1."
    );
    console.log(
        "============================================================"
    );
    console.log("");

    return top;
}

module.exports = {
    runStockScreener,
};
