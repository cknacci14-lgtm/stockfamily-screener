import {
  evaluateStructure,
} from "./evidence/structure";

import {
  evaluateParticipation,
} from "./evidence/participation";

import {
  evaluateFlow,
} from "./evidence/flow";

import {
  evaluateLiquidity,
} from "./evidence/liquidity";

import {
  detectBreakout,
} from "./setups/breakout";

import {
  detectPullback,
} from "./setups/pullback";

import {
  detectAccumulation,
} from "./setups/accumulation";

import {
  buildTradePlan,
} from "./risk/trade-plan";

import {
  determineInitialStatus,
} from "./signal-status";

import type {
  StockSignal,
  SetupType,
  Evidence,
} from "./types";

export interface SignalEngineInput {
  stockCode: string;
  stockName?: string;

  close: number;
  open?: number;
  high?: number;
  low?: number;

  sma20?: number;
  sma50?: number;
  high20?: number;
  previousHigh20?: number;
  high52w?: number;

  rangeRatio?: number;
  volumeRatio?: number;
  valueRatio?: number;
  frequencyRatio?: number;

  persistence5d?: number;
  foreignPersistence5d?: number;
  foreignRatio?: number;
  netForeignValue?: number;

  closePosition?: number;
  bodyPct?: number;

  recentHigh?: number;
  recentLow?: number;
  pullbackPct?: number;
  baseDays?: number;

  value?: number;
  frequency?: number;
  volume?: number;
  downsideDeviation?: number;
  historyDays?: number;

  atr?: number;
}

export interface SignalEngineResult {
  signal: StockSignal;
  setups: {
    breakout: boolean;
    pullback: boolean;
    accumulation: boolean;
  };
}

function now(): string {
  return new Date().toISOString();
}

function neutralEvidence(
  label: string,
  explanation: string
): Evidence {
  return {
    state: "NEUTRAL",
    label,
    explanation,
  };
}

export function evaluateStockSignal(
  input: SignalEngineInput
): SignalEngineResult {
  const timestamp = now();

  const structure = evaluateStructure({
    close: input.close,
    sma20: input.sma20,
    sma50: input.sma50,
    high20: input.high20,
    high52w: input.high52w,
    rangeRatio: input.rangeRatio,
    closePosition: input.closePosition,
    bodyPct: input.bodyPct,
  });

  const participation = evaluateParticipation({
    volumeRatio: input.volumeRatio,
    valueRatio: input.valueRatio,
    frequencyRatio: input.frequencyRatio,
    persistence5d: input.persistence5d,
  });

  const flow = evaluateFlow({
    foreignRatio: input.foreignRatio,
    foreignPersistence5d:
      input.foreignPersistence5d,
    netForeignValue:
      input.netForeignValue,
  });

  const liquidity = evaluateLiquidity({
    value: input.value,
    frequency: input.frequency,
    volume: input.volume,
    downsideDeviation:
      input.downsideDeviation,
    historyDays: input.historyDays,
  });

  const breakout = detectBreakout({
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

  const pullback = detectPullback({
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

  const accumulation = detectAccumulation({
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
  let setup: SetupType | null = null;
  let setupDetected = false;
  let trigger: number | undefined;

  if (breakout.detected) {
    setup = "BREAKOUT";
    setupDetected = true;
    trigger = breakout.trigger;
  } else if (pullback.detected) {
    setup = "PULLBACK";
    setupDetected = true;
    trigger = pullback.trigger;
  } else if (accumulation.detected) {
    setup = "ACCUMULATION";
    setupDetected = true;
    trigger = accumulation.trigger;
  }

  /*
   * No confirmed setup means there is no trade plan.
   */
  const tradePlan =
    setupDetected && setup
      ? buildTradePlan({
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

  if (
    setup === "BREAKOUT" &&
    Number.isFinite(trigger)
  ) {
    triggerReached =
      input.close > trigger!;
  }

  if (
    setup === "PULLBACK" &&
    Number.isFinite(trigger)
  ) {
    triggerReached =
      input.close >= trigger! &&
      structure.state !== "BEARISH";
  }

  /*
   * Accumulation intentionally remains WATCH.
   */
  if (setup === "ACCUMULATION") {
    triggerReached = false;
  }

  const invalidated =
    setupDetected &&
    tradePlan !== null &&
    Number.isFinite(tradePlan.invalidation) &&
    input.close <= tradePlan.invalidation!;

  const status = determineInitialStatus({
    setup:
      setup ?? "ACCUMULATION",
    detected: setupDetected,
    triggerReached,
    invalidated,
  });

  const signal: StockSignal = {
    stockCode: input.stockCode,
    stockName: input.stockName,

    setup,

    status,

    structure:
      structure ??
      neutralEvidence(
        "Structure unavailable",
        "Structure evidence unavailable."
      ),

    participation:
      participation ??
      neutralEvidence(
        "Participation unavailable",
        "Participation evidence unavailable."
      ),

    flow:
      flow ??
      neutralEvidence(
        "Flow unavailable",
        "Flow evidence unavailable."
      ),

    liquidity:
      liquidity ??
      neutralEvidence(
        "Liquidity unavailable",
        "Liquidity evidence unavailable."
      ),

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
