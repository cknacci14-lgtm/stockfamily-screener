import type { Evidence, SetupType } from "../types";

export interface AccumulationInput {
  close: number;
  sma20?: number;
  sma50?: number;
  rangeRatio?: number;
  volumeRatio?: number;
  valueRatio?: number;
  frequencyRatio?: number;
  closePosition?: number;
  bodyPct?: number;
  baseDays?: number;
  structure: Evidence;
  participation: Evidence;
  flow: Evidence;
  liquidity: Evidence;
}

export interface SetupResult {
  detected: boolean;
  setup: SetupType;
  label: string;
  explanation: string;
  trigger?: number;
}

export function detectAccumulation(
  input: AccumulationInput
): SetupResult {
  const {
    close,
    sma20,
    sma50,
    rangeRatio,
    volumeRatio,
    valueRatio,
    frequencyRatio,
    closePosition,
    bodyPct,
    baseDays,
    structure,
    flow,
    liquidity,
  } = input;

  if (!Number.isFinite(close) || close <= 0) {
    return {
      detected: false,
      setup: "ACCUMULATION",
      label: "No accumulation",
      explanation: "Valid closing price is required.",
    };
  }

  /*
   * Accumulation is contextual.
   *
   * It must not be classified while the broader
   * structure is explicitly bearish.
   */
  const structureCompatible =
    structure.state === "NEUTRAL" ||
    structure.state === "IMPROVING" ||
    structure.state === "BULLISH";

  const adequateBase =
    Number.isFinite(baseDays) &&
    baseDays! >= 10;

  const compressedRange =
    Number.isFinite(rangeRatio) &&
    rangeRatio! <= 0.90;

  const normalOrReducedVolume =
    !Number.isFinite(volumeRatio) ||
    volumeRatio! <= 1.20;

  const normalOrReducedValue =
    !Number.isFinite(valueRatio) ||
    valueRatio! <= 1.20;

  const normalFrequency =
    !Number.isFinite(frequencyRatio) ||
    frequencyRatio! <= 1.20;

  const activityControlled =
    normalOrReducedVolume &&
    normalOrReducedValue &&
    normalFrequency;

  const supportHolding =
    Number.isFinite(sma50) &&
    close >= sma50! * 0.95;

  const healthyClose =
    !Number.isFinite(closePosition) ||
    closePosition! >= 0.45;

  const controlledBody =
    !Number.isFinite(bodyPct) ||
    Math.abs(bodyPct!) <= 0.04;

  const flowNotOpposing =
    flow.state !== "OPPOSING";

  const liquidityReady =
    liquidity.state === "HEALTHY";

  const confirmed =
    structureCompatible &&
    adequateBase &&
    compressedRange &&
    activityControlled &&
    supportHolding &&
    healthyClose &&
    controlledBody &&
    flowNotOpposing &&
    liquidityReady;

  if (!confirmed) {
    return {
      detected: false,
      setup: "ACCUMULATION",
      label: "No confirmed accumulation",
      explanation:
        "Structure, base duration, compression, activity, support, flow, and liquidity do not yet align.",
    };
  }

  /*
   * Important:
   *
   * Accumulation is a WATCH setup.
   * The current close is NOT a trigger.
   *
   * A future breakout/reclaim should transition
   * the signal into TRIGGERED.
   */
  return {
    detected: true,
    setup: "ACCUMULATION",
    label: "Accumulation setup",
    explanation:
      "Price is holding a constructive base while range and participation remain controlled.",
  };
}
