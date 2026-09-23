const {
    fetchHistoricalDataFromSupabase
} = require("../database/supabaseDataPipeline");

function average(values) {
    if (!values.length) return 0;

    return values.reduce(
        (sum, value) => sum + value,
        0
    ) / values.length;
}

function standardDeviation(values) {
    if (!values.length) return 0;

    const mean = average(values);

    const variance =
        values.reduce(
            (sum, value) =>
                sum + Math.pow(value - mean, 2),
            0
        ) / values.length;

    return Math.sqrt(variance);
}

function calculateFeatures(history, index) {
    if (index < 20) {
        return null;
    }

    const h0 = history[index];

    const previous20 =
        history.slice(index - 20, index);

    if (previous20.length !== 20) {
        return null;
    }

    const closes =
        previous20.map(
            row => Number(row.close || 0)
        );

    if (closes.some(value => value <= 0)) {
        return null;
    }

    const meanClose =
        average(closes);

    if (meanClose <= 0) {
        return null;
    }

    const sd =
        standardDeviation(closes);

    const bbWidth =
        (4 * sd) / meanClose;

    const highest20 =
        Math.max(
            ...previous20.map(
                row => Number(row.high || 0)
            )
        );

    const lowest20 =
        Math.min(
            ...previous20.map(
                row => Number(row.low || 0)
            )
        );

    if (lowest20 <= 0) {
        return null;
    }

    const priceRange20 =
        (highest20 - lowest20) /
        lowest20;

    const avgVolume20 =
        average(
            previous20.map(
                row => Number(row.volume || 0)
            )
        );

    const avgFrequency20 =
        average(
            previous20.map(
                row => Number(row.frequency || 0)
            )
        );

    if (
        avgVolume20 <= 0 ||
        avgFrequency20 <= 0
    ) {
        return null;
    }

    const close =
        Number(h0.close || 0);

    const high =
        Number(h0.high || 0);

    const low =
        Number(h0.low || 0);

    const value =
        Number(h0.value || 0);

    const volume =
        Number(h0.volume || 0);

    const frequency =
        Number(h0.frequency || 0);

    const previousPrice =
        Number(h0.previousPrice || 0);

    const volumeSurge =
        volume / avgVolume20;

    const frequencySurge =
        frequency / avgFrequency20;

    const changePct =
        previousPrice > 0
            ? ((close - previousPrice) /
                previousPrice) * 100
            : 0;

    const closePosition =
        high > low
            ? (close - low) /
                (high - low)
            : 0;

    return {
        date: h0.date,

        close,
        high,
        low,
        value,
        volume,
        frequency,

        previousPrice,

        changePct,

        bbWidth:
            Number(bbWidth.toFixed(6)),

        priceRange20:
            Number(priceRange20.toFixed(6)),

        volumeSurge:
            Number(volumeSurge.toFixed(4)),

        frequencySurge:
            Number(frequencySurge.toFixed(4)),

        closePosition:
            Number(closePosition.toFixed(4))
    };
}

function qualifies(features) {
    if (!features) {
        return false;
    }

    return (
        features.close >= 100 &&
        features.value >= 2000000000 &&
        features.bbWidth < 0.06 &&
        features.priceRange20 < 0.15 &&
        features.volumeSurge >= 6 &&
        features.frequencySurge >= 5
    );
}

function findDateIndex(history, targetDate) {
    return history.findIndex(
        row => row.date === targetDate
    );
}

function detectLatestTradingDate(db) {
    let latestDate = null;

    for (const symbol of Object.keys(db)) {
        const history = db[symbol];

        if (!history || !history.length) {
            continue;
        }

        for (const row of history) {
            if (!row.date) {
                continue;
            }

            if (
                latestDate === null ||
                row.date > latestDate
            ) {
                latestDate = row.date;
            }
        }
    }

    return latestDate;
}

async function runQuietBeforeStorm(options) {
    const opts = options || {};

    const db =
        opts.db ||
        await fetchHistoricalDataFromSupabase({
            limitDays:
                opts.limitDays || 600
        });

    if (!db) {
        return {
            targetDate: null,
            totalUniverse: 0,
            results: []
        };
    }

    const targetDate =
        opts.targetDate ||
        detectLatestTradingDate(db);

    if (!targetDate) {
        return {
            targetDate: null,
            totalUniverse:
                Object.keys(db).length,
            results: []
        };
    }

    const results = [];

    for (const symbol of Object.keys(db)) {
        const history = db[symbol];

        if (!history || history.length < 21) {
            continue;
        }

        const index =
            findDateIndex(
                history,
                targetDate
            );

        if (index < 20) {
            continue;
        }

        const features =
            calculateFeatures(
                history,
                index
            );

        if (!qualifies(features)) {
            continue;
        }

        results.push({
            symbol,

            signal:
                "QUIET_BEFORE_STORM",

            ...features,

            h0Index: index
        });
    }

    results.sort((a, b) => {
        if (
            b.volumeSurge !==
            a.volumeSurge
        ) {
            return (
                b.volumeSurge -
                a.volumeSurge
            );
        }

        if (
            b.frequencySurge !==
            a.frequencySurge
        ) {
            return (
                b.frequencySurge -
                a.frequencySurge
            );
        }

        return b.value - a.value;
    });

    return {
        targetDate,

        totalUniverse:
            Object.keys(db).length,

        results
    };
}

module.exports = {
    runQuietBeforeStorm,
    calculateFeatures,
    qualifies,
    detectLatestTradingDate,
    findDateIndex
};