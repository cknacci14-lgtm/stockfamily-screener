import type { RiskLevel, TradePlan } from "../types";

export interface TradePlanInput {
  close: number;
  setup: "BREAKOUT" | "PULLBACK" | "ACCUMULATION";

  trigger?: number;
  support?: number;
  resistance?: number;
  recentLow?: number;
  recentHigh?: number;
  atr?: number;

  riskPercent?: number;
}

export function buildTradePlan(
  input: TradePlanInput
): TradePlan {
  const {
    close,
    setup,
    trigger,
    support,
    resistance,
    recentLow,
    recentHigh,
    atr,
  } = input;

  if (!Number.isFinite(close) || close <= 0) {
    return {
      riskLevel: "HIGH",
    };
  }

  /*
   * Risk engine is an execution framework.
   * It does NOT predict returns.
   *
   * Priority:
   * 1. Define trigger
   * 2. Define invalidation
   * 3. Calculate targets
   * 4. Calculate R:R
   */

  let entry = close;
  let invalidation: number | undefined;

  if (setup === "BREAKOUT") {
    entry =
      Number.isFinite(trigger)
        ? trigger!
        : close;

    invalidation =
      Number.isFinite(support)
        ? support!
        : Number.isFinite(atr)
          ? entry - atr! * 1.20
          : entry * 0.95;
  }

  if (setup === "PULLBACK") {
    entry =
      Number.isFinite(trigger)
        ? trigger!
        : close;

    invalidation =
      Number.isFinite(recentLow)
        ? recentLow!
        : Number.isFinite(atr)
          ? entry - atr! * 1.20
          : entry * 0.95;
  }

  if (setup === "ACCUMULATION") {
    entry = close;

    invalidation =
      Number.isFinite(recentLow)
        ? recentLow!
        : Number.isFinite(support)
          ? support!
          : Number.isFinite(atr)
            ? entry - atr! * 1.50
            : entry * 0.94;
  }

  if (
    !Number.isFinite(invalidation) ||
    invalidation! >= entry
  ) {
    return {
      entry,
      riskLevel: "HIGH",
    };
  }

  const riskPerShare =
    entry - invalidation!;

  /*
   * Targets use risk multiples rather than
   * pretending we know the future price.
   */

  const target1 =
    entry + riskPerShare * 1.50;

  const target2 =
    entry + riskPerShare * 2.50;

  const riskReward =
    (target2 - entry) / riskPerShare;

  let riskLevel: RiskLevel = "MEDIUM";

  const riskPct =
    (riskPerShare / entry) * 100;

  if (riskPct <= 3) {
    riskLevel = "LOW";
  } else if (riskPct > 7) {
    riskLevel = "HIGH";
  }

  return {
    entry,
    trigger,
    invalidation,
    target1,
    target2,
    riskReward,
    riskLevel,
  };
}
