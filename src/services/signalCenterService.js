'use strict';

const fs = require('fs');
const path = require('path');

/**
 * CHARTNALIST — Signal Center Adapter
 *
 * VIEW / ADAPTER ONLY.
 *
 * Authoritative source:
 *   daily_stock_data
 *        ↓
 *   Signal Engine
 *        ↓
 *   buildSmartwatchlist()
 *
 * This module does NOT:
 * - create a score
 * - create BUY / SELL
 * - create a new trigger
 * - calculate a new invalidation
 * - calculate a new target
 * - calculate a new R:R
 * - use QBS
 * - modify Setup Engine
 * - modify Risk Engine
 * - modify Signal Lifecycle
 */

const { buildSmartwatchlist } = require('./smartwatchlistService');

const CACHE_TTL_MS = 30 * 1000;

const SNAPSHOT_FILE = path.join(
  process.cwd(),
  'data',
  'signal-center-snapshot.json'
);

let refreshPromise = null;

let cache = {
  timestamp: 0,
  data: null,
};

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanSignal(row) {
  return {
    stockCode: String(row.stockCode || '').trim().toUpperCase(),
    stockName: row.stockName || row.stockCode || '',
    setup: row.setup || null,
    status: row.status || 'OBSERVE',

    price: cleanNumber(row.price),
    trigger: cleanNumber(row.trigger),
    invalidation: cleanNumber(row.invalidation),
    target1: cleanNumber(row.target1),
    target2: cleanNumber(row.target2),
    riskReward: cleanNumber(row.riskReward),

    riskLevel: row.riskLevel || null,

    structure: row.structure || null,
    participation: row.participation || null,
    flow: row.flow || null,
    liquidity: row.liquidity || null,

    signalDate: row.signalDate || null,
    updatedAt: new Date().toISOString(),
  };
}

function rankSignal(row) {
  const statusRank = {
    ACTIVE: 0,
    TRIGGERED: 1,
    WATCH: 2,
    OBSERVE: 3,
    TARGET: 4,
    INVALIDATED: 5,
  };

  const setupRank = {
    BREAKOUT: 0,
    PULLBACK: 1,
    ACCUMULATION: 2,
  };

  return [
    statusRank[row.status] ?? 99,
    setupRank[row.setup] ?? 99,
    row.stockCode,
  ];
}


function readSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return null;

    const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf8');
    const snapshot = JSON.parse(raw);

    if (!snapshot || snapshot.success !== true) return null;
    if (!Array.isArray(snapshot.signals)) return null;

    return snapshot;
  } catch (error) {
    console.warn(
      '[Signal Center] Snapshot read failed:',
      error?.message || error
    );

    return null;
  }
}

function writeSnapshot(payload) {
  try {
    const dir = path.dirname(SNAPSHOT_FILE);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tempFile = `${SNAPSHOT_FILE}.tmp`;

    fs.writeFileSync(
      tempFile,
      JSON.stringify(payload, null, 2),
      'utf8'
    );

    fs.renameSync(tempFile, SNAPSHOT_FILE);
  } catch (error) {
    console.warn(
      '[Signal Center] Snapshot write failed:',
      error?.message || error
    );
  }
}

async function calculateSignalCenter(normalized, cacheKey) {
  const result = await buildSmartwatchlist(normalized);

  const signals = (result?.stocks || [])
    .map(cleanSignal)
    .sort((a, b) => {
      const ar = rankSignal(a);
      const br = rankSignal(b);

      for (let i = 0; i < ar.length; i += 1) {
        if (ar[i] < br[i]) return -1;
        if (ar[i] > br[i]) return 1;
      }

      return 0;
    });

  const payload = {
    success: true,
    date: result?.date || null,
    count: signals.length,
    signals,
    source: 'Signal Engine → Smartwatchlist Adapter',
    mode: 'SIGNAL_MONITOR',
    generatedAt: new Date().toISOString(),
  };

  writeSnapshot(payload);

  cache = {
    timestamp: Date.now(),
    data: {
      cacheKey,
      payload,
    },
  };

  return payload;
}
async function buildSignalCenter(codes = [], options = {}) {
  const normalized = [
    ...new Set(
      (codes || [])
        .map(code => String(code).trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  const cacheKey = normalized.slice().sort().join(',');

  /*
   * Layer 1 — memory cache.
   */
  if (
    cache.data &&
    cache.timestamp &&
    Date.now() - cache.timestamp < CACHE_TTL_MS &&
    cache.data.cacheKey === cacheKey
  ) {
    return cache.data.payload;
  }

  /*
   * Layer 2 — persistent snapshot.
   *
   * Only the full-universe Signal Center can use this snapshot.
   * Explicit ticker requests continue to use the authoritative
   * Smartwatchlist calculation.
   */
  const fullUniverse = options.fullUniverse === true;

  if (fullUniverse) {
    const snapshot = readSnapshot();

    if (snapshot && snapshot.date) {
      cache = {
        timestamp: Date.now(),
        data: {
          cacheKey,
          payload: snapshot,
        },
      };

      return snapshot;
    }
  }

  /*
   * Layer 3 — authoritative calculation.
   *
   * The existing Smartwatchlist adapter remains the only
   * source of Signal Engine output.
   */
  if (!refreshPromise) {
    refreshPromise = calculateSignalCenter(
      normalized,
      cacheKey
    ).finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

module.exports = {
  buildSignalCenter,
  readSnapshot,
  writeSnapshot,
};


