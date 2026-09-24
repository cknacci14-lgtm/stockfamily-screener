const fs = require("fs");
const path = require("path");

const {
  fetchHistoricalDataFromSupabase,
} = require("../src/database/supabaseDataPipeline");

const {
  normalizeHistory,
  calculateFeatures,
  qualifies,
} = require("../src/engine/qbsProductionEngine");

const CONTRACT = {
  id: "STOCKFAMILY_QBS_CROSS_SECTIONAL_EVIDENCE",
  version: "4.9.1",
  stage: "V4.9.1",
  detector: "QBS 1.0.0 LOCKED",
  dataContract: "V4.7.7 LOCKED",
  outcomeContract: "V4.8.0",
  controlMethod:
    "SAME_DATE_FEATURE_ELIGIBLE_NON_QBS_FIXED_STRATA",
  lookahead: false,
  optimization: false,
  productionTradingStrategy: false,
};

const HORIZONS = [1, 5, 10];
const TARGETS = [5, 10, 15, 20];
const DRAWDOWNS = [3, 5, 7, 10, 15, 20];

function finite(value) {
  return Number.isFinite(Number(value));
}

function num(value) {
  return Number(value);
}

function validPrice(value) {
  return finite(value) && num(value) > 0;
}

function dateOf(row) {
  return row?.date ?? row?.trade_date ?? null;
}

function classifyQuality(row) {
  const open = num(row.open);
  const high = num(row.high);
  const low = num(row.low);
  const close = num(row.close);
  const volume = num(row.volume);
  const frequency = num(row.frequency);

  if (
    !validPrice(close) &&
    !validPrice(high) &&
    !validPrice(low)
  ) {
    return "INVALID_PRICE";
  }

  if (
    validPrice(close) &&
    high === 0 &&
    low === 0 &&
    volume === 0 &&
    frequency === 0
  ) {
    return "VALID_INACTIVE_CLOSE_ONLY";
  }

  if (
    !validPrice(high) ||
    !validPrice(low) ||
    high < low ||
    high < close ||
    low > close
  ) {
    return "INVALID_OHLC";
  }

  if (open === 0 && validPrice(high) && validPrice(low) && validPrice(close)) {
    if (volume > 0 || frequency > 0) {
      return "OPEN_ZERO_ACTIVE";
    }

    return "VALID_INACTIVE";
  }

  if (volume > 0 || frequency > 0) {
    return "VALID_ACTIVE";
  }

  return "VALID_INACTIVE";
}

function classifyState(row, previousState) {
  const quality = classifyQuality(row);

  if (
    quality === "INVALID_PRICE" ||
    quality === "INVALID_OHLC"
  ) {
    return {
      dataQuality: quality,
      dataState: "INVALID",
      featureEligible: false,
    };
  }

  if (quality === "VALID_INACTIVE" || quality === "VALID_INACTIVE_CLOSE_ONLY") {
    return {
      dataQuality: quality,
      dataState: "INACTIVE",
      featureEligible: false,
    };
  }

  if (previousState === "INACTIVE") {
    return {
      dataQuality: quality,
      dataState: "REACTIVATED",
      featureEligible: true,
    };
  }

  return {
    dataQuality: quality,
    dataState: "ACTIVE",
    featureEligible: true,
  };
}

function buildStateHistory(history) {
  let previousState = null;

  return history.map((row) => {
    const state = classifyState(row, previousState);

    previousState = state.dataState;

    return {
      ...row,
      ...state,
    };
  });
}

function pct(a, b) {
  if (!validPrice(a) || !validPrice(b)) {
    return null;
  }

  return ((num(a) / num(b)) - 1) * 100;
}

function candleRangePct(row) {
  if (!validPrice(row.close)) {
    return null;
  }

  return ((num(row.high) - num(row.low)) / num(row.close)) * 100;
}

function closePosition(row) {
  const high = num(row.high);
  const low = num(row.low);
  const close = num(row.close);

  if (!validPrice(high) || !validPrice(low) || !validPrice(close)) {
    return null;
  }

  if (high === low) {
    return 0.5;
  }

  return (close - low) / (high - low);
}

function upperWickPct(row) {
  const open = num(row.open);
  const high = num(row.high);
  const close = num(row.close);

  if (!finite(open) || !validPrice(high) || !validPrice(close)) {
    return null;
  }

  const bodyTop = Math.max(open, close);

  return ((high - bodyTop) / close) * 100;
}

