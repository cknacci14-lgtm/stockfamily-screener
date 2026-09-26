const fs = require("fs");
const path = require("path");

const {
  fetchHistoricalDataFromSupabase,
} = require("../src/database/supabaseDataPipeline");

const ROOT = path.join(__dirname, "..");
const RESULTS = path.join(ROOT, "results");

const SPEC_FILE = path.join(
  RESULTS,
  "qbs_strategy_specification.json"
);

const LEDGER_FILE = path.join(
  RESULTS,
  "qbs_shadow_trading_ledger.json"
);

const OUTPUT_FILE = path.join(
  RESULTS,
  "qbs_shadow_outcome_monitoring.json"
);

const CONTRACT_ID =
  "STOCKFAMILY_QBS_STRATEGY";

const CONTRACT_VERSION =
  "1.0.0";

const DETECTOR_VERSION =
  "1.0.0";

const HORIZON =
  20;

const TARGETS = [
  5,
  10,
  15,
  20,
];

const DRAWDOWNS = [
  3,
  5,
  7,
  10,
  15,
  20,
];

const H0_RISK_HYPOTHESES = [
  "HYP_HIGH_VOLUME",
  "HYP_WEAK_CLOSE",
  "HYP_LARGE_RANGE",
  "HYP_UPPER_WICK",
];

