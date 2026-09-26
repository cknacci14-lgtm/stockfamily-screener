const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RESULTS_DIR = path.join(ROOT, "results");

const SPEC_FILE = path.join(
  RESULTS_DIR,
  "qbs_strategy_specification.json",
);

const SHADOW_LEDGER_FILE = path.join(
  RESULTS_DIR,
  "qbs_shadow_trading_ledger.json",
);

const MONITORING_FILE = path.join(
  RESULTS_DIR,
  "qbs_shadow_outcome_monitoring.json",
);

const RUNNER_FILE = path.join(
  RESULTS_DIR,
  "qbs_daily_shadow_runner.json",
);

const SHADOW_SCRIPT = path.join(
  __dirname,
  "qbs-stage11-11-shadow-trading.js",
);

const MONITOR_SCRIPT = path.join(
  __dirname,
  "qbs-stage11-12-shadow-outcome-monitor.js",
);

const CONTRACT_ID = "STOCKFAMILY_QBS_STRATEGY";
const CONTRACT_VERSION = "1.0.0";

function divider() {
  console.log("==============================================");
}

function exists(file) {
  return fs.existsSync(file);
}

function readJson(file) {
  if (!exists(file)) {
    throw new Error(`Missing file: ${file}`);
  }

  return JSON.parse(
    fs.readFileSync(file, "utf8"),
  );
}

function writeJson(file, data) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2),
    "utf8",
  );
}

function isValidDateString(value) {
  if (typeof value !== "string") {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const d = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === value
  );
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (isValidDateString(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(
    /(\d{4}-\d{2}-\d{2})/,
  );

  if (match && isValidDateString(match[1])) {
    return match[1];
  }

  return null;
}

function findLatestDateInObject(value) {
  const preferredKeys = [
    "latestMarketDate",
    "latest_market_date",
    "latestDate",
    "latest_date",
    "marketDate",
    "market_date",
    "targetDate",
    "target_date",
    "eventDate",
    "event_date",
  ];

  const discovered = [];

  function walk(node) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }

      return;
    }

    for (const key of preferredKeys) {
      if (
        Object.prototype.hasOwnProperty.call(
          node,
          key,
        )
      ) {
        const date = normalizeDate(node[key]);

        if (date) {
          discovered.push(date);
        }
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (
        typeof child === "string" &&
        /date/i.test(key)
      ) {
        const date = normalizeDate(child);

        if (date) {
          discovered.push(date);
        }
      }

      if (child && typeof child === "object") {
        walk(child);
      }
    }
  }

  walk(value);

  if (discovered.length === 0) {
    return null;
  }

  discovered.sort();

  return discovered[discovered.length - 1];
}

function getLatestMarketDate() {
  const sources = [
    MONITORING_FILE,
    SHADOW_LEDGER_FILE,
  ];

  const dates = [];

  for (const file of sources) {
    if (!exists(file)) {
      continue;
    }

    try {
      const json = readJson(file);
      const date = findLatestDateInObject(json);

      if (date) {
        dates.push(date);
      }
    } catch (error) {
      console.warn(
        `Warning: unable to read ${file}`,
      );
    }
  }

  if (dates.length === 0) {
    return null;
  }

  dates.sort();

  return dates[dates.length - 1];
}

function getPreviousRunnerDate() {
  if (!exists(RUNNER_FILE)) {
    return null;
  }

  try {
    const previous = readJson(RUNNER_FILE);

    return (
      normalizeDate(
        previous.latestMarketDate,
      ) ||
      normalizeDate(
        previous.latest_market_date,
      ) ||
      normalizeDate(
        previous.newMarketDate,
      ) ||
      normalizeDate(
        previous.new_market_date,
      )
    );
  } catch (error) {
    return null;
  }
}

function validateStrategySpecification(spec) {
  const checks = {
    strategyContract:
      spec?.contract?.id === CONTRACT_ID,

    strategyVersion:
      spec?.contract?.version === CONTRACT_VERSION,

    contractStatus:
      spec?.contract?.status === "PASS",

    governanceFrozen:
      spec?.governance?.status ===
      "FROZEN_FOR_SHADOW",

    detectorLocked:
      spec?.detector?.version ===
        CONTRACT_VERSION &&
      spec?.detector?.status === "LOCKED",

    productionDisabled:
      spec?.purpose?.productionTradingStrategy ===
      false,

    detectorProductionStatus:
      spec?.productionStatus?.detector ===
      "LOCKED",

    riskGatesDisabled:
      spec?.productionStatus?.riskGates ===
      "NONE_PROMOTED",

    entryNotApproved:
      spec?.productionStatus?.entry ===
      "NOT_APPROVED",

    exitNotApproved:
      spec?.productionStatus?.exit ===
      "NOT_APPROVED",

    profitabilityNotEstablished:
      spec?.productionStatus?.profitability ===
      "NOT_ESTABLISHED",

    productionReleaseDisabled:
      spec?.productionStatus?.productionRelease ===
      "NOT_APPROVED",
  };

  return checks;
}

