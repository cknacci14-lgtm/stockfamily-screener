"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineInitialStatus = determineInitialStatus;
function determineInitialStatus(input) {
    const { detected, triggerReached, invalidated, } = input;
    if (invalidated) {
        return "INVALIDATED";
    }
    if (!detected) {
        return "OBSERVE";
    }
    if (triggerReached) {
        return "TRIGGERED";
    }
    return "WATCH";
}
