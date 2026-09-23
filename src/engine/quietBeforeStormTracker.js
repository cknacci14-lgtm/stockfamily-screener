const {
    fetchHistoricalDataFromSupabase
} = require("../database/supabaseDataPipeline");

const {
    runQuietBeforeStorm
} = require("./quietBeforeStorm");

function evaluateSignal(history, h0Index, entryClose) {
    const future = history.slice(
        h0Index + 1,
        h0Index + 4
    );

    const result = {
        h1: null,
        h2: null,
        h3: null,
        complete: future.length >= 3,
        high20: false,
        close20: false,
        maxHigh: null,
        maxClose: null,
        minLow: null
    };

    if (!future.length) {
        return result;
    }

    const highReturns = [];
    const closeReturns = [];
    const lowReturns = [];

    future.forEach(row => {
        const high =
            Number(row.high || 0);

        const close =
            Number(row.close || 0);

        const low =
            Number(row.low || 0);

        highReturns.push(
            ((high / entryClose) - 1) * 100
        );

        closeReturns.push(
            ((close / entryClose) - 1) * 100
        );

        lowReturns.push(
            ((low / entryClose) - 1) * 100
        );
    });

    if (future[0]) {
        result.h1 = {
            date: future[0].date,
            high: highReturns[0],
            close: closeReturns[0],
            low: lowReturns[0]
        };
    }

    if (future[1]) {
        result.h2 = {
            date: future[1].date,
            high: highReturns[1],
            close: closeReturns[1],
            low: lowReturns[1]
        };
    }

    if (future[2]) {
        result.h3 = {
            date: future[2].date,
            high: highReturns[2],
            close: closeReturns[2],
            low: lowReturns[2]
        };
    }

    result.maxHigh =
        Math.max(...highReturns);

    result.maxClose =
        Math.max(...closeReturns);

    result.minLow =
        Math.min(...lowReturns);

    result.high20 =
        result.maxHigh >= 20;

    result.close20 =
        result.maxClose >= 20;

    return result;
}

async function runQuietBeforeStormTracker(options) {
    const opts = options || {};

    const db =
        opts.db ||
        await fetchHistoricalDataFromSupabase({
            limitDays:
                opts.limitDays || 600
        });

    if (!db) {
        return [];
    }

    const signalDates =
        opts.targetDate
            ? [opts.targetDate]
            : Object.keys(db)
                .flatMap(symbol =>
                    db[symbol]
                        .map(row => row.date)
                )
                .filter(Boolean);

    const uniqueDates =
        [...new Set(signalDates)]
            .sort();

    const records = [];

    for (const targetDate of uniqueDates) {
        const screener =
            await runQuietBeforeStorm({
                db,
                targetDate
            });

        for (const signal of screener.results) {
            const history =
                db[signal.symbol];

            const h0Index =
                history.findIndex(
                    row =>
                        row.date === targetDate
                );

            if (h0Index < 0) {
                continue;
            }

            const evaluation =
                evaluateSignal(
                    history,
                    h0Index,
                    signal.close
                );

            records.push({
                symbol: signal.symbol,
                signal: signal.signal,
                h0Date: targetDate,
                h0Close: signal.close,

                bbWidth: signal.bbWidth,
                priceRange20:
                    signal.priceRange20,

                volumeSurge:
                    signal.volumeSurge,

                frequencySurge:
                    signal.frequencySurge,

                value: signal.value,

                ...evaluation
            });
        }
    }

    return records;
}

module.exports = {
    runQuietBeforeStormTracker,
    evaluateSignal
};