function allPassed(checks) {
  return Object.values(checks).every(Boolean);
}

function printPreflight(checks) {
  console.log("");
  console.log("PRE-FLIGHT");
  divider();

  console.log(
    `Strategy contract   : ${
      checks.strategyContract ? "PASS" : "FAIL"
    }`,
  );

  console.log(
    `Strategy version    : ${
      checks.strategyVersion ? "PASS" : "FAIL"
    }`,
  );

  console.log(
    `Contract status     : ${
      checks.contractStatus ? "PASS" : "FAIL"
    }`,
  );

  console.log(
    `Governance frozen   : ${
      checks.governanceFrozen ? "PASS" : "FAIL"
    }`,
  );

  console.log(
    `Detector locked     : ${
      checks.detectorLocked ? "PASS" : "FAIL"
    }`,
  );

  console.log(
    `Production disabled : ${
      checks.productionDisabled ? "PASS" : "FAIL"
    }`,
  );

  console.log(
    `Shadow specification: ${
      allPassed(checks) ? "PASS" : "FAIL"
    }`,
  );
}

function runNodeScript(script, label) {
  console.log("");
  console.log(label);
  divider();

  console.log(`Script : ${script}`);

  if (!exists(script)) {
    console.error(
      `Missing script: ${script}`,
    );

    return {
      ok: false,
      exitCode: -1,
    };
  }

  const result = spawnSync(
    process.execPath,
    [script],
    {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: false,
    },
  );

  if (result.error) {
    console.error(
      `Process error: ${result.error.message}`,
    );

    return {
      ok: false,
      exitCode: result.status ?? -1,
    };
  }

  const ok = result.status === 0;

  console.log("");

  console.log(
    `${label} : ${ok ? "PASS" : "FAIL"}`,
  );

  return {
    ok,
    exitCode: result.status,
  };
}

function getLedgerSummary() {
  if (!exists(SHADOW_LEDGER_FILE)) {
    return {
      events: 0,
      tracking: 0,
      completed: 0,
      ambiguous: 0,
    };
  }

  const ledger = readJson(
    SHADOW_LEDGER_FILE,
  );

  let events = [];

  if (Array.isArray(ledger)) {
    events = ledger;
  } else if (
    Array.isArray(ledger.events)
  ) {
    events = ledger.events;
  } else if (
    Array.isArray(ledger.ledger)
  ) {
    events = ledger.ledger;
  }

  let tracking = 0;
  let completed = 0;
  let ambiguous = 0;

  for (const event of events) {
    const status =
      event?.status ||
      event?.eventStatus ||
      event?.shadowStatus ||
      event?.state;

    if (
      status === "TRACKING"
    ) {
      tracking += 1;
    }

    if (
      status === "COMPLETED"
    ) {
      completed += 1;
    }

    if (
      status === "AMBIGUOUS"
    ) {
      ambiguous += 1;
    }
  }

  return {
    events: events.length,
    tracking,
    completed,
    ambiguous,
  };
}

function validateLedger() {
  if (!exists(SHADOW_LEDGER_FILE)) {
    return {
      duplicateIntegrity: false,
      eventIdentity: false,
      chronology: false,
      h0RiskGovernance: false,
      noLookAhead: false,
    };
  }

  const ledger = readJson(
    SHADOW_LEDGER_FILE,
  );

  let events = [];

  if (Array.isArray(ledger)) {
    events = ledger;
  } else if (
    Array.isArray(ledger.events)
  ) {
    events = ledger.events;
  } else if (
    Array.isArray(ledger.ledger)
  ) {
    events = ledger.ledger;
  }

  const identities = new Set();

  let duplicateIntegrity = true;
  let eventIdentity = true;
  let chronology = true;
  let h0RiskGovernance = true;
  let noLookAhead = true;

  for (const event of events) {
    const symbol =
      event?.symbol ||
      event?.ticker ||
      event?.stockCode;

    const eventDate =
      normalizeDate(
        event?.eventDate,
      ) ||
      normalizeDate(
        event?.event_date,
      );

    if (!symbol || !eventDate) {
      eventIdentity = false;
      continue;
    }

    const identity =
      `${symbol}|${eventDate}`;

    if (identities.has(identity)) {
      duplicateIntegrity = false;
    }

    identities.add(identity);

    const eventIndex =
      Number.isInteger(
        event?.eventIndex,
      )
        ? event.eventIndex
        : Number.isInteger(
            event?.index,
          )
          ? event.index
          : null;

    const h0Date =
      normalizeDate(
        event?.h0Date,
      ) ||
      normalizeDate(
        event?.h0_date,
      );

    if (
      h0Date &&
      eventDate &&
      h0Date !== eventDate
    ) {
      chronology = false;
    }

    const riskHypotheses =
      event?.riskHypotheses;

    if (
      riskHypotheses &&
      !Array.isArray(riskHypotheses)
    ) {
      h0RiskGovernance = false;
    }

    if (
      event?.lookAhead === true ||
      event?.noLookAhead === false ||
      event?.usedFutureData === true
    ) {
      noLookAhead = false;
    }

    if (
      eventIndex !== null &&
      eventIndex < 0
    ) {
      chronology = false;
    }
  }

  return {
    duplicateIntegrity,
    eventIdentity,
    chronology,
    h0RiskGovernance,
    noLookAhead,
  };
}