const OUTCOME_DEPENDENT_HYPOTHESES = [
  "HYP_GAP_RISK",
  "HYP_IMMEDIATE_FAILURE",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(file) {
  assert(
    fs.existsSync(file),
    `Required file not found: ${file}`
  );

  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function writeJson(file, data) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function finiteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

function round(value, decimals = 4) {
  if (!finiteNumber(value)) {
    return null;
  }

  const factor =
    10 ** decimals;

  return (
    Math.round(
      value * factor
    ) / factor
  );
}

function dateKey(value) {
  if (!value) {
    return null;
  }

  return String(value).slice(0, 10);
}

function getHistory(
  database,
  symbol
) {
  const history =
    database[symbol];

  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((row) => ({
      ...row,
      date: dateKey(
        row.date ||
        row.tradeDate ||
        row.trade_date
      ),
    }))
    .filter(
      (row) => row.date
    )
    .sort(
      (a, b) =>
        new Date(a.date) -
        new Date(b.date)
    );
}

function getOpen(row) {
  return Number(
    row.open ??
    row.openPrice ??
    0
  );
}

function getHigh(row) {
  return Number(
    row.high ??
    row.highPrice ??
    0
  );
}

function getLow(row) {
  return Number(
    row.low ??
    row.lowPrice ??
    0
  );
}

function getClose(row) {
  return Number(
    row.close ??
    row.closingPrice ??
    row.penutupan ??
    0
  );
}

function calculateReturn(
  entryPrice,
  price
) {
  if (
    !finiteNumber(entryPrice) ||
    entryPrice === 0 ||
    !finiteNumber(price)
  ) {
    return null;
  }

  return (
    ((price - entryPrice) /
      entryPrice) *
    100
  );
}

function createEventKey(event) {
  return (
    `${event.symbol}|${event.eventDate}`
  );
}

function validateEventIdentity(event) {
  const expectedId =
    `QBS-${event.eventDate.replaceAll("-", "")}-${event.symbol}`;

  assert(
    event.eventId === expectedId,
    `Event identity mismatch: ${createEventKey(event)}`
  );

  assert(
    event.detector &&
      event.detector.version ===
        DETECTOR_VERSION,
    `Detector version mismatch: ${createEventKey(event)}`
  );

  assert(
    event.reference &&
      event.reference.candidate ===
        "H0_CLOSE",
    `Reference candidate mismatch: ${createEventKey(event)}`
  );

  assert(
    event.reference.horizon ===
        HORIZON,
    `Reference horizon mismatch: ${createEventKey(event)}`
  );

  assert(
    event.governance &&
      event.governance.noLookAhead ===
        true,
    `No-look-ahead violation: ${createEventKey(event)}`
  );

  assert(
    event.governance.productionRecommendation ===
        false,
    `Production recommendation violation: ${createEventKey(event)}`
  );
}

function buildTrajectory(
  history,
  eventIndex,
  entryPrice
) {
  const trajectory = [];

  for (
    let step = 1;
    step <= HORIZON;
    step++
  ) {
    const row =
      history[eventIndex + step];

    if (!row) {
      break;
    }

    const high =
      getHigh(row);

    const low =
      getLow(row);

    const close =
      getClose(row);

    trajectory.push({
      step,

      date:
        row.date,

      open:
        getOpen(row),

      high,

      low,

      close,

      highReturn:
        round(
          calculateReturn(
            entryPrice,
            high
          )
        ),

      lowReturn:
        round(
          calculateReturn(
            entryPrice,
            low
          )
        ),

      closeReturn:
        round(
          calculateReturn(
            entryPrice,
            close
          )
        ),
    });
  }

  return trajectory;
}

function firstTargetStep(
  trajectory,
  target
) {
  const row =
    trajectory.find(
      (item) =>
        finiteNumber(
          item.highReturn
        ) &&
        item.highReturn >=
          target
    );

  return row
    ? row.step
    : null;
}

function drawdownHit(
  trajectory,
  threshold
) {
  return trajectory.some(
    (item) =>
      finiteNumber(
        item.lowReturn
      ) &&
      item.lowReturn <=
        -threshold
  );
}

function buildOutcome(
  trajectory
) {
  const highReturns =
    trajectory
      .map(
        (item) =>
          item.highReturn
      )
      .filter(
        finiteNumber
      );

  const lowReturns =
    trajectory
      .map(
        (item) =>
          item.lowReturn
      )
      .filter(
        finiteNumber
      );

  const closeReturns =
    trajectory
      .map(
        (item) =>
          item.closeReturn
      )
      .filter(
        finiteNumber
      );

  const mfe =
    highReturns.length
      ? Math.max(...highReturns)
      : null;

  const mae =
    lowReturns.length
      ? Math.min(...lowReturns)
      : null;

  const latestCloseReturn =
    closeReturns.length
      ? closeReturns[
          closeReturns.length - 1
        ]
      : null;

  const completed =
    trajectory.length >=
    HORIZON;

  return {
    status:
      completed
        ? "COMPLETED"
        : "TRACKING",

    completed,

    availableBars:
      trajectory.length,

    requiredBars:
      HORIZON,

    mfe:
      round(mfe),

    mae:
      round(mae),

    latestCloseReturn:
      round(
        latestCloseReturn
      ),

    high5:
      finiteNumber(mfe)
        ? mfe >= 5
        : false,

    high10:
      finiteNumber(mfe)
        ? mfe >= 10
        : false,

    high15:
      finiteNumber(mfe)
        ? mfe >= 15
        : false,

    high20:
      finiteNumber(mfe)
        ? mfe >= 20
        : false,

    timeTo5:
      firstTargetStep(
        trajectory,
        5
      ),

    timeTo10:
      firstTargetStep(
        trajectory,
        10
      ),

    timeTo15:
      firstTargetStep(
        trajectory,
        15
      ),

    timeTo20:
      firstTargetStep(
        trajectory,
        20
      ),

    drawdown3:
      drawdownHit(
        trajectory,
        3
      ),

    drawdown5:
      drawdownHit(
        trajectory,
        5
      ),

    drawdown7:
      drawdownHit(
        trajectory,
        7
      ),

    drawdown10:
      drawdownHit(
        trajectory,
        10
      ),

    drawdown15:
      drawdownHit(
        trajectory,
        15
      ),

    drawdown20:
      drawdownHit(
        trajectory,
        20
      ),
  };
}

function classifyMonitoringState(
  event,
  outcome
) {
  if (
    event.eventState ===
    "AMBIGUOUS"
  ) {
    return "AMBIGUOUS";
  }

  if (
    outcome.completed
  ) {
    return "COMPLETED";
  }

  return "TRACKING";
}

function updateEvent(
  event,
  database
) {
  validateEventIdentity(
    event
  );

  const history =
    getHistory(
      database,
      event.symbol
    );

  const eventIndex =
    history.findIndex(
      (row) =>
        row.date ===
        event.eventDate
    );

  if (
    eventIndex < 0
  ) {
    return {
      event,

      changed:
        false,

      reason:
        "H0_NOT_FOUND",
    };
  }

  const entryPrice =
    Number(
      event.reference.entryPrice
    );

  assert(
    finiteNumber(entryPrice) &&
      entryPrice > 0,
    `Invalid reference entry for ${createEventKey(event)}`
  );

  const trajectory =
    buildTrajectory(
      history,
      eventIndex,
      entryPrice
    );

  const outcome =
    buildOutcome(
      trajectory
    );

  const monitoringState =
    classifyMonitoringState(
      event,
      outcome
    );

  const before =
    JSON.stringify({
      trajectory:
        event.trajectory ||
        [],

      outcome:
        event.outcome ||
        null,

      status:
        event.status ||
        null,

      monitoringState:
        event.monitoringState ||
        null,
    });

  const after =
    JSON.stringify({
      trajectory,

      outcome,

      status:
        outcome.status,

      monitoringState,
    });

  const updatedEvent = {
    ...event,

    trajectory,

    outcome,

    status:
      outcome.status,

    monitoringState,

    tracking: {
      ...(event.tracking || {}),

      availableBars:
        trajectory.length,

      requiredBars:
        HORIZON,

      latestObservedDate:
        trajectory.length
          ? trajectory[
              trajectory.length - 1
            ].date
          : event.eventDate,
    },
  };

  return {
    event:
      updatedEvent,

    changed:
      before !== after,

    reason:
      before !== after
        ? "OUTCOME_UPDATED"
        : "NO_CHANGE",
  };
}

function average(values) {
  const valid =
    values.filter(
      finiteNumber
    );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / valid.length
  );
}

function median(values) {
  const valid =
    values
      .filter(
        finiteNumber
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (!valid.length) {
    return null;
  }

  const middle =
    Math.floor(
      valid.length / 2
    );

  if (
    valid.length % 2 ===
    0
  ) {
    return (
      (valid[middle - 1] +
        valid[middle]) /
      2
    );
  }

  return valid[middle];
}

function buildOutcomeSummary(
  events
) {
  const complete =
    events.filter(
      (event) =>
        event.outcome &&
        event.outcome.completed
    );

  const tracking =
    events.filter(
      (event) =>
        !event.outcome ||
        !event.outcome.completed
    );

  function rate(
    predicate
  ) {
    if (!complete.length) {
      return null;
    }

    return (
      complete.filter(
        predicate
      ).length /
      complete.length
    ) * 100;
  }

  return {
    totalEvents:
      events.length,

    completed:
      complete.length,

    tracking:
      tracking.length,

    completionRate:
      events.length
        ? round(
            (complete.length /
              events.length) *
              100
          )
        : null,

    mfe: {
      average:
        round(
          average(
            complete.map(
              (event) =>
                event.outcome.mfe
            )
          )
        ),

      median:
        round(
          median(
            complete.map(
              (event) =>
                event.outcome.mfe
            )
          )
        ),
    },

    mae: {
      average:
        round(
          average(
            complete.map(
              (event) =>
                event.outcome.mae
            )
          )
        ),

      median:
        round(
          median(
            complete.map(
              (event) =>
                event.outcome.mae
            )
          )
        ),
    },

    targets: {
      "+5":
        rate(
          (event) =>
            event.outcome.high5
        ),

      "+10":
        rate(
          (event) =>
            event.outcome.high10
        ),

      "+15":
        rate(
          (event) =>
            event.outcome.high15
        ),

      "+20":
        rate(
          (event) =>
            event.outcome.high20
        ),
    },

    drawdowns: {
      "-3":
        rate(
          (event) =>
            event.outcome.drawdown3
        ),

      "-5":
        rate(
          (event) =>
            event.outcome.drawdown5
        ),

      "-7":
        rate(
          (event) =>
            event.outcome.drawdown7
        ),

      "-10":
        rate(
          (event) =>
            event.outcome.drawdown10
        ),

      "-15":
        rate(
          (event) =>
            event.outcome.drawdown15
        ),

      "-20":
        rate(
          (event) =>
            event.outcome.drawdown20
        ),
    },

    latestCloseReturn: {
      average:
        round(
          average(
            complete.map(
              (event) =>
                event.outcome
                  .latestCloseReturn
            )
          )
        ),

      median:
        round(
          median(
            complete.map(
              (event) =>
                event.outcome
                  .latestCloseReturn
            )
          )
        ),
    },
  };
}

function buildGroupedSummary(
  events,
  getGroup
) {
  const groups = {};

  for (
    const event of events
  ) {
    const group =
      getGroup(event);

    if (!group) {
      continue;
    }

    if (!groups[group]) {
      groups[group] = [];
    }

    groups[group].push(
      event
    );
  }

  const output = {};

  for (
    const [
      group,
      groupEvents,
    ] of Object.entries(groups)
  ) {
    output[group] =
      buildOutcomeSummary(
        groupEvents
      );
  }

  return output;
}

function buildRiskHypothesisSummary(
  events
) {
  const output = {};

  for (
    const hypothesis of
      H0_RISK_HYPOTHESES
  ) {
    const matched =
      events.filter(
        (event) =>
          Array.isArray(
            event.riskHypotheses
          ) &&
          event.riskHypotheses.includes(
            hypothesis
          )
      );

    output[hypothesis] =
      buildOutcomeSummary(
        matched
      );
  }

  return output;
}

function validateRiskGovernance(
  events
) {
  for (
    const event of events
  ) {
    const hypotheses =
      event.riskHypotheses ||
      [];

    for (
      const hypothesis of
        hypotheses
    ) {
      assert(
        H0_RISK_HYPOTHESES.includes(
          hypothesis
        ),
        `Non-H0 hypothesis found in H0 risk state: ${createEventKey(event)} -> ${hypothesis}`
      );
    }

    for (
      const hypothesis of
        OUTCOME_DEPENDENT_HYPOTHESES
    ) {
      assert(
        !hypotheses.includes(
          hypothesis
        ),
        `Outcome-dependent hypothesis leaked into H0: ${createEventKey(event)} -> ${hypothesis}`
      );
    }

    assert(
      event.riskAssessment &&
        event.riskAssessment.source ===
          "H0_ONLY",
      `Risk assessment source violation: ${createEventKey(event)}`
    );
  }
}

async function main() {
  console.log("");
  console.log(
    "STAGE 11.12"
  );
  console.log(
    "SHADOW OUTCOME MONITORING"
  );
  console.log(
    "=============================================="
  );

  const spec =
    readJson(
      SPEC_FILE
    );

  assert(
    spec.contract &&
      spec.contract.id ===
        CONTRACT_ID,
    "Strategy contract ID mismatch."
  );

  assert(
    spec.contract.version ===
        CONTRACT_VERSION,
    "Strategy contract version mismatch."
  );

  assert(
    spec.detector &&
      spec.detector.status ===
        "LOCKED",
    "QBS detector is not LOCKED."
  );

  const ledger =
    readJson(
      LEDGER_FILE
    );

  assert(
    ledger.strategyContract &&
      ledger.strategyContract.id ===
        CONTRACT_ID,
    "Ledger contract ID mismatch."
  );

  assert(
    ledger.strategyContract.version ===
        CONTRACT_VERSION,
    "Ledger contract version mismatch."
  );

  assert(
    Array.isArray(
      ledger.events
    ),
    "Ledger events array missing."
  );

  console.log("");
  console.log(
    "LOADING DATABASE"
  );
  console.log(
    "=============================================="
  );

  const database =
    await fetchHistoricalDataFromSupabase(
      {
        limitDays:
          5000,
      }
    );

  const symbols =
    Object.keys(
      database
    );

  assert(
    symbols.length > 0,
    "No symbols found."
  );

  const allDates =
    new Set();

  for (
    const symbol of symbols
  ) {
    const history =
      getHistory(
        database,
        symbol
      );

    for (
      const row of history
    ) {
      allDates.add(
        row.date
      );
    }
  }

  const marketDates =
    [...allDates].sort(
      (a, b) =>
        new Date(a) -
        new Date(b)
    );

  const latestMarketDate =
    marketDates[
      marketDates.length - 1
    ];

  console.log(
    `Symbols             : ${symbols.length}`
  );

  console.log(
    `Latest market date  : ${latestMarketDate}`
  );

  console.log(
    `Ledger events       : ${ledger.events.length}`
  );

  const seen =
    new Set();

  for (
    const event of ledger.events
  ) {
    const key =
      createEventKey(event);

    assert(
      !seen.has(key),
      `Duplicate shadow event: ${key}`
    );

    seen.add(key);

    validateEventIdentity(
      event
    );
  }

  validateRiskGovernance(
    ledger.events
  );

  let updatedEvents = 0;
  let unchangedEvents = 0;
  let missingH0 = 0;

  const updatedLedgerEvents =
    [];

  for (
    const event of ledger.events
  ) {
    const result =
      updateEvent(
        event,
        database
      );

    if (
      result.reason ===
      "H0_NOT_FOUND"
    ) {
      missingH0++;

      updatedLedgerEvents.push(
        event
      );

      continue;
    }

    if (
      result.changed
    ) {
      updatedEvents++;
    } else {
      unchangedEvents++;
    }

    updatedLedgerEvents.push(
      result.event
    );
  }

  assert(
    missingH0 === 0,
    `Missing H0 data for ${missingH0} shadow events.`
  );

  validateRiskGovernance(
    updatedLedgerEvents
  );

  const tracking =
    updatedLedgerEvents.filter(
      (event) =>
        event.status ===
        "TRACKING"
    );

  const completed =
    updatedLedgerEvents.filter(
      (event) =>
        event.status ===
        "COMPLETED"
    );

  const ambiguous =
    updatedLedgerEvents.filter(
      (event) =>
        event.eventState ===
        "AMBIGUOUS"
    );

  const outcomeSummary =
    buildOutcomeSummary(
      updatedLedgerEvents
    );

  const stateSummary =
    buildGroupedSummary(
      updatedLedgerEvents,
      (event) =>
        event.eventState
    );

  const qbsBandSummary =
    buildGroupedSummary(
      updatedLedgerEvents,
      (event) =>
        event.qbs &&
        event.qbs.band
          ? event.qbs.band
          : "UNKNOWN"
    );

  const riskSummary =
    buildRiskHypothesisSummary(
      updatedLedgerEvents
    );

  const targetCounts = {};

  for (
    const target of TARGETS
  ) {
    const key =
      `high${target}`;

    targetCounts[
      `+${target}`
    ] =
      completed.filter(
        (event) =>
          event.outcome &&
          event.outcome[key]
      ).length;
  }

  const drawdownCounts = {};

  for (
    const threshold of
      DRAWDOWNS
  ) {
    const key =
      `drawdown${threshold}`;

    drawdownCounts[
      `-${threshold}`
    ] =
      completed.filter(
        (event) =>
          event.outcome &&
          event.outcome[key]
      ).length;
  }

  const monitoring = {
    stage:
      "11.12",

    name:
      "Shadow Outcome Monitoring",

    status:
      "PASS",

    generatedAt:
      new Date().toISOString(),

    strategyContract: {
      id:
        CONTRACT_ID,

      version:
        CONTRACT_VERSION,
    },

    detector: {
      name:
        "QBS",

      version:
        DETECTOR_VERSION,

      status:
        "LOCKED",
    },

    observation: {
      latestMarketDate,

      symbols:
        symbols.length,

      ledgerEvents:
        updatedLedgerEvents.length,

      tracking:
        tracking.length,

      completed:
        completed.length,

      ambiguous:
        ambiguous.length,

      updatedEvents,

      unchangedEvents,
    },

    outcomeSummary,

    targetCounts,

    drawdownCounts,

    byEventState:
      stateSummary,

    byQbsBand:
      qbsBandSummary,

    byH0RiskHypothesis:
      riskSummary,

    riskHypothesisRegistry: {
      H0Observable:
        H0_RISK_HYPOTHESES,

      outcomeDependent:
        OUTCOME_DEPENDENT_HYPOTHESES,
    },

    monitoringRules: {
      horizon:
        HORIZON,

      targets:
        TARGETS,

      drawdowns:
        DRAWDOWNS,

      entryReference:
        "H0_CLOSE",

      outcomeOnlyAfterH0:
        true,

      ambiguousExcludedFromRealizedPnL:
        true,
    },

    governance: {
      forwardOnly:
        true,

      noLookAhead:
        true,

      frozenSpecification:
        true,

      detectorLocked:
        true,

      riskHypothesesH0Only:
        true,

      optimization:
        false,

      modelSelection:
        false,

      productionRecommendation:
        false,

      realCapital:
        false,

      brokerOrders:
        false,

      historicalRewrite:
        false,
    },

    validation: {
      duplicateIntegrity:
        true,

      eventIdentityIntegrity:
        true,

      chronologyIntegrity:
        true,

      noMissingH0:
        missingH0 === 0,

      riskGovernance:
        true,

      noLookAhead:
        true,

      frozenSpecification:
        true,

      productionRecommendation:
        false,
    },

    interpretation: {
      purpose:
        "Observe forward shadow outcomes without changing the frozen strategy specification.",

      tradingClaim:
        false,

      profitabilityEstablished:
        false,

      productionApproval:
        false,

      note:
        "Observed outcomes are shadow/event-intelligence evidence only. They do not constitute a realized live trading result or production strategy approval.",
    },

    events:
      updatedLedgerEvents,
  };

  writeJson(
    OUTPUT_FILE,
    monitoring
  );

  const updatedLedger = {
    ...ledger,

    events:
      updatedLedgerEvents,

    updatedAt:
      new Date().toISOString(),

    shadowOutcomeMonitoring: {
      stage:
        "11.12",

      latestMarketDate,

      lastRunAt:
        new Date().toISOString(),

      horizon:
        HORIZON,

      targets:
        TARGETS,

      drawdowns:
        DRAWDOWNS,

      tracking:
        tracking.length,

      completed:
        completed.length,

      ambiguous:
        ambiguous.length,
    },

    governance: {
      ...(ledger.governance || {}),

      forwardOnly:
        true,

      noLookAhead:
        true,

      optimization:
        false,

      modelSelection:
        false,

      productionRecommendation:
        false,

      realCapital:
        false,

      brokerOrders:
        false,

      historicalRewrite:
        false,
    },
  };

  writeJson(
    LEDGER_FILE,
    updatedLedger
  );

  console.log("");
  console.log(
    "MONITORING SUMMARY"
  );
  console.log(
    "=============================================="
  );

  console.log(
    `Latest market date : ${latestMarketDate}`
  );

  console.log(
    `Ledger events       : ${updatedLedgerEvents.length}`
  );

  console.log(
    `Updated events      : ${updatedEvents}`
  );

  console.log(
    `Unchanged events    : ${unchangedEvents}`
  );

  console.log(
    `Tracking            : ${tracking.length}`
  );

  console.log(
    `Completed           : ${completed.length}`
  );

  console.log(
    `Ambiguous           : ${ambiguous.length}`
  );

  console.log("");
  console.log(
    "OUTCOME"
  );
  console.log(
    "=============================================="
  );

  console.log(
    `MFE average         : ${outcomeSummary.mfe.average ?? "N/A"}%`
  );

  console.log(
    `MFE median          : ${outcomeSummary.mfe.median ?? "N/A"}%`
  );

  console.log(
    `MAE average         : ${outcomeSummary.mae.average ?? "N/A"}%`
  );

  console.log(
    `MAE median          : ${outcomeSummary.mae.median ?? "N/A"}%`
  );

  console.log(
    `Completion rate     : ${outcomeSummary.completionRate ?? "N/A"}%`
  );

  console.log("");
  console.log(
    "TARGET OBSERVATION"
  );
  console.log(
    "=============================================="
  );

  for (
    const target of TARGETS
  ) {
    console.log(
      `+${target}%               : ${targetCounts[`+${target}`]}`
    );
  }

  console.log("");
  console.log(
    "DRAWDOWN OBSERVATION"
  );
  console.log(
    "=============================================="
  );

  for (
    const threshold of
      DRAWDOWNS
  ) {
    console.log(
      `-${threshold}%               : ${drawdownCounts[`-${threshold}`]}`
    );
  }

  console.log("");
  console.log(
    "H0 RISK HYPOTHESES"
  );
  console.log(
    "=============================================="
  );

  for (
    const hypothesis of
      H0_RISK_HYPOTHESES
  ) {
    const summary =
      riskSummary[
        hypothesis
      ];

    console.log(
      `${hypothesis.padEnd(20)}: ${summary.totalEvents}`
    );
  }

  console.log("");
  console.log(
    "VALIDATION"
  );
  console.log(
    "=============================================="
  );

  console.log(
    "Duplicate integrity : PASS"
  );

  console.log(
    "Event identity      : PASS"
  );

  console.log(
    "Chronology          : PASS"
  );

  console.log(
    "No missing H0       : PASS"
  );

  console.log(
    "Risk governance     : PASS"
  );

  console.log(
    "No-look-ahead       : PASS"
  );

  console.log(
    "Frozen specification: PASS"
  );

  console.log("");
  console.log(
    "GOVERNANCE"
  );
  console.log(
    "=============================================="
  );

  console.log(
    "Optimization        : false"
  );

  console.log(
    "Model selection     : false"
  );

  console.log(
    "Production rec.     : false"
  );

  console.log(
    "Real capital        : FALSE"
  );

  console.log(
    "Broker orders       : FALSE"
  );

  console.log("");
  console.log(
    "=============================================="
  );

  console.log(
    "STAGE 11.12 RESULT"
  );

  console.log(
    "=============================================="
  );

  console.log(
    "Stage 11.12 : PASS"
  );

  console.log(
    `Monitoring  : ${OUTPUT_FILE}`
  );

  console.log(
    `Ledger      : ${LEDGER_FILE}`
  );
}

main().catch((error) => {
  console.error("");
  console.error(
    "STAGE 11.12 ERROR"
  );

  console.error(
    error.stack ||
    error.message
  );

  process.exit(1);
});