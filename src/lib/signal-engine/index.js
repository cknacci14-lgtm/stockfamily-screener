"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineInitialStatus = exports.transitionSignalState = exports.buildTradePlan = exports.detectAccumulation = exports.detectPullback = exports.detectBreakout = void 0;
__exportStar(require("./types"), exports);
__exportStar(require("./evidence/structure"), exports);
__exportStar(require("./evidence/participation"), exports);
__exportStar(require("./evidence/flow"), exports);
__exportStar(require("./evidence/liquidity"), exports);
var breakout_1 = require("./setups/breakout");
Object.defineProperty(exports, "detectBreakout", { enumerable: true, get: function () { return breakout_1.detectBreakout; } });
var pullback_1 = require("./setups/pullback");
Object.defineProperty(exports, "detectPullback", { enumerable: true, get: function () { return pullback_1.detectPullback; } });
var accumulation_1 = require("./setups/accumulation");
Object.defineProperty(exports, "detectAccumulation", { enumerable: true, get: function () { return accumulation_1.detectAccumulation; } });
var trade_plan_1 = require("./risk/trade-plan");
Object.defineProperty(exports, "buildTradePlan", { enumerable: true, get: function () { return trade_plan_1.buildTradePlan; } });
var signal_state_1 = require("./signal-state");
Object.defineProperty(exports, "transitionSignalState", { enumerable: true, get: function () { return signal_state_1.transitionSignalState; } });
var signal_status_1 = require("./signal-status");
Object.defineProperty(exports, "determineInitialStatus", { enumerable: true, get: function () { return signal_status_1.determineInitialStatus; } });
__exportStar(require("./engine"), exports);
