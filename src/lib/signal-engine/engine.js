"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateStockSignal = evaluateStockSignal;
const structure_1 = require("./evidence/structure");
const participation_1 = require("./evidence/participation");
const flow_1 = require("./evidence/flow");
const liquidity_1 = require("./evidence/liquidity");
const breakout_1 = require("./setups/breakout");
const pullback_1 = require("./setups/pullback");
const accumulation_1 = require("./setups/accumulation");
const trade_plan_1 = require("./risk/trade-plan");
const signal_status_1 = require("./signal-status");
function now() {
    return new Date().toISOString();
}
function neutralEvidence(label, explanation) {
    return {
        state: "NEUTRAL",
        label,
        explanation,
    };
}
function evaluateStockSignal(input) {
    const timestamp = now();
    const structure = (0, structure_1.evaluateStructure)({
        close: input.close,
        sma20: input.sma20,
        sma50: input.sma50,
        high20: input.high20,
        high52w: input.high52w,
        rangeRatio: input.rangeRatio,
        closePosition: input.closePosition,
        bodyPct: input.bodyPct,
    });
    const participation = (0, participation_1.evaluateParticipation)({
        volumeRatio: input.volumeRatio,
        valueRatio: input.valueRatio,
        frequencyRatio: input.frequencyRatio,
        persistence5d: input.persistence5d,
    });
    const flow = (0, flow_1.evaluateFlow)({
        foreignRatio: input.foreignRatio,
        foreignPersistence5d: input.foreignPersistence5d,
        netForeignValue: input.netForeignValue,
    });
    const liquidity = (0, liquidity_1.evaluateLiquidity)({
        value: input.value,
        frequency: input.frequency,
        volume: input.volume,
        downsideDeviation: input.downsideDeviation,
        historyDays: input.historyDays,
    });
    const breakout = (0, breakout_1.detectBreakout)({
        close: input.close,
        high20: input.high20,
        previousHigh20: input.previousHigh20,
        rangeRatio: input.rangeRatio,
        volumeRatio: input.volumeRatio,
        valueRatio: input.valueRatio,
        closePosition: input.closePosition,
        structure,
        participation,
        liquidity,
    });
    const pullback = (0, pullback_1.detectPullback)({
        close: input.close,
        sma20: input.sma20,
        sma50: input.sma50,
        recentHigh: input.recentHigh,
        pullbackPct: input.pullbackPct,
        rangeRatio: input.rangeRatio,
        volumeRatio: input.volumeRatio,
        closePosition: input.closePosition,
        structure,
        participation,
        liquidity,
    });
    const accumulation = (0, accumulation_1.detectAccumulation)({
        close: input.close,
        sma20: input.sma20,
        sma50: input.sma50,
        rangeRatio: input.rangeRatio,
        volumeRatio: input.volumeRatio,
        valueRatio: input.valueRatio,
        frequencyRatio: input.frequencyRatio,
        closePosition: input.closePosition,
        bodyPct: input.bodyPct,
        baseDays: input.baseDays,
        structure,
        participation,
        flow,
        liquidity,
    });
    /*
     * Setup selection.
     *
     * Priority:
     * BREAKOUT ? PULLBACK ? ACCUMULATION
     *
     * If nothing is confirmed:
     * setup = null
     * tradePlan = null
     * status = OBSERVE
     */
    let setup = null;
    let setupDetected = false;
    let trigger;
    if (breakout.detected) {
        setup = "BREAKOUT";
        setupDetected = true;
        trigger = breakout.trigger;
    }
    else if (pullback.detected) {
        setup = "PULLBACK";
        setupDetected = true;
        trigger = pullback.trigger;
    }
    else if (accumulation.detected) {
        setup = "ACCUMULATION";
        setupDetected = true;
        trigger = accumulation.trigger;
    }
    /*
     * No confirmed setup means there is no trade plan.
     */
    const tradePlan = setupDetected && setup
        ? (0, trade_plan_1.buildTradePlan)({
            close: input.close,
            setup,
            trigger,
            support: input.sma50,
            resistance: input.high20,
            recentLow: input.recentLow,
            recentHigh: input.recentHigh,
            atr: input.atr,
        })
        : null;
    /*
     * Trigger semantics are setup-specific.
     *
     * BREAKOUT:
     *   close must be above trigger.
     *
     * PULLBACK:
     *   trigger is the trend reference and price must
     *   reclaim/hold it.
     *
     * ACCUMULATION:
     *   no automatic trigger.
     *   It remains WATCH until a future trigger event.
     */
    let triggerReached = false;
    if (setup === "BREAKOUT" &&
        Number.isFinite(trigger)) {
        triggerReached =
            input.close > trigger;
    }
    if (setup === "PULLBACK" &&
        Number.isFinite(trigger)) {
        triggerReached =
            input.close >= trigger &&
                structure.state !== "BEARISH";
    }
    /*
     * Accumulation intentionally remains WATCH.
     */
    if (setup === "ACCUMULATION") {
        triggerReached = false;
    }
    const invalidated = setupDetected &&
        tradePlan !== null &&
        Number.isFinite(tradePlan.invalidation) &&
        input.close <= tradePlan.invalidation;
    const status = (0, signal_status_1.determineInitialStatus)({
        setup: setup ?? "ACCUMULATION",
        detected: setupDetected,
        triggerReached,
        invalidated,
    });
    const signal = {
        stockCode: input.stockCode,
        stockName: input.stockName,
        setup,
        status,
        structure: structure ??
            neutralEvidence("Structure unavailable", "Structure evidence unavailable."),
        participation: participation ??
            neutralEvidence("Participation unavailable", "Participation evidence unavailable."),
        flow: flow ??
            neutralEvidence("Flow unavailable", "Flow evidence unavailable."),
        liquidity: liquidity ??
            neutralEvidence("Liquidity unavailable", "Liquidity evidence unavailable."),
        tradePlan,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    return {
        signal,
        setups: {
            breakout: breakout.detected,
            pullback: pullback.detected,
            accumulation: accumulation.detected,
        },
    };
}
