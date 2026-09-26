import type { Evidence } from "../types";

export interface StructureInput {
  close: number;
  sma20?: number;
  sma50?: number;
  high20?: number;
  high52w?: number;
  rangeRatio?: number;
  closePosition?: number;
  bodyPct?: number;
}

export function evaluateStructure(
  input: StructureInput
): Evidence {

  const {
    close,
    sma20,
    sma50,
    high20,
    high52w,
    rangeRatio,
    closePosition,
    bodyPct,
  } = input;

  if (!Number.isFinite(close) || close <= 0) {
    return {
      state: "NEUTRAL",
      label: "Structure unavailable",
      explanation: "Valid closing price is required.",
    };
  }

  const above20 =
    Number.isFinite(sma20) && close > sma20!;

  const above50 =
    Number.isFinite(sma50) && close > sma50!;

  const near20High =
    Number.isFinite(high20) &&
    close >= high20! * 0.98;

  const near52wHigh =
    Number.isFinite(high52w) &&
    close >= high52w! * 0.90;

  const strongClose =
    Number.isFinite(closePosition) &&
    closePosition! >= 0.70;

  const expansion =
    Number.isFinite(rangeRatio) &&
    rangeRatio! >= 1.50;

  const strongBody =
    Number.isFinite(bodyPct) &&
    bodyPct! >= 0.02;

  /*
   * Structure is descriptive.
   *
   * We deliberately do NOT convert this
   * into a predictive score.
   */

  if (
    above20 &&
    above50 &&
    (near20High || near52wHigh) &&
    strongClose
  ) {
    return {
      state: "BULLISH",
      label: "Bullish structure",
      explanation:
        "Price is above SMA20/SMA50 and positioned near a recent or 52-week high.",
    };
  }

  if (
    above20 &&
    above50 &&
    (expansion || strongBody)
  ) {
    return {
      state: "IMPROVING",
      label: "Structure improving",
      explanation:
        "Price remains above the main short/intermediate trend references with increasing price activity.",
    };
  }

  if (
    Number.isFinite(sma20) &&
    Number.isFinite(sma50) &&
    close < sma20! &&
    close < sma50!
  ) {
    return {
      state: "BEARISH",
      label: "Bearish structure",
      explanation:
        "Price is below both SMA20 and SMA50.",
    };
  }

  return {
    state: "NEUTRAL",
    label: "Neutral structure",
    explanation:
      "Price structure does not currently show a decisive directional condition.",
  };
}