"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateParticipation = evaluateParticipation;
function evaluateParticipation(input) {
    const { volumeRatio, valueRatio, frequencyRatio, persistence5d, } = input;
    const ratios = [
        volumeRatio,
        valueRatio,
        frequencyRatio,
    ].filter(Number.isFinite);
    if (!ratios.length) {
        return {
            state: "NEUTRAL",
            label: "Participation unavailable",
            explanation: "No valid participation ratio is available.",
        };
    }
    const expandedCount = ratios.filter(value => value >= 1.5).length;
    const contractingCount = ratios.filter(value => value < 0.75).length;
    const persistent = Number.isFinite(persistence5d) &&
        persistence5d >= 0.60;
    /*
     * Participation describes activity.
     * It is NOT treated as a standalone predictor.
     */
    if (expandedCount >= 2 &&
        (persistent || !Number.isFinite(persistence5d))) {
        return {
            state: "IMPROVING",
            label: "Participation improving",
            explanation: "Multiple trading-activity measures are materially above their recent baseline.",
        };
    }
    if (contractingCount >= 2) {
        return {
            state: "CONTRACTING",
            label: "Participation contracting",
            explanation: "Multiple trading-activity measures are below their recent baseline.",
        };
    }
    return {
        state: "NEUTRAL",
        label: "Normal participation",
        explanation: "Trading activity is not showing a decisive expansion or contraction.",
    };
}
