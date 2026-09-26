import type { Evidence, SetupType } from "../types";

export interface BreakoutInput {
  close: number;
  high20?: number;
  previousHigh20?: number;
  rangeRatio?: number;
  volumeRatio?: number;
  valueRatio?: number;
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

export function detectBreakout(
  input: BreakoutInput
): SetupResult {
  const {
    close,
    high20,
    previousHigh20,
    rangeRatio,
    volumeRatio,
    valueRatio,
    closePosition,
    structure,
    participation,
    liquidity,
  } = input;

  if (!Number.isFinite(close) || close <= 0) {
    return {
      detected: false,
      setup: "BREAKOUT",
      label: "No breakout",
      explanation: "Valid closing price is required.",
    };
  }

  const resistance =
    Number.isFinite(previousHigh20)
      ? previousHigh20
      : high20;

  const aboveResistance =
    Number.isFinite(resistance) &&
    close > resistance!;

  const rangeExpanded =
    Number.isFinite(rangeRatio) &&
    rangeRatio! >= 1.50;

  const participationExpanded =
    participation.state === "IMPROVING" ||
    (
      Number.isFinite(volumeRatio) &&
      volumeRatio! >= 1.50
    ) ||
    (
      Number.isFinite(valueRatio) &&
      valueRatio! >= 1.50
    );

  const closeNearHigh =
    Number.isFinite(closePosition) &&
    closePosition! >= 0.70;

  const structureReady =
    structure.state === "BULLISH" ||
    structure.state === "IMPROVING";

  const liquidityReady =
    liquidity.state === "HEALTHY";

  const confirmed =
    aboveResistance &&
    rangeExpanded &&
    structureReady &&
    participationExpanded &&
    closeNearHigh &&
    liquidityReady;

  if (!confirmed) {
    return {
      detected: false,
      setup: "BREAKOUT",
      label: "No confirmed breakout",
      explanation:
        "Resistance, range expansion, structure, participation, close position, and liquidity do not yet align.",
    };
  }

  return {
    detected: true,
    setup: "BREAKOUT",
    label: "Breakout setup",
    trigger: resistance,
    explanation:
      "Price has broken recent resistance with range expansion, supportive structure, expanding participation, and a strong close.",
  };
}
