export type EvidenceState =
  | "BULLISH"
  | "NEUTRAL"
  | "BEARISH"
  | "IMPROVING"
  | "CONTRACTING"
  | "SUPPORTIVE"
  | "OPPOSING"
  | "HEALTHY"
  | "THIN"
  | "HIGH_RISK";

export type SetupType =
  | "BREAKOUT"
  | "PULLBACK"
  | "ACCUMULATION";

export type SignalStatus =
  | "OBSERVE"
  | "WATCH"
  | "TRIGGERED"
  | "ACTIVE"
  | "TARGET"
  | "INVALIDATED";

export type RiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH";

export interface Evidence {
  state: EvidenceState;
  label: string;
  value?: number;
  explanation?: string;
}

export interface TradePlan {
  entry?: number;
  trigger?: number;
  invalidation?: number;
  target1?: number;
  target2?: number;
  riskReward?: number;
  riskLevel: RiskLevel;
}

export interface StockSignal {
  stockCode: string;
  stockName?: string;

  setup: SetupType | null;
  status: SignalStatus;

  structure: Evidence;
  participation: Evidence;
  flow: Evidence;
  liquidity: Evidence;

  tradePlan: TradePlan | null;

  createdAt: string;
  updatedAt: string;
}
