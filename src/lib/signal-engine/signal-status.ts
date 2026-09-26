import type {
  SetupType,
  SignalStatus,
} from "./types";

export interface InitialSignalInput {
  setup: SetupType;
  detected: boolean;
  triggerReached: boolean;
  invalidated: boolean;
}

export function determineInitialStatus(
  input: InitialSignalInput
): SignalStatus {
  const {
    detected,
    triggerReached,
    invalidated,
  } = input;

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
