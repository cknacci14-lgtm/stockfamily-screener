import type { SignalStatus } from "./types";

export type SignalEvent =
  | "SETUP_DETECTED"
  | "TRIGGER_REACHED"
  | "POSITION_OPENED"
  | "TARGET_REACHED"
  | "INVALIDATION_REACHED"
  | "RESET";

export interface SignalStateInput {
  currentStatus: SignalStatus;
  event: SignalEvent;
}

export interface SignalStateResult {
  status: SignalStatus;
  changed: boolean;
  valid: boolean;
  explanation: string;
}

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

const transitions: Record<
  SignalStatus,
  Partial<Record<SignalEvent, SignalStatus>>
> = {
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

export function transitionSignalState(
  input: SignalStateInput
): SignalStateResult {
  const { currentStatus, event } = input;

  const nextStatus =
    transitions[currentStatus]?.[event];

  if (!nextStatus) {
    return {
      status: currentStatus,
      changed: false,
      valid: false,
      explanation:
        `Invalid transition: ${currentStatus} + ${event}`,
    };
  }

  return {
    status: nextStatus,
    changed: nextStatus !== currentStatus,
    valid: true,
    explanation:
      `${currentStatus} → ${nextStatus}`,
  };
}