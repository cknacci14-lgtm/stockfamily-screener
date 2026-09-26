"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitionSignalState = transitionSignalState;
/*
 * StockFamily signal lifecycle:
 *
 * OBSERVE
 *    ↓
 * WATCH
 *    ↓
 * TRIGGERED
 *    ↓
 * ACTIVE
 *    ↓
 * TARGET
 *
 * Any actionable setup can become INVALIDATED
 * when its structural/risk condition fails.
 */
const transitions = {
    OBSERVE: {
        SETUP_DETECTED: "WATCH",
    },
    WATCH: {
        TRIGGER_REACHED: "TRIGGERED",
        INVALIDATION_REACHED: "INVALIDATED",
        RESET: "OBSERVE",
    },
    TRIGGERED: {
        POSITION_OPENED: "ACTIVE",
        INVALIDATION_REACHED: "INVALIDATED",
        RESET: "OBSERVE",
    },
    ACTIVE: {
        TARGET_REACHED: "TARGET",
        INVALIDATION_REACHED: "INVALIDATED",
    },
    TARGET: {
        RESET: "OBSERVE",
    },
    INVALIDATED: {
        RESET: "OBSERVE",
    },
};
function transitionSignalState(input) {
    const { currentStatus, event } = input;
    const nextStatus = transitions[currentStatus]?.[event];
    if (!nextStatus) {
        return {
            status: currentStatus,
            changed: false,
            valid: false,
            explanation: `Invalid transition: ${currentStatus} + ${event}`,
        };
    }
    return {
        status: nextStatus,
        changed: nextStatus !== currentStatus,
        valid: true,
        explanation: `${currentStatus} → ${nextStatus}`,
    };
}
