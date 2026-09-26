import type { Evidence, SetupType } from "../types";

export interface PullbackInput {
  close: number;
  sma20?: number;
  sma50?: number;
  recentHigh?: number;
  pullbackPct?: number;
  rangeRatio?: number;
  volumeRatio?: number;
  closePosition?: number;
  structure: Evidence;
  participation: Evidence;
  liquidity: Evidence;
}

export interface SetupResult {
  detected: boolean;
  setup: SetupType;
  label: string;
  explanation: string;
  trigger?: number;
}

export function detectPullback(
  input: PullbackInput
): SetupResult {
  const {
    close,
    sma20,
    sma50,
    recentHigh,
    pullbackPct,
    rangeRatio,
    volumeRatio,
    closePosition,
    structure,
    participation,
    liquidity,
  } = input;

  if (!Number.isFinite(close) || close <= 0) {
    return {
      detected: false,
      setup: "PULLBACK",
      label: "No pullback",
      explanation: "Valid closing price is required.",
    };
  }

  const trendIntact =
    Number.isFinite(sma20) &&
    Number.isFinite(sma50) &&
    close > sma50! &&
    sma20! > sma50!;

  const retraced =
    Number.isFinite(pullbackPct) &&
    pullbackPct! >= 0.03 &&
    pullbackPct! <= 0.15;

  const nearSma20 =
    Number.isFinite(sma20) &&
    close >= sma20! * 0.97 &&
    close <= sma20! * 1.05;

  const nearSma50 =
    Number.isFinite(sma50) &&
    close >= sma50! * 0.95 &&
    close <= sma50! * 1.08;

  const locationValid =
    retraced || nearSma20 || nearSma50;

  const sellingPressureContracting =
    participation.state === "CONTRACTING" ||
    (
      Number.isFinite(volumeRatio) &&
      volumeRatio! <= 0.90
    );

  const rangeControlled =
    !Number.isFinite(rangeRatio) ||
    rangeRatio! < 1.50;

  const structureIntact =
    structure.state === "BULLISH" ||
    structure.state === "IMPROVING";

  const closeHealthy =
    !Number.isFinite(closePosition) ||
    closePosition! >= 0.40;

  const liquidityReady =
    liquidity.state === "HEALTHY";

  const confirmed =
    trendIntact &&
    locationValid &&
    sellingPressureContracting &&
    rangeControlled &&
    structureIntact &&
    closeHealthy &&
    liquidityReady;

  if (!confirmed) {
    return {
      detected: false,
      setup: "PULLBACK",
      label: "No confirmed pullback",
      explanation:
        "Trend, retracement location, selling-pressure behavior, and liquidity do not yet align.",
    };
  }

  const trigger =
    Number.isFinite(sma20) ? sma20 : sma50;

  return {
    detected: true,
    setup: "PULLBACK",
    label: "Pullback setup",
    trigger,
    explanation:
      "Uptrend remains intact while price retraces toward a major trend reference with controlled participation.",
  };
}
