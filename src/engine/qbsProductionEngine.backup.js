const fs = require("fs");
const path = require("path");

const SPEC_FILE = path.join(
__dirname,
"..",
"..",
"qbs_production_specification.json"
);

function loadSpecification() {
if (!fs.existsSync(SPEC_FILE)) {
throw new Error(
`QBS specification tidak ditemukan: ${SPEC_FILE}`
);
}

return JSON.parse(
fs.readFileSync(
SPEC_FILE,
"utf8"
)
);
}

const SPEC = loadSpecification();

function numberOrNull(value) {
const n = Number(value);

return Number.isFinite(n)
? n
: null;
}

function normalizeDate(value) {
if (!value) {
return null;
}

return String(value).slice(0, 10);
}

function dateOf(row) {
return normalizeDate(
row?.trade_date ??
row?.tradeDate ??
row?.date
);
}

function closeOf(row) {
return numberOrNull(row?.close);
}

function highOf(row) {
return numberOrNull(row?.high);
}

function lowOf(row) {
return numberOrNull(row?.low);
}

function openOf(row) {
return numberOrNull(row?.open);
}

function volumeOf(row) {
return numberOrNull(row?.volume);
}

function valueOf(row) {
return numberOrNull(row?.value);
}

function frequencyOf(row) {
return numberOrNull(row?.frequency);
}

function bidVolumeOf(row) {
return numberOrNull(
row?.bid_volume ??
row?.bidVolume
);
}

function offerVolumeOf(row) {
return numberOrNull(
row?.offer_volume ??
row?.offerVolume
);
}

function foreignBuyOf(row) {
return numberOrNull(
row?.foreign_buy ??
row?.foreignBuy
);
}

function foreignSellOf(row) {
return numberOrNull(
row?.foreign_sell ??
row?.foreignSell
);
}

function foreignNetOf(row) {
const direct = numberOrNull(
row?.net_foreign ??
row?.netForeign
);

if (direct !== null) {
return direct;
}

const buy = foreignBuyOf(row);
const sell = foreignSellOf(row);

if (
buy === null ||
sell === null
) {
return null;
}

return buy - sell;
}

function changeOf(row) {
const direct = numberOrNull(
row?.change
);

if (direct !== null) {
return direct;
}

const close = closeOf(row);
const previous = numberOrNull(
row?.previous_price ??
row?.previousPrice ??
row?.previous
);

if (
close === null ||
previous === null ||
previous === 0
) {
return null;
}

return (
((close / previous) - 1) *
100
);
}

function normalizeHistory(rows) {
if (!Array.isArray(rows)) {
return [];
}

return rows
.map((row) => ({
date: dateOf(row),
open: openOf(row),
high: highOf(row),
low: lowOf(row),
close: closeOf(row),
volume: volumeOf(row),
value: valueOf(row),
frequency: frequencyOf(row),
bidVolume: bidVolumeOf(row),
offerVolume: offerVolumeOf(row),
foreignBuy: foreignBuyOf(row),
foreignSell: foreignSellOf(row),
foreignNet: foreignNetOf(row),
change: changeOf(row),
raw: row
}))
.filter(
(row) =>
row.date !== null
)
.sort(
(a, b) =>
a.date.localeCompare(
b.date
)
);
}