function buildH0Profile(features, row) {
  return {
    close: num(row.close),
    value: num(row.value),
    changePct: num(features.changePct),
    volumeSurge: num(features.volumeSurge),
    frequencySurge: num(features.frequencySurge),
    closePosition: num(features.closePosition),
    bbWidth: num(features.bbWidth),
    priceRange20: num(features.priceRange20),
    candleRangePct: num(candleRangePct(row)),
    upperWickPct: num(upperWickPct(row)),
  };
}

function priceBucket(close) {
  if (!finite(close)) return "UNKNOWN";

  if (close < 500) return "P1";
  if (close < 1000) return "P2";
  if (close < 5000) return "P3";
  return "P4";
}

function valueBucket(value) {
  if (!finite(value)) return "UNKNOWN";

  if (value < 10_000_000_000) return "V1";
  if (value < 50_000_000_000) return "V2";
  if (value < 200_000_000_000) return "V3";
  return "V4";
}

function changeBucket(change) {
  if (!finite(change)) return "UNKNOWN";

  if (change < 0) return "C1";
  if (change < 2) return "C2";
  if (change < 5) return "C3";
  if (change < 10) return "C4";
  return "C5";
}

function volumeBucket(value) {
  if (!finite(value)) return "UNKNOWN";

  if (value < 1) return "Q1";
  if (value < 2) return "Q2";
  if (value < 5) return "Q3";
  if (value < 10) return "Q4";
  return "Q5";
}

function frequencyBucket(value) {
  if (!finite(value)) return "F_UNKNOWN";

  if (value < 1) return "F1";
  if (value < 2) return "F2";
  if (value < 5) return "F3";
  if (value < 10) return "F4";
  return "F5";
}

function buildStratum(profile) {
  return [
    priceBucket(profile.close),
    valueBucket(profile.value),
    changeBucket(profile.changePct),
    volumeBucket(profile.volumeSurge),
    frequencyBucket(profile.frequencySurge),
  ].join("|");
}