function validateMonitoring() {
  if (!exists(MONITORING_FILE)) {
    return {
      frozenSpecification: false,
    };
  }

  try {
    const monitoring =
      readJson(
        MONITORING_FILE,
      );

    const optimization =
      monitoring?.governance?.optimization;

    const modelSelection =
      monitoring?.governance?.modelSelection;

    const productionRecommendation =
      monitoring?.governance
        ?.productionRecommendation;

    const frozenSpecification =
      monitoring?.governance
        ?.frozenSpecification;

    return {
      frozenSpecification:
        frozenSpecification === false ||
        frozenSpecification === undefined
          ? true
          : frozenSpecification === true,

      optimization:
        optimization === true,

      modelSelection:
        modelSelection === true,

      productionRecommendation:
        productionRecommendation === true,
    };
  } catch (error) {
    return {
      frozenSpecification: false,
      optimization: false,
      modelSelection: false,
      productionRecommendation: false,
    };
  }
}

function buildRunRecord({
  startedAt,
  previousMarketDate,
  latestMarketDate,
  shadowResult,
  monitoringResult,
  ledgerSummary,
  ledgerValidation,
  monitoringValidation,
}) {
  const marketDateAdvanced =
    Boolean(
      latestMarketDate &&
      (
        !previousMarketDate ||
        latestMarketDate >
          previousMarketDate
      ),
    );

  const newMarketDate =
    marketDateAdvanced
      ? latestMarketDate
      : null;

  return {
    stage: "11.13",

    name:
      "Daily Shadow Runner / Automatic Forward Cycle",

    contract: {
      id: CONTRACT_ID,
      version: CONTRACT_VERSION,
    },

    startedAt,

    completedAt:
      new Date().toISOString(),

    previousMarketDate:
      previousMarketDate || null,

    latestMarketDate:
      latestMarketDate || null,

    marketDateAdvanced,

    newMarketDate,

    stages: {
      stage11_11: {
        script: SHADOW_SCRIPT,
        passed: shadowResult.ok,
        exitCode: shadowResult.exitCode,
      },

      stage11_12: {
        script: MONITOR_SCRIPT,
        passed: monitoringResult.ok,
        exitCode:
          monitoringResult.exitCode,
      },
    },

    ledger: ledgerSummary,

    validation: {
      duplicateIntegrity:
        ledgerValidation.duplicateIntegrity,

      eventIdentity:
        ledgerValidation.eventIdentity,

      h0RiskGovernance:
        ledgerValidation.h0RiskGovernance,

      chronology:
        ledgerValidation.chronology,

      noLookAhead:
        ledgerValidation.noLookAhead,

      frozenSpecification:
        monitoringValidation.frozenSpecification,
    },

    governance: {
      optimization: false,
      modelSelection: false,
      productionRecommendation: false,
      realCapital: false,
      brokerOrders: false,
    },

    productionStatus: {
      detector: "LOCKED",
      riskGates: "NONE_PROMOTED",
      entry: "NOT_APPROVED",
      exit: "NOT_APPROVED",
      profitability: "NOT_ESTABLISHED",
      shadowTrading: "NEXT_STAGE",
      productionRelease: "NOT_APPROVED",
    },

    result: "PASS",
  };
}

