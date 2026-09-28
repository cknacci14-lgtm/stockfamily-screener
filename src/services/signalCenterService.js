'use strict';

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

async function buildSignalCenter(codes = []) {
  const normalized = [
    ...new Set(
      (codes || [])
        .map(code => String(code).trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  const cacheKey = normalized.slice().sort().join(',');

  if (
    cache.data &&
    cache.timestamp &&
    Date.now() - cache.timestamp < CACHE_TTL_MS &&
    cache.data.cacheKey === cacheKey
  ) {
    return cache.data.payload;
  }

  /*
   * Reuse the existing Smartwatchlist adapter.
   *
   * No second Signal Engine is created.
   * buildSmartwatchlist() remains authoritative.
   */
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

  cache = {
    timestamp: Date.now(),
    data: {
      cacheKey,
      payload,
    },
  };

  return payload;
}

module.exports = {
  buildSignalCenter,
};