function normalizedDistance(a, b) {
  const dimensions = [
    ["changePct", 10],
    ["volumeSurge", 10],
    ["frequencySurge", 10],
    ["closePosition", 1],
    ["bbWidth", 1],
    ["priceRange20", 1],
    ["candleRangePct", 20],
    ["upperWickPct", 20],
  ];

  let total = 0;
  let count = 0;

  for (const [key, scale] of dimensions) {
    if (!finite(a[key]) || !finite(b[key])) {
      continue;
    }

    total += Math.abs(num(a[key]) - num(b[key])) / scale;
    count += 1;
  }

  if (count === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return total / count;
}

function buildOutcome(history, index, maxHorizon = 10) {
  const h0 = history[index];

  if (!h0 || !validPrice(h0.close)) {
    return null;
  }

  const baseClose = num(h0.close);
  const steps = [];

  for (let h = 1; h <= maxHorizon; h += 1) {
    const row = history[index + h];

    if (!row) {
      steps.push({
        horizon: h,
        available: false,
        outcomeValid: false,
      });

      continue;
    }

    const stateValid =
      row.featureEligible === true &&
      row.dataState !== "INACTIVE" &&
      row.dataState !== "INVALID";

    const priceValid =
      validPrice(row.close) &&
      validPrice(row.high) &&
      validPrice(row.low);

    if (!stateValid || !priceValid) {
      steps.push({
        horizon: h,
        available: true,
        outcomeValid: false,
        dataState: row.dataState,
        dataQuality: row.dataQuality,
      });

      continue;
    }

    const highReturn = pct(row.high, baseClose);
    const lowReturn = pct(row.low, baseClose);
    const closeReturn = pct(row.close, baseClose);

    steps.push({
      horizon: h,
      available: true,
      outcomeValid: true,
      dataState: row.dataState,
      dataQuality: row.dataQuality,
      highReturn,
      lowReturn,
      closeReturn,
    });
  }

  return {
    baseClose,
    steps,
  };
}

function summarizeOutcome(outcome, horizon) {
  if (!outcome) {
    return null;
  }

  const validSteps = outcome.steps.filter(
    (step) =>
      step.outcomeValid === true &&
      step.horizon <= horizon
  );

  if (!validSteps.length) {
    return null;
  }

  const highs = validSteps
    .map((step) => step.highReturn)
    .filter(finite);

  const lows = validSteps
    .map((step) => step.lowReturn)
    .filter(finite);

  const closes = validSteps
    .map((step) => step.closeReturn)
    .filter(finite);

  return {
    mfe: highs.length ? Math.max(...highs) : null,
    mae: lows.length ? Math.min(...lows) : null,
    closeReturn:
      closes.length
        ? closes[closes.length - 1]
        : null,
    validSteps: validSteps.length,
  };
}

function targetHits(outcome, target) {
  if (!outcome) return false;

  return outcome.steps.some(
    (step) =>
      step.outcomeValid === true &&
      finite(step.highReturn) &&
      step.highReturn >= target
  );
}

function drawdownHits(outcome, drawdown) {
  if (!outcome) return false;

  return outcome.steps.some(
    (step) =>
      step.outcomeValid === true &&
      finite(step.lowReturn) &&
      step.lowReturn <= -drawdown
  );
}

function prepareDatabase(database) {
  const prepared = {};

  for (const [ticker, rawHistory] of Object.entries(database)) {
    if (!Array.isArray(rawHistory)) {
      continue;
    }

    const normalized = normalizeHistory(rawHistory);

    if (!normalized.length) {
      continue;
    }

    prepared[ticker] = buildStateHistory(normalized);
  }

  return prepared;
}

function buildDateIndex(database) {
  const index = new Map();

  for (const [ticker, history] of Object.entries(database)) {
    for (let i = 0; i < history.length; i += 1) {
      const row = history[i];
      const date = dateOf(row);

      if (!date) continue;

      if (!index.has(date)) {
        index.set(date, []);
      }

      index.get(date).push({
        ticker,
        history,
        index: i,
        row,
      });
    }
  }

  return index;
}

function detectQbs(database) {
  const events = [];
  const qbsByDateTicker = new Set();

  for (const [ticker, history] of Object.entries(database)) {
    for (let i = 0; i < history.length; i += 1) {
      const h0 = history[i];

      if (!h0.featureEligible) {
        continue;
      }

      const features = calculateFeatures(history, i);

      if (!features) {
        continue;
      }

      if (!qualifies(features)) {
        continue;
      }

      const eventDate = dateOf(h0);

      if (!eventDate) {
        continue;
      }

      const key = `${eventDate}|${ticker}`;

      if (qbsByDateTicker.has(key)) {
        continue;
      }

      qbsByDateTicker.add(key);

      events.push({
        eventId: `QBS-${eventDate}-${ticker}`,
        ticker,
        eventDate,
        index: i,
        features,
        profile: buildH0Profile(features, h0),
        outcome: buildOutcome(history, i, 10),
      });
    }
  }

  return {
    events,
    qbsByDateTicker,
  };
}

function selectControl(event, candidates, usedControls) {
  const sameDateCandidates = candidates.filter(
    (candidate) => candidate.ticker !== event.ticker
  );

  const eligible = sameDateCandidates.filter(
    (candidate) =>
      candidate.row.featureEligible === true &&
      candidate.row.dataState !== "INACTIVE" &&
      candidate.row.dataState !== "INVALID" &&
      !usedControls.has(
        `${event.eventDate}|${candidate.ticker}`
      )
  );

  if (!eligible.length) {
    return null;
  }

  const eventStratum = buildStratum(event.profile);

  const sameStratum = eligible.filter(
    (candidate) =>
      buildStratum(candidate.profile) === eventStratum
  );

  const pool =
    sameStratum.length > 0
      ? sameStratum
      : eligible;

  const ranked = pool
    .map((candidate) => ({
      candidate,
      distance: normalizedDistance(
        event.profile,
        candidate.profile
      ),
    }))
    .sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }

      return a.candidate.ticker.localeCompare(
        b.candidate.ticker
      );
    });

  return ranked[0]?.candidate ?? null;
}

function isCompleteForHorizon(outcome, horizon) {
  if (!outcome) return false;

  return outcome.steps.some(
    (step) =>
      step.horizon === horizon &&
      step.outcomeValid === true
  );
}

