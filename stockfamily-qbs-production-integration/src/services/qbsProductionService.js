const fs = require("fs");
const path = require("path");

const {
  fetchHistoricalDataFromSupabase,
} = require("../database/supabaseDataPipeline");
const engine = require("../engine/qbsProductionEngine");

const ROOT = path.join(__dirname, "../..");
const RESULTS_DIR = path.join(ROOT, "results");
const SPEC_FILE = path.join(RESULTS_DIR, "qbs_strategy_specification.json");
const SNAPSHOT_FILE = path.join(RESULTS_DIR, "qbs_production_snapshot.json");

const CONTRACT_ID = "STOCKFAMILY_QBS_STRATEGY";
const CONTRACT_VERSION = "1.0.0";
const ENGINE_VERSION = "1.0.0";
const DETECTOR_VERSION = "1.0.0";
const DATA_LIMIT_DAYS = 5000;

let cache = null;

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildRiskHypotheses(event) {
  const features = event.features || {};
  const active = [];

  if (Number.isFinite(features.volumeSurge) && features.volumeSurge >= 20) {
    active.push("HYP_HIGH_VOLUME");
  }
  if (Number.isFinite(features.closePosition) && features.closePosition <= 0.35) {
    active.push("HYP_WEAK_CLOSE");
  }
  if (Number.isFinite(features.candleRangePct) && features.candleRangePct >= 15) {
    active.push("HYP_LARGE_RANGE");
  }
  if (Number.isFinite(features.upperWickPct) && features.upperWickPct >= 8) {
    active.push("HYP_UPPER_WICK");
  }

  return {
    active,
    source: "H0_ONLY",
    outcomeDependent: ["HYP_GAP_RISK", "HYP_IMMEDIATE_FAILURE"],
  };
}

function enrichEvent(event) {
  const eventId = `QBS-${event.eventDate}-${event.symbol}`;
  const risk = buildRiskHypotheses(event);

  return {
    ...event,
    eventId,
    detector: {
      name: "QBS",
      version: DETECTOR_VERSION,
      status: "LOCKED",
    },
    riskHypotheses: risk.active,
    riskAssessment: {
      active: risk.active,
      source: risk.source,
      evaluatedAtH0: true,
      outcomeDependentHypotheses: risk.outcomeDependent,
    },
    shadow: {
      mode: "PAPER",
      actualTrade: false,
      userCapitalInvolved: false,
      brokerOrderPlaced: false,
      manuallyExecuted: false,
    },
    governance: {
      productionApproved: false,
      productionRecommendation: false,
      optimization: false,
      modelSelection: false,
      noLookAhead: true,
      frozenSpecification: true,
    },
  };
}

function validateProductionEnvelope(result, spec) {
  const errors = [];

  assert(spec?.contract?.id === CONTRACT_ID, "Unexpected strategy contract.");
  assert(spec?.contract?.version === CONTRACT_VERSION, "Unexpected strategy contract version.");
  assert(spec?.detector?.version === DETECTOR_VERSION, "Unexpected detector version.");
  assert(spec?.detector?.status === "LOCKED", "Detector is not LOCKED.");
  assert(spec?.productionStatus?.productionRelease === "NOT_APPROVED", "Production release governance changed unexpectedly.");

  const validation = engine.validateProductionResult(result);
  if (!validation.valid) errors.push(...validation.errors);

  const seen = new Set();
  for (const event of result.events || []) {
    const key = `${event.symbol}|${event.eventDate}`;
    if (seen.has(key)) errors.push(`DUPLICATE_EVENT:${key}`);
    seen.add(key);
    if (event.eventDate !== result.targetDate) errors.push(`INVALID_EVENT_DATE:${event.symbol}`);
    if (event.detected !== true) errors.push(`INVALID_DETECTED:${event.symbol}`);
  }

  if (errors.length) {
    throw new Error(`QBS production safety validation failed: ${errors.join(", ")}`);
  }

  return true;
}

async function runQbsProductionSnapshot({ force = false } = {}) {
  const spec = readJson(SPEC_FILE);

  if (!force && cache) {
    return cache;
  }

  const database = await fetchHistoricalDataFromSupabase({
    limitDays: DATA_LIMIT_DAYS,
  });

  if (!database || typeof database !== "object") {
    throw new Error("QBS production blocked: historical database unavailable.");
  }

  const result = await engine.runQbsProduction({
    database,
    includeTrajectory: false,
    includeOutcome: false,
  });

  validateProductionEnvelope(result, spec);

  const latestDate = result.targetDate;
  assert(latestDate, "QBS production blocked: latest market date unavailable.");

  const events = result.events.map(enrichEvent);

  const snapshot = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    status: "READY",
    mode: "EVENT_INTELLIGENCE",
    targetDate: latestDate,
    strategyContract: {
      id: CONTRACT_ID,
      version: CONTRACT_VERSION,
    },
    detector: {
      name: "QBS",
      version: DETECTOR_VERSION,
      status: "LOCKED",
    },
    engineVersion: ENGINE_VERSION,
    data: {
      source: "SUPABASE.daily_stock_data",
      limitDays: DATA_LIMIT_DAYS,
      symbolsLoaded: result.diagnostics.symbolsLoaded,
      symbolsEvaluated: result.diagnostics.symbolsEvaluated ?? result.diagnostics.symbolsLoaded,
      eventsDetected: events.length,
    },
    safety: {
      dataAvailable: true,
      duplicateIntegrity: true,
      eventIdentity: true,
      chronology: true,
      noLookAhead: true,
      frozenSpecification: true,
      realCapital: false,
      brokerOrders: false,
    },
    governance: {
      productionTradingStrategy: false,
      productionApproved: false,
      productionRecommendation: false,
      optimization: false,
      modelSelection: false,
    },
    market: result.market,
    distribution: result.distribution,
    events,
  };

  writeJson(SNAPSHOT_FILE, snapshot);
  cache = snapshot;
  return snapshot;
}

function getCachedSnapshot() {
  return cache;
}

function clearProductionCache() {
  cache = null;
}

module.exports = {
  runQbsProductionSnapshot,
  getCachedSnapshot,
  clearProductionCache,
  SNAPSHOT_FILE,
};
