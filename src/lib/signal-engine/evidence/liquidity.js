"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateLiquidity = evaluateLiquidity;
function evaluateLiquidity(input) {
    const { value, frequency, volume, downsideDeviation, historyDays, } = input;
    const validValue = Number.isFinite(value) && value > 0;
    const validFrequency = Number.isFinite(frequency) && frequency > 0;
    const validVolume = Number.isFinite(volume) && volume > 0;
    if (!validValue && !validFrequency && !validVolume) {
        return {
            state: "HIGH_RISK",
            label: "Liquidity unavailable",
            explanation: "Insufficient liquidity data to assess tradability.",
        };
    }
    /*
     * These are execution-quality checks,
     * not predictive signals.
     *
     * Conservative baseline:
     * Value      >= Rp10B
     * Frequency  >= 1,500
     * Volume     > 0
     * History    >= 60 trading days
     */
    const valueHealthy = validValue && value >= 10000000000;
    const frequencyHealthy = validFrequency && frequency >= 1500;
    const volumeHealthy = validVolume;
    const historyHealthy = !Number.isFinite(historyDays) ||
        historyDays >= 60;
    if (valueHealthy &&
        frequencyHealthy &&
        volumeHealthy &&
        historyHealthy) {
        return {
            state: "HEALTHY",
            label: "Healthy liquidity",
            explanation: "Trading value, frequency, volume, and available history meet the minimum execution-quality baseline.",
        };
    }
    /*
     * A stock that fails the baseline is not
     * automatically rejected. It is simply flagged
     * because execution risk is higher.
     */
    if ((validValue && value < 2000000000) ||
        (validFrequency && frequency < 500)) {
        return {
            state: "THIN",
            label: "Thin liquidity",
            explanation: "Trading activity is materially below the minimum liquidity baseline.",
        };
    }
    return {
        state: "HIGH_RISK",
        label: "Elevated liquidity risk",
        explanation: "One or more execution-quality measures are below the preferred baseline.",
    };
}