function aggregateGroup(items) {
  const result = {
    events: items.length,
    horizons: {},
    targets: {},
    drawdowns: {},
  };

  for (const horizon of HORIZONS) {
    const summaries = items
      .map((item) =>
        summarizeOutcome(item.outcome, horizon)
      )
      .filter(Boolean);

    result.horizons[horizon] = {
      valid: summaries.length,
      mfeAvg: average(
        summaries.map((x) => x.mfe)
      ),
      maeAvg: average(
        summaries.map((x) => x.mae)
      ),
      closeReturnAvg: average(
        summaries.map((x) => x.closeReturn)
      ),
      mfeMedian: median(
        summaries.map((x) => x.mfe)
      ),
      maeMedian: median(
        summaries.map((x) => x.mae)
      ),
      closeReturnMedian: median(
        summaries.map((x) => x.closeReturn)
      ),
    };
  }

  for (const target of TARGETS) {
    const valid = items.filter((item) =>
      isCompleteForHorizon(item.outcome, 10)
    );

    const hits = valid.filter((item) =>
      targetHits(item.outcome, target)
    ).length;

    result.targets[`+${target}`] = {
      valid: valid.length,
      hits,
      rate:
        valid.length
          ? (hits / valid.length) * 100
          : null,
    };
  }

  for (const drawdown of DRAWDOWNS) {
    const valid = items.filter((item) =>
      isCompleteForHorizon(item.outcome, 10)
    );

    const hits = valid.filter((item) =>
      drawdownHits(item.outcome, drawdown)
    ).length;

    result.drawdowns[`-${drawdown}`] = {
      valid: valid.length,
      hits,
      rate:
        valid.length
          ? (hits / valid.length) * 100
          : null,
    };
  }

  return result;
}

function average(values) {
  const clean = values.filter(finite);

  if (!clean.length) {
    return null;
  }

  return clean.reduce(
    (sum, value) => sum + num(value),
    0
  ) / clean.length;
}

function median(values) {
  const clean = values
    .filter(finite)
    .map(num)
    .sort((a, b) => a - b);

  if (!clean.length) {
    return null;
  }

  const middle = Math.floor(clean.length / 2);

  if (clean.length % 2 === 1) {
    return clean[middle];
  }

  return (clean[middle - 1] + clean[middle]) / 2;
}

function diff(qbsValue, controlValue) {
  if (!finite(qbsValue) || !finite(controlValue)) {
    return null;
  }

  return num(qbsValue) - num(controlValue);
}

function buildComparativeSummary(qbsItems, controlItems) {
  const qbs = aggregateGroup(qbsItems);
  const control = aggregateGroup(controlItems);

  const differences = {
    horizons: {},
    targets: {},
    drawdowns: {},
  };

  for (const horizon of HORIZONS) {
    differences.horizons[horizon] = {
      mfeDelta: diff(
        qbs.horizons[horizon].mfeAvg,
        control.horizons[horizon].mfeAvg
      ),
      maeDelta: diff(
        qbs.horizons[horizon].maeAvg,
        control.horizons[horizon].maeAvg
      ),
      closeReturnDelta: diff(
        qbs.horizons[horizon].closeReturnAvg,
        control.horizons[horizon].closeReturnAvg
      ),
    };
  }

  for (const target of TARGETS) {
    const key = `+${target}`;

    differences.targets[key] = {
      qbsRate: qbs.targets[key].rate,
      controlRate: control.targets[key].rate,
      delta: diff(
        qbs.targets[key].rate,
        control.targets[key].rate
      ),
    };
  }

  for (const drawdown of DRAWDOWNS) {
    const key = `-${drawdown}`;

    differences.drawdowns[key] = {
      qbsRate: qbs.drawdowns[key].rate,
      controlRate: control.drawdowns[key].rate,
      delta: diff(
        qbs.drawdowns[key].rate,
        control.drawdowns[key].rate
      ),
    };
  }

  return {
    qbs,
    control,
    differences,
  };
}

function validate(events, matchedPairs) {
  const violations = [];

  for (const event of events) {
    if (!event.ticker || !event.eventDate) {
      violations.push({
        type: "INVALID_EVENT_IDENTITY",
        event,
      });
    }

    if (
      !event.features ||
      !qualifies(event.features)
    ) {
      violations.push({
        type: "QBS_EVENT_NOT_QUALIFIED",
        eventId: event.eventId,
      });
    }
  }

  for (const pair of matchedPairs) {
    if (pair.qbs.eventDate !== pair.control.eventDate) {
      violations.push({
        type: "DATE_MISMATCH",
        eventId: pair.qbs.eventId,
      });
    }

    if (pair.qbs.ticker === pair.control.ticker) {
      violations.push({
        type: "SAME_TICKER_CONTROL",
        eventId: pair.qbs.eventId,
      });
    }

    if (pair.control.isQbs) {
      violations.push({
        type: "CONTROL_IS_QBS",
        eventId: pair.qbs.eventId,
      });
    }

    if (!pair.control.row.featureEligible) {
      violations.push({
        type: "CONTROL_NOT_FEATURE_ELIGIBLE",
        eventId: pair.qbs.eventId,
      });
    }
  }

  return violations;
}