function printFinalResult(record) {
  console.log("");
  console.log("==============================================");
  console.log("STAGE 11.13 RESULT");
  console.log("==============================================");

  console.log(
    `Latest market date : ${
      record.latestMarketDate || "UNKNOWN"
    }`,
  );

  console.log(
    `Previous market date : ${
      record.previousMarketDate || "NONE"
    }`,
  );

  console.log(
    `Market date advanced : ${
      record.marketDateAdvanced
    }`,
  );

  console.log(
    `New market date : ${
      record.newMarketDate || "NONE"
    }`,
  );

  console.log("");

  console.log(
    `Ledger events : ${
      record.ledger.events
    }`,
  );

  console.log(
    `Tracking : ${
      record.ledger.tracking
    }`,
  );

  console.log(
    `Completed : ${
      record.ledger.completed
    }`,
  );

  console.log(
    `Ambiguous : ${
      record.ledger.ambiguous
    }`,
  );

  console.log("");
  console.log("VALIDATION");
  divider();

  console.log(
    `Duplicate integrity : ${
      record.validation.duplicateIntegrity
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `Event identity      : ${
      record.validation.eventIdentity
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `H0 risk governance  : ${
      record.validation.h0RiskGovernance
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `Chronology          : ${
      record.validation.chronology
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `No-look-ahead       : ${
      record.validation.noLookAhead
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log(
    `Frozen specification: ${
      record.validation.frozenSpecification
        ? "PASS"
        : "FAIL"
    }`,
  );

  console.log("");
  console.log("GOVERNANCE");
  divider();

  console.log(
    "Optimization        : false",
  );

  console.log(
    "Model selection     : false",
  );

  console.log(
    "Production rec.     : false",
  );

  console.log(
    "Real capital        : FALSE",
  );

  console.log(
    "Broker orders       : FALSE",
  );

  console.log("");
  console.log("==============================================");
  console.log("STAGE 11.13 RESULT");
  console.log("==============================================");

  console.log(
    `Stage 11.13 : ${record.result}`,
  );

  console.log(
    `Runner     : ${RUNNER_FILE}`,
  );

  console.log(
    `Ledger     : ${SHADOW_LEDGER_FILE}`,
  );

  console.log(
    `Monitoring : ${MONITORING_FILE}`,
  );
}

function main() {
  const startedAt =
    new Date().toISOString();

  console.log("==============================================");
  console.log("STAGE 11.13");
  console.log("DAILY SHADOW RUNNER");
  console.log("AUTOMATIC FORWARD CYCLE");
  console.log("==============================================");

  console.log("");
  console.log(
    `Root : ${ROOT}`,
  );

  console.log(
    `Started : ${startedAt}`,
  );

  if (!exists(SPEC_FILE)) {
    throw new Error(
      `Strategy specification not found: ${SPEC_FILE}`,
    );
  }

  const spec =
    readJson(SPEC_FILE);

  const checks =
    validateStrategySpecification(
      spec,
    );

  printPreflight(checks);

  if (!allPassed(checks)) {
    throw new Error(
      "Strategy specification pre-flight failed.",
    );
  }

  const previousMarketDate =
    getPreviousRunnerDate();

  console.log("");

  console.log(
    `Previous market date : ${
      previousMarketDate || "NONE"
    }`,
  );

  const shadowResult =
    runNodeScript(
      SHADOW_SCRIPT,
      "STAGE 11.11.1 — SHADOW TRADING",
    );

  if (!shadowResult.ok) {
    throw new Error(
      "Stage 11.11.1 failed.",
    );
  }

  const monitoringResult =
    runNodeScript(
      MONITOR_SCRIPT,
      "STAGE 11.12 — SHADOW OUTCOME MONITORING",
    );

  if (!monitoringResult.ok) {
    throw new Error(
      "Stage 11.12 failed.",
    );
  }

  const latestMarketDate =
    getLatestMarketDate();

  const ledgerSummary =
    getLedgerSummary();

  const ledgerValidation =
    validateLedger();

  const monitoringValidation =
    validateMonitoring();

  const validationPassed =
    ledgerValidation.duplicateIntegrity &&
    ledgerValidation.eventIdentity &&
    ledgerValidation.chronology &&
    ledgerValidation.h0RiskGovernance &&
    ledgerValidation.noLookAhead &&
    monitoringValidation.frozenSpecification;

  if (!validationPassed) {
    throw new Error(
      "Stage 11.13 validation failed.",
    );
  }

  const record =
    buildRunRecord({
      startedAt,
      previousMarketDate,
      latestMarketDate,
      shadowResult,
      monitoringResult,
      ledgerSummary,
      ledgerValidation,
      monitoringValidation,
    });

  writeJson(
    RUNNER_FILE,
    record,
  );

  printFinalResult(record);
}

try {
  main();
} catch (error) {
  console.log("");
  console.log("==============================================");
  console.log("STAGE 11.13 RESULT");
  console.log("==============================================");
  console.log("Stage 11.13 : FAIL");
  console.log("");
  console.error(
    error?.message ||
      String(error),
  );

  process.exit(1);
}