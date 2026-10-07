"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPreBreakout = detectPreBreakout;
/*
 * Pre-breakout: price coils just below the 20-session high inside an uptrend.
 * The thresholds are the untuned first-guess defaults that were checked in a
 * one-year backtest against a market baseline. Evidence is limited (one year,
 * one market regime), so treat this as information, not as a guarantee.
 */
const MAX_GAP = 0.04;
const MAX_COMPRESSION = 0.8;
const MAX_EXTENSION = 1.1;
const MIN_MEDIAN_VALUE = 1e9;
function detectPreBreakout(input) {
    const { close, previousHigh20, sma20, sma50, trCompression, medianValue20 } = input;
    const no = (explanation) => ({
        detected: false,
        setup: "BREAKOUT",
        label: "No pre-breakout",
        explanation,
    });
    if (!Number.isFinite(close) || close <= 0)
        return no("Valid closing price is required.");
    if (!Number.isFinite(previousHigh20) || previousHigh20 <= 0)
        return no("Resistance is unavailable.");
    const resistance = previousHigh20;
    const gap = (resistance - close) / resistance;
    const nearResistance = close < resistance && gap <= MAX_GAP;
    const trendUp = Number.isFinite(sma20) && Number.isFinite(sma50) && sma20 > sma50 && close > sma20;
    const compressed = Number.isFinite(trCompression) && trCompression <= MAX_COMPRESSION;
    const notExtended = Number.isFinite(sma20) && close <= sma20 * MAX_EXTENSION;
    const liquid = Number.isFinite(medianValue20) && medianValue20 >= MIN_MEDIAN_VALUE;
    if (!(nearResistance && trendUp && compressed && notExtended && liquid)) {
        return no("Pre-breakout conditions do not align.");
    }
    return {
        detected: true,
        setup: "BREAKOUT",
        label: "Pre-breakout",
        trigger: resistance,
        explanation: "Price is within 4% below the 20-session high in an uptrend with contracting volatility. Waiting for a close above the trigger.",
    };
}