async function main() {
  console.log("");
  console.log("============================================================");
  console.log("STOCKFAMILY QBS V4.9.1");
  console.log("CROSS-SECTIONAL MATCHED CONTROL");
  console.log("============================================================");
  console.log("");

  console.log("[1/6] Loading historical database...");

  const rawDatabase =
    await fetchHistoricalDataFromSupabase({
      limitDays: 5000,
    });

  const database = prepareDatabase(rawDatabase);

  const tickers = Object.keys(database);

  console.log(
    `Tickers loaded : ${tickers.length}`
  );

  const totalRows = Object.values(database)
    .reduce(
      (sum, history) => sum + history.length,
      0
    );

  console.log(
    `Rows loaded    : ${totalRows}`
  );

  console.log("");

  console.log("[2/6] Building same-date candidate universe...");

  const dateIndex = buildDateIndex(database);

  console.log(
    `Trading dates  : ${dateIndex.size}`
  );

  console.log("");

  console.log("[3/6] Detecting QBS 1.0.0 events...");

  const detection = detectQbs(database);

  const events = detection.events;

  console.log(
    `QBS events     : ${events.length}`
  );

  console.log("");

  console.log(
    "[4/6] Matching same-date cross-sectional controls..."
  );

  const matchedPairs = [];
  const unmatchedEvents = [];
  const usedControls = new Set();

  for (const event of events) {
    const candidates =
      dateIndex.get(event.eventDate) || [];

    const candidateObjects = [];

    for (const candidate of candidates) {
      const candidateKey =
        `${event.eventDate}|${candidate.ticker}`;

      if (
        candidate.ticker === event.ticker ||
        detection.qbsByDateTicker.has(candidateKey)
      ) {
        continue;
      }

      const features = calculateFeatures(
        candidate.history,
        candidate.index
      );

      if (!features) {
        continue;
      }

      if (!candidate.row.featureEligible) {
        continue;
      }

      if (
        candidate.row.dataState === "INACTIVE" ||
        candidate.row.dataState === "INVALID"
      ) {
        continue;
      }

      const outcome =
        buildOutcome(
          candidate.history,
          candidate.index,
          10
        );

      if (!outcome) {
        continue;
      }

      candidateObjects.push({
        ticker: candidate.ticker,
        history: candidate.history,
        index: candidate.index,
        row: candidate.row,
        features,
        profile: buildH0Profile(
          features,
          candidate.row
        ),
        outcome,
        isQbs: false,
      });
    }

    const control = selectControl(
      event,
      candidateObjects,
      usedControls
    );

    if (!control) {
      unmatchedEvents.push(event);
      continue;
    }

    usedControls.add(
      `${event.eventDate}|${control.ticker}`
    );

    matchedPairs.push({
      pairId: `PAIR-${event.eventDate}-${event.ticker}-${control.ticker}`,
      eventDate: event.eventDate,
      qbs: {
        eventId: event.eventId,
        ticker: event.ticker,
        row: database[event.ticker][event.index],
        features: event.features,
        profile: event.profile,
        outcome: event.outcome,
      },
      control: {
        ticker: control.ticker,
        row: control.row,
        features: control.features,
        profile: control.profile,
        outcome: control.outcome,
        isQbs: false,
      },
      match: {
        sameDate: true,
        sameTicker: false,
        qbsExcluded: true,
        qbsStratum: buildStratum(
          event.profile
        ),
        controlStratum: buildStratum(
          control.profile
        ),
        distance: normalizedDistance(
          event.profile,
          control.profile
        ),
      },
    });
  }

  console.log(
    `Matched pairs  : ${matchedPairs.length}`
  );

  console.log(
    `Unmatched QBS  : ${unmatchedEvents.length}`
  );

  console.log("");

  const qbsItems = matchedPairs.map(
    (pair) => ({
      ...pair.qbs,
      pairId: pair.pairId,
    })
  );

  const controlItems = matchedPairs.map(
    (pair) => ({
      ...pair.control,
      pairId: pair.pairId,
    })
  );

  console.log(
    "[5/6] Building comparative evidence..."
  );

  const comparison =
    buildComparativeSummary(
      qbsItems,
      controlItems
    );

  console.log("");
  console.log("QBS GROUP");
  console.log(
    `Events            : ${comparison.qbs.events}`
  );

  for (const horizon of HORIZONS) {
    const x =
      comparison.qbs.horizons[horizon];

    console.log(
      `H+${horizon} | MFE ${format(x.mfeAvg)}% | MAE ${format(x.maeAvg)}% | Close ${format(x.closeReturnAvg)}% | Valid ${x.valid}`
    );
  }

  console.log("");
  console.log("CONTROL GROUP");
  console.log(
    `Events            : ${comparison.control.events}`
  );

  for (const horizon of HORIZONS) {
    const x =
      comparison.control.horizons[horizon];

    console.log(
      `H+${horizon} | MFE ${format(x.mfeAvg)}% | MAE ${format(x.maeAvg)}% | Close ${format(x.closeReturnAvg)}% | Valid ${x.valid}`
    );
  }

  console.log("");
  console.log("COMPARATIVE DELTA: QBS - CONTROL");

  for (const horizon of HORIZONS) {
    const x =
      comparison.differences.horizons[horizon];

    console.log(
      `H+${horizon} | MFE ${format(x.mfeDelta)} pp | MAE ${format(x.maeDelta)} pp | Close ${format(x.closeReturnDelta)} pp`
    );
  }

  console.log("");
  console.log("TARGET COMPARISON");

  for (const target of TARGETS) {
    const key = `+${target}`;
    const x =
      comparison.differences.targets[key];

    console.log(
      `${key}% | QBS ${format(x.qbsRate)}% | Control ${format(x.controlRate)}% | Delta ${format(x.delta)} pp`
    );
  }

  console.log("");
  console.log("DRAWDOWN COMPARISON");

  for (const drawdown of DRAWDOWNS) {
    const key = `-${drawdown}`;
    const x =
      comparison.differences.drawdowns[key];

    console.log(
      `${key}% | QBS ${format(x.qbsRate)}% | Control ${format(x.controlRate)}% | Delta ${format(x.delta)} pp`
    );
  }

  console.log("");

  console.log(
    "[6/6] Validating cross-sectional contract..."
  );

  const violations =
    validate(
      events,
      matchedPairs
    );

  const contractStatus =
    violations.length === 0
      ? "PASS"
      : "FAIL";

  console.log(
    `Contract status : ${contractStatus}`
  );

  console.log(
    `Violations      : ${violations.length}`
  );

  const result = {
    contract: CONTRACT,
    generatedAt: new Date().toISOString(),

    dataset: {
      tickers: tickers.length,
      rows: totalRows,
      tradingDates: dateIndex.size,
    },

    detection: {
      qbsEvents: events.length,
      unmatchedQbs: unmatchedEvents.length,
      matchedPairs: matchedPairs.length,
    },

    matching: {
      method:
        CONTRACT.controlMethod,
      sameDate: true,
      differentTicker: true,
      qbsExcluded: true,
      outcomeUsedForSelection: false,
      optimization: false,
      reusableControlAllowed: false,
    },

    summary: comparison,

    matchedPairs,

    unmatchedEvents: unmatchedEvents.map(
      (event) => ({
        eventId: event.eventId,
        ticker: event.ticker,
        eventDate: event.eventDate,
      })
    ),

    validation: {
      contractStatus,
      violations,
    },
  };

  const outputPath = path.join(
    __dirname,
    "..",
    "results",
    "qbs_cross_stock_cross_sectional_v4.9.1.json"
  );

  fs.mkdirSync(
    path.dirname(outputPath),
    { recursive: true }
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      result,
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log(
    "============================================================"
  );
  console.log("V4.9.1 COMPLETE");
  console.log(
    "============================================================"
  );
  console.log(
    `Output: ${outputPath}`
  );
  console.log("");
}

function format(value) {
  return finite(value)
    ? num(value).toFixed(2)
    : "NA";
}

main().catch((error) => {
  console.error("");
  console.error("V4.9.1 FAILED");
  console.error(error);
  process.exitCode = 1;
});