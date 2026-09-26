import type { Evidence } from "../types";

export interface FlowInput {
  foreignRatio?: number;
  foreignPersistence5d?: number;
  netForeignValue?: number;
}

export function evaluateFlow(
  input: FlowInput
): Evidence {
  const {
    foreignRatio,
    foreignPersistence5d,
    netForeignValue,
  } = input;

  if (!Number.isFinite(foreignRatio)) {
    return {
      state: "NEUTRAL",
      label: "Flow unavailable",
      explanation:
        "No valid foreign-flow measurement is available.",
    };
  }

  const ratio = foreignRatio!;

  const persistent =
    Number.isFinite(foreignPersistence5d) &&
    foreignPersistence5d! >= 0.60;

  const positiveFlow =
    Number.isFinite(netForeignValue) &&
    netForeignValue! > 0;

  const negativeFlow =
    Number.isFinite(netForeignValue) &&
    netForeignValue! < 0;

  /*
   * IMPORTANT:
   *
   * Foreign flow is contextual evidence only.
   *
   * Our historical validation did NOT establish
   * foreign flow as a standalone predictive entry edge.
   */

  if (
    ratio >= 0.10 &&
    positiveFlow &&
    (persistent || !Number.isFinite(foreignPersistence5d))
  ) {
    return {
      state: "SUPPORTIVE",
      label: "Foreign flow supportive",
      value: ratio,
      explanation:
        "Foreign net activity is supportive of the current price context.",
    };
  }

  if (
    ratio <= -0.10 &&
    negativeFlow &&
    (persistent || !Number.isFinite(foreignPersistence5d))
  ) {
    return {
      state: "OPPOSING",
      label: "Foreign flow opposing",
      value: ratio,
      explanation:
        "Foreign net activity is opposing the current price context.",
    };
  }

  return {
    state: "NEUTRAL",
    label: "Foreign flow neutral",
    value: ratio,
    explanation:
      "Foreign activity does not provide a decisive contextual signal.",
  };
}