function mean(values) {
const valid = values.filter(
Number.isFinite
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

function standardDeviation(values) {
const valid = values.filter(
Number.isFinite
);

if (!valid.length) {
return null;
}

const avg = mean(valid);

const variance =
valid.reduce(
(sum, value) =>
sum +
(value - avg) ** 2,
0
) / valid.length;

return Math.sqrt(
variance
);
}

function calculateFeatures(
history,
index
) {
const h0 =
history[index];

if (!h0) {
return null;
}

const lookback =
SPEC.feature_engine
.lookback ?? 20;

if (
index < lookback
) {
return null;
}

const previousRows =
history.slice(
index - lookback,
index
);

if (
previousRows.length <
lookback
) {
return null;
}

const closes =
previousRows
.map(
(row) =>
row.close
)
.filter(
Number.isFinite
);

const volumes =
previousRows
.map(
(row) =>
row.volume
)
.filter(
Number.isFinite
);

const frequencies =
previousRows
.map(
(row) =>
row.frequency
)
.filter(
Number.isFinite
);

const highs =
previousRows
.map(
(row) =>
row.high
)
.filter(
Number.isFinite
);

const lows =
previousRows
.map(
(row) =>
row.low
)
.filter(
Number.isFinite
);

if (
closes.length <
lookback ||
volumes.length <
lookback ||
frequencies.length <
lookback ||
highs.length <
lookback ||
lows.length <
lookback
) {
return null;
}

const sma20 =
mean(closes);

const std20 =
standardDeviation(
closes
);

const bbWidth =
sma20 !== null &&
sma20 !== 0 &&
std20 !== null
? (4 * std20) /
sma20
: null;

const minLow20 =
Math.min(...lows);

const maxHigh20 =
Math.max(...highs);

const priceRange20 =
minLow20 !== 0
? (
maxHigh20 -
minLow20
) / minLow20
: null;

const averageVolume =
mean(volumes);

const averageFrequency =
mean(frequencies);

const volumeSurge =
averageVolume !== null &&
averageVolume !== 0 &&
h0.volume !== null
? h0.volume /
averageVolume
: null;

const frequencySurge =
averageFrequency !== null &&
averageFrequency !== 0 &&
h0.frequency !== null
? h0.frequency /
averageFrequency
: null;

const closePosition =
h0.high !== null &&
h0.low !== null &&
h0.close !== null &&
h0.high !== h0.low
? (
h0.close -
h0.low
) /
(
h0.high -
h0.low
)
: null;

return {
bbWidth,
priceRange20,
volumeSurge,
frequencySurge,
closePosition,
changePct: h0.change,

```
sma20,
std20,

h0: {
  date: h0.date,
  open: h0.open,
  high: h0.high,
  low: h0.low,
  close: h0.close,
  volume: h0.volume,
  value: h0.value,
  frequency: h0.frequency,
  bidVolume: h0.bidVolume,
  offerVolume: h0.offerVolume,
  foreignNet: h0.foreignNet
}
```

};
}

function qualifies(features) {
if (!features) {
return false;
}

const rules =
SPEC.qbs_detector
.baseline_rules;

const close =
features.h0.close;

const value =
features.h0.value;

if (
close === null ||
close < rules.close_min
) {
return false;
}

if (
value === null ||
value < rules.value_min
) {
return false;
}

if (
features.bbWidth === null ||
features.bbWidth >=
rules.bb_width_max_exclusive
) {
return false;
}

if (
features.priceRange20 === null ||
features.priceRange20 >=
rules.price_range_20_max_exclusive
) {
return false;
}

if (
features.volumeSurge === null ||
features.volumeSurge <
rules.volume_surge_min
) {
return false;
}

if (
features.frequencySurge === null ||
features.frequencySurge <
rules.frequency_surge_min
) {
return false;
}

return true;
}

function calculateQbsScore(
features
) {
if (!features) {
return null;
}

let score = 0;

const cp =
features.closePosition;

const volume =
features.volumeSurge;

const frequency =
features.frequencySurge;

const priceRange =
features.priceRange20;

const bbWidth =
features.bbWidth;

if (
Number.isFinite(cp)
) {
if (cp >= 0.95) {
score += 3;
} else if (cp >= 0.80) {
score += 2;
}
}

if (
Number.isFinite(volume)
) {
if (
volume >= 20 &&
volume < 40
) {
score += 2;
} else if (
volume >= 40 &&
volume < 80
) {
score += 3;
} else if (
volume >= 80 &&
volume < 120
) {
score += 1;
}
}

if (
Number.isFinite(frequency)
) {
if (
frequency >= 10 &&
frequency < 25
) {
score += 1;
} else if (
frequency >= 25 &&
frequency < 60
) {
score += 3;
}
}

if (
Number.isFinite(priceRange)
) {
if (
priceRange >= 0.08 &&
priceRange < 0.10
) {
score += 1;
} else if (
priceRange >= 0.10 &&
priceRange < 0.15
) {
score += 2;
}
}

if (
Number.isFinite(bbWidth) &&
bbWidth >= 0.04 &&
bbWidth < 0.06
) {
score += 1;
}

return score;
}

function getQbsBand(
score
) {
if (!Number.isFinite(score)) {
return null;
}

if (score <= 3) {
return "0-3";
}

if (score <= 6) {
return "4-6";
}

if (score <= 9) {
return "7-9";
}

return "10+";
}

function buildTrajectory(
history,
h0Index
) {
const h0 =
history[h0Index];

if (!h0) {
return [];
}

const entry =
h0.close;

if (
!Number.isFinite(entry) ||
entry === 0
) {
return [];
}

const future =
history.slice(
h0Index + 1,
h0Index + 21
);

return future.map(
(row, index) => ({
step: index + 1,
date: row.date,
open: row.open,
high: row.high,
low: row.low,
close: row.close,

```
  highReturn:
    Number.isFinite(
      row.high
    )
      ? (
          row.high /
            entry -
          1
        ) * 100
      : null,

  lowReturn:
    Number.isFinite(
      row.low
    )
      ? (
          row.low /
            entry -
          1
        ) * 100
      : null,

  closeReturn:
    Number.isFinite(
      row.close
    )
      ? (
          row.close /
            entry -
          1
        ) * 100
      : null
})
```

);
}

function classifyPath(
trajectory
) {
if (
!trajectory.length
) {
return "NO_DATA";
}

const highs =
trajectory
.map(
(row) =>
row.highReturn
)
.filter(
Number.isFinite
);

const lows =
trajectory
.map(
(row) =>
row.lowReturn
)
.filter(
Number.isFinite
);

const early =
trajectory.filter(
(row) =>
row.step <= 3
);

const earlyHighs =
early
.map(
(row) =>
row.highReturn
)
.filter(
Number.isFinite
);

const earlyLows =
early
.map(
(row) =>
row.lowReturn
)
.filter(
Number.isFinite
);

const maxHigh =
highs.length
? Math.max(...highs)
: -Infinity;

const minLow =
lows.length
? Math.min(...lows)
: Infinity;

const earlyHigh =
earlyHighs.length
? Math.max(
...earlyHighs
)
: -Infinity;

const earlyLow =
earlyLows.length
? Math.min(
...earlyLows
)
: Infinity;

if (
maxHigh >= 20 &&
earlyHigh >= 10
) {
return "EARLY_EXPANSION";
}

if (
maxHigh >= 20 &&
earlyLow <= -5
) {
return "SHAKEOUT_TO_EXPANSION";
}

if (
maxHigh >= 10 &&
earlyHigh < 10
) {
return "SLOW_EXPANSION";
}

if (
maxHigh >= 5 &&
earlyLow <= -3
) {
return "SHAKEOUT_TO_EXPANSION";
}

if (
maxHigh >= 5
) {
return "EXPANSION";
}

if (
minLow <= -5
) {
return "FAILED_EVENT";
}

return "NO_SIGNIFICANT_EXPANSION";
}

function classifyCurrentState(
trajectory
) {
if (
!trajectory.length
) {
return "DETECTED";
}

const path =
classifyPath(
trajectory
);

if (
path ===
"EARLY_EXPANSION"
) {
return "EARLY_EXPANSION";
}

if (
path ===
"SHAKEOUT_TO_EXPANSION"
) {
return "SHAKEOUT";
}

if (
path ===
"SLOW_EXPANSION"
) {
return "SLOW_EXPANSION";
}

if (
path ===
"EXPANSION"
) {
return "EXPANSION";
}

if (
path ===
"FAILED_EVENT"
) {
return "FAILED";
}

return "DETECTED";
}

function getEventStatus(
state,
trajectoryLength
) {
if (
state === "FAILED"
) {
return "FAILED";
}

if (
state === "EXHAUSTION"
) {
return "EXHAUSTED";
}

if (
trajectoryLength >= 20
) {
return "COMPLETED";
}

return "TRACKING";
}

function calculateOutcome(
trajectory
) {
if (
!trajectory.length
) {
return {
mfe: null,
mae: null,
high5: false,
high10: false,
high15: false,
high20: false,
timeTo5: null,
timeTo10: null,
timeTo15: null,
timeTo20: null,
drawdown3: false,
drawdown5: false,
drawdown7: false,
drawdown10: false,
drawdown15: false,
drawdown20: false
};
}

const highs =
trajectory
.map(
(row) =>
row.highReturn
)
.filter(
Number.isFinite
);

const lows =
trajectory
.map(
(row) =>
row.lowReturn
)
.filter(
Number.isFinite
);

const mfe =
highs.length
? Math.max(...highs)
: null;

const mae =
lows.length
? Math.min(...lows)
: null;

function firstTarget(
target
) {
const row =
trajectory.find(
(item) =>
Number.isFinite(
item.highReturn
) &&
item.highReturn >=
target
);

```
return row
  ? row.step
  : null;
```

}

function hitDrawdown(
threshold
) {
return trajectory.some(
(item) =>
Number.isFinite(
item.lowReturn
) &&
item.lowReturn <=
-threshold
);
}

return {
mfe,
mae,

```
high5:
  mfe !== null &&
  mfe >= 5,

high10:
  mfe !== null &&
  mfe >= 10,

high15:
  mfe !== null &&
  mfe >= 15,

high20:
  mfe !== null &&
  mfe >= 20,

timeTo5:
  firstTarget(5),

timeTo10:
  firstTarget(10),

timeTo15:
  firstTarget(15),

timeTo20:
  firstTarget(20),

drawdown3:
  hitDrawdown(3),

drawdown5:
  hitDrawdown(5),

drawdown7:
  hitDrawdown(7),

drawdown10:
  hitDrawdown(10),

drawdown15:
  hitDrawdown(15),

drawdown20:
  hitDrawdown(20)
```

};
}

function getTickerName(
database,
ticker
) {
const history =
database[ticker];

if (
!Array.isArray(history) ||
!history.length
) {
return null;
}

const row =
history[history.length - 1];

return (
row.stock_name ??
row.stockName ??
row.name ??
null
);
}

function buildMarketContext(
database,
targetDate
) {
const rows = [];

for (
const [ticker, rawHistory]
of Object.entries(
database
)
) {
const history =
normalizeHistory(
rawHistory
);

```
const row =
  history.find(
    (item) =>
      item.date ===
      targetDate
  );

if (!row) {
  continue;
}

rows.push({
  ticker,
  close: row.close,
  value: row.value,
  change: row.change,
  foreignNet:
    row.foreignNet
});
```

}

if (!rows.length) {
return {
regime: "NORMAL",
metrics: {
breadth: null,
liquidBreadth: null,
medianChange: null,
averageChange: null,
dispersion: null,
aggregateForeignFlow: null,
effectiveBreadth: null
}
};
}

const advancing =
rows.filter(
(row) =>
row.change !== null &&
row.change > 0
).length;

const declining =
rows.filter(
(row) =>
row.change !== null &&
row.change < 0
).length;

const totalDirection =
advancing +
declining;

const breadth =
totalDirection > 0
? (
advancing -
declining
) /
totalDirection
: null;

const liquid =
rows.filter(
(row) =>
row.value !== null &&
row.value >=
2000000000
);

const liquidAdvancing =
liquid.filter(
(row) =>
row.change !== null &&
row.change > 0
).length;

const liquidDeclining =
liquid.filter(
(row) =>
row.change !== null &&
row.change < 0
).length;

const liquidDirection =
liquidAdvancing +
liquidDeclining;

const liquidBreadth =
liquidDirection > 0
? (
liquidAdvancing -
liquidDeclining
) /
liquidDirection
: null;

const changes =
rows
.map(
(row) =>
row.change
)
.filter(
Number.isFinite
)
.sort(
(a, b) => a - b
);

const medianChange =
changes.length
? changes[
Math.floor(
changes.length / 2
)
]
: null;

const averageChange =
mean(changes);

const p25 =
changes.length
? changes[
Math.floor(
(changes.length - 1) *
0.25
)
]
: null;

const p75 =
changes.length
? changes[
Math.floor(
(changes.length - 1) *
0.75
)
]
: null;

const dispersion =
p25 !== null &&
p75 !== null
? p75 - p25
: null;

const foreignValues =
rows
.map(
(row) =>
row.foreignNet
)
.filter(
Number.isFinite
);

const aggregateForeignFlow =
foreignValues.length
? foreignValues.reduce(
(sum, value) =>
sum + value,
0
)
: null;

const effectiveBreadth =
liquidBreadth !== null
? liquidBreadth
: breadth;

let regime =
"NORMAL";

const bullish =
effectiveBreadth !== null &&
medianChange !== null &&
aggregateForeignFlow !== null &&
effectiveBreadth >= 0.20 &&
medianChange >= 0.5 &&
aggregateForeignFlow >= 0;

const stress =
effectiveBreadth !== null &&
medianChange !== null &&
aggregateForeignFlow !== null &&
effectiveBreadth <= -0.30 &&
medianChange <= -0.75 &&
aggregateForeignFlow <= 0;

const weak =
(
effectiveBreadth !== null &&
effectiveBreadth <= -0.10
) ||
(
medianChange !== null &&
medianChange < -0.25
);

if (bullish) {
regime = "BULLISH";
} else if (stress) {
regime = "STRESS";
} else if (weak) {
regime = "WEAK";
}

return {
regime,

```
metrics: {
  breadth,
  liquidBreadth,
  medianChange,
  averageChange,
  dispersion,
  aggregateForeignFlow,
  effectiveBreadth,
  universeSize:
    rows.length,
  liquidUniverseSize:
    liquid.length
}
```

};
}

function analyzeSymbol(
ticker,
rawHistory,
targetDate,
options = {}
) {
const history =
normalizeHistory(
rawHistory
);

if (!history.length) {
return null;
}

const index =
history.findIndex(
(row) =>
row.date ===
targetDate
);

if (index < 0) {
return null;
}

const features =
calculateFeatures(
history,
index
);

if (!features) {
return {
symbol: ticker,
eventDate: targetDate,
status: "INSUFFICIENT_HISTORY"
};
}

const detected =
qualifies(
features
);

if (!detected) {
return null;
}

const qbsScore =
calculateQbsScore(
features
);

const qbsBand =
getQbsBand(
qbsScore
);

const trajectory =
options.includeTrajectory
? buildTrajectory(
history,
index
)
: [];

const state =
trajectory.length
? classifyCurrentState(
trajectory
)
: "DETECTED";

const outcome =
options.includeOutcome
? calculateOutcome(
trajectory
)
: null;

const eventStatus =
options.includeOutcome
? getEventStatus(
state,
trajectory.length
)
: "TRACKING";

return {
symbol: ticker,
stockName:
getTickerName(
{
[ticker]:
rawHistory
},
ticker
),

```
eventDate:
  targetDate,

detected: true,

qbsScore,
qbsBand,

state,

quality:
  options.includeOutcome &&
  trajectory.length >= 20
    ? null
    : "PENDING",

marketRegime:
  options.marketRegime ??
  null,

eventStatus,

h0: {
  open:
    features.h0.open,
  high:
    features.h0.high,
  low:
    features.h0.low,
  close:
    features.h0.close,
  value:
    features.h0.value,
  volume:
    features.h0.volume,
  frequency:
    features.h0.frequency,
  bidVolume:
    features.h0.bidVolume,
  offerVolume:
    features.h0.offerVolume,
  foreignNet:
    features.h0.foreignNet,
  changePct:
    features.changePct
},

features: {
  bbWidth:
    features.bbWidth,
  priceRange20:
    features.priceRange20,
  volumeSurge:
    features.volumeSurge,
  frequencySurge:
    features.frequencySurge,
  closePosition:
    features.closePosition,
  changePct:
    features.changePct
},

outcome,

trajectory:
  options.includeTrajectory
    ? trajectory
    : []
```

};
}

async function runQbsProduction({
database,
targetDate,
includeTrajectory = false,
includeOutcome = false
} = {}) {
if (
!database ||
typeof database !==
"object"
) {
throw new Error(
"Database QBS tidak valid."
);
}

const symbols =
Object.keys(
database
);

if (!symbols.length) {
throw new Error(
"Database QBS kosong."
);
}

const dates = [];

for (
const rawHistory of
Object.values(
database
)
) {
if (
!Array.isArray(
rawHistory
)
) {
continue;
}

```
for (
  const row of
    rawHistory
) {
  const date =
    dateOf(row);

  if (date) {
    dates.push(date);
  }
}
```

}

const latestDate =
dates.length
? dates.sort().at(-1)
: null;

const effectiveDate =
targetDate ??
latestDate;

if (!effectiveDate) {
throw new Error(
"Tidak dapat menentukan target date."
);
}

const market =
buildMarketContext(
database,
effectiveDate
);

const results = [];

let processed = 0;
let skipped = 0;

for (
const ticker of symbols
) {
const result =
analyzeSymbol(
ticker,
database[ticker],
effectiveDate,
{
includeTrajectory,
includeOutcome,
marketRegime:
market.regime
}
);

```
if (!result) {
  skipped++;
  continue;
}

if (
  result.status ===
  "INSUFFICIENT_HISTORY"
) {
  skipped++;
  continue;
}

processed++;

results.push(
  result
);
```

}

results.sort(
(a, b) =>
b.qbsScore -
a.qbsScore ||
(
b.features
.volumeSurge ?? 0
) -
(
a.features
.volumeSurge ?? 0
) ||
(
b.h0.value ?? 0
) -
(
a.h0.value ?? 0
)
);

const scoreDistribution =
{
"0-3": 0,
"4-6": 0,
"7-9": 0,
"10+": 0
};

const stateDistribution =
{};

for (
const event of
results
) {
if (
scoreDistribution[
event.qbsBand
] !== undefined
) {
scoreDistribution[
event.qbsBand
]++;
}

```
stateDistribution[
  event.state
] =
  (
    stateDistribution[
      event.state
    ] ?? 0
  ) + 1;
```

}

return {
specificationVersion:
SPEC.specification
?.version ??
"unknown",

```
engineVersion:
  "1.0.0",

generatedAt:
  new Date().toISOString(),

targetDate:
  effectiveDate,

diagnostics: {
  symbolsLoaded:
    symbols.length,
  symbolsProcessed:
    processed,
  symbolsSkipped:
    skipped,
  eventsDetected:
    results.length
},

market: {
  regime:
    market.regime,
  metrics:
    market.metrics
},

distribution: {
  score:
    scoreDistribution,
  state:
    stateDistribution
},

events:
  results
```

};
}

function validateProductionResult(
result
) {
const errors = [];

if (!result) {
errors.push(
"RESULT_NULL"
);

```
return {
  valid: false,
  errors
};
```

}

if (
!result.targetDate
) {
errors.push(
"MISSING_TARGET_DATE"
);
}

if (
!Array.isArray(
result.events
)
) {
errors.push(
"EVENTS_NOT_ARRAY"
);
}

const allowedBands =
new Set([
"0-3",
"4-6",
"7-9",
"10+"
]);

const allowedStates =
new Set([
"DETECTED",
"EARLY_EXPANSION",
"SHAKEOUT",
"SLOW_EXPANSION",
"EXPANSION",
"FAILED",
"EXHAUSTION"
]);

for (
const event of
result.events ?? []
) {
if (
!event.symbol
) {
errors.push(
"MISSING_SYMBOL"
);
}

```
if (
  !event.eventDate
) {
  errors.push(
    "MISSING_EVENT_DATE"
  );
}

if (
  !allowedBands.has(
    event.qbsBand
  )
) {
  errors.push(
    `INVALID_QBS_BAND:${event.symbol}`
  );
}

if (
  !allowedStates.has(
    event.state
  )
) {
  errors.push(
    `INVALID_STATE:${event.symbol}`
  );
}

if (
  event.detected !==
  true
) {
  errors.push(
    `INVALID_DETECTED_FLAG:${event.symbol}`
  );
}

if (
  !Number.isFinite(
    event.qbsScore
  )
) {
  errors.push(
    `INVALID_QBS_SCORE:${event.symbol}`
  );
}
```

}

return {
valid:
errors.length === 0,
errors
};
}

module.exports = {
SPEC,
normalizeHistory,
calculateFeatures,
qualifies,
calculateQbsScore,
getQbsBand,
buildTrajectory,
classifyPath,
classifyCurrentState,
calculateOutcome,
buildMarketContext,
analyzeSymbol,
runQbsProduction,
validateProductionResult
};
