'use strict';

/**
 * QBS Strategy v3 — Pure Functions Module
 * Locked: 2026-09-30
 * Spec: docs/qbs-v3-spec.md
 *
 * Digunakan oleh:
 *   - src/services/signalCenterService.js (production)
 *   - scripts/qbs-backtest-v2.js (backtest)
 *   - scripts/monitor-signals.js (monitor)
 */

// ===== CONSTANTS =====
const FILTER_THRESHOLDS = {
  CPOS3D_MAX: 0.65,
  FIB_MIN: 0.50,
  FIB_MAX: 0.81,
  CORR_MIN: -0.14,
  CORR_MAX: -0.03,
  VALUE_MIN: 1_000_000_000,
  VOLUME_MIN: 100_000,
  RVOL_MAX: 1.3,
  PRICE_MIN: 100,
};

const REGIME_THRESHOLDS = {
  PCT_UP_SUPPORTIVE: 0.45,
  PCT_UP_NEUTRAL: 0.40,
  MEAN_FNET_WEAK: -1_000_000,
  UNIVERSE_VALUE_MIN: 1_000_000_000,
  UNIVERSE_PRICE_MIN: 50,
};

const POSITION_SIZE = { FULL: 1.0, HALF: 0.5, SKIP: 0.0 };

// ===== HELPERS =====
function correction(close, high10d) {
  return high10d === 0 ? 0 : (close / high10d) - 1;
}

function closePos(close, high, low) {
  return high === low ? 0 : (close - low) / (high - low);
}

function computeFibRatio(close, swingHigh, swingLow) {
  const range = swingHigh - swingLow;
  return range === 0 ? 0 : (swingHigh - close) / range;
}

// ===== FILTER =====
function passesFilter(stock) {
  const corr = correction(stock.close, stock.high_10d);
  const bidPass = (stock.bid_volume === 0 && stock.offer_volume === 0)
    ? true
    : stock.bid_volume > stock.offer_volume;

  return (
    stock.fnet_3d > 0 &&
    stock.close_pos_3d_max >= FILTER_THRESHOLDS.CPOS3D_MAX &&
    stock.fib_ratio >= FILTER_THRESHOLDS.FIB_MIN &&
    stock.fib_ratio <= FILTER_THRESHOLDS.FIB_MAX &&
    corr >= FILTER_THRESHOLDS.CORR_MIN &&
    corr <= FILTER_THRESHOLDS.CORR_MAX &&
    bidPass &&
    stock.value >= FILTER_THRESHOLDS.VALUE_MIN &&
    stock.volume > FILTER_THRESHOLDS.VOLUME_MIN &&
    stock.rvol_5d < FILTER_THRESHOLDS.RVOL_MAX &&
    stock.close > FILTER_THRESHOLDS.PRICE_MIN
  );
}

function passesFilterDetailed(stock) {
  const corr = correction(stock.close, stock.high_10d);
  const bidPass = (stock.bid_volume === 0 && stock.offer_volume === 0)
    ? true
    : stock.bid_volume > stock.offer_volume;

  const checks = {
    fnet3d: stock.fnet_3d > 0,
    cpos3d: stock.close_pos_3d_max >= FILTER_THRESHOLDS.CPOS3D_MAX,
    fib: stock.fib_ratio >= FILTER_THRESHOLDS.FIB_MIN && stock.fib_ratio <= FILTER_THRESHOLDS.FIB_MAX,
    corr: corr >= FILTER_THRESHOLDS.CORR_MIN && corr <= FILTER_THRESHOLDS.CORR_MAX,
    bid: bidPass,
    value: stock.value >= FILTER_THRESHOLDS.VALUE_MIN,
    volume: stock.volume > FILTER_THRESHOLDS.VOLUME_MIN,
    rvol: stock.rvol_5d < FILTER_THRESHOLDS.RVOL_MAX,
    price: stock.close > FILTER_THRESHOLDS.PRICE_MIN,
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}

// ===== LABEL =====
function classifyLabel(stock) {
  if (stock.close_pos >= 0.55 && stock.fnet_1d >= 0) return 'A';
  if (stock.close_pos >= 0.40 || stock.fnet_1d > -0.5 * stock.fnet_3d) return 'B';
  return 'C';
}

function isDeepFib(stock) {
  return correction(stock.close, stock.high_10d) <= -0.10;
}

// ===== REGIME =====
function classifyRegime(universe) {
  const u = universe.filter(s =>
    s.value >= REGIME_THRESHOLDS.UNIVERSE_VALUE_MIN &&
    s.close > REGIME_THRESHOLDS.UNIVERSE_PRICE_MIN
  );
  if (!u.length) return { regime: 'Weak', pctUp: 0, meanFnet: 0, universeSize: 0 };

  const pctUp = u.filter(s => s.close > s.prev_close).length / u.length;
  const meanFnet = u.reduce((a, s) => a + (s.fnet_1d || 0), 0) / u.length;

  if (pctUp >= REGIME_THRESHOLDS.PCT_UP_SUPPORTIVE && meanFnet >= 0) {
    return { regime: 'Supportive', pctUp, meanFnet, universeSize: u.length };
  }
  if (pctUp >= REGIME_THRESHOLDS.PCT_UP_NEUTRAL || meanFnet > REGIME_THRESHOLDS.MEAN_FNET_WEAK) {
    return { regime: meanFnet >= 0 ? 'Neutral+' : 'Neutral-', pctUp, meanFnet, universeSize: u.length };
  }
  return { regime: 'Weak', pctUp, meanFnet, universeSize: u.length };
}

// ===== ACTION =====
function decideAction(stock, regime) {
  // v3: Supportive only. Skip semua regime lain.
  if (regime !== 'Supportive') return 'SKIP';

  const label = classifyLabel(stock);
  if (label === 'A' || label === 'B') return 'FULL';
  return 'SKIP'; // C -> SKIP
}

// ===== MAIN API =====
/**
 * Evaluate single stock in context of regime.
 * @param {Object} stock - computed features (lihat computeFeatures)
 * @param {string} regime - 'Supportive' | 'Neutral+' | 'Neutral-' | 'Weak'
 * @returns {Object} { action, label, size, filterPass, deepFib, reasons }
 */
function evaluateStock(stock, regime) {
  const filterResult = passesFilterDetailed(stock);
  if (!filterResult.pass) {
    return {
      action: 'SKIP',
      label: null,
      size: 0,
      filterPass: false,
      deepFib: false,
      failReasons: Object.entries(filterResult.checks).filter(([k, v]) => !v).map(([k]) => k),
    };
  }

  const label = classifyLabel(stock);
  const action = decideAction(stock, regime);
  const deepFib = isDeepFib(stock);

  return {
    action,
    label,
    size: POSITION_SIZE[action],
    filterPass: true,
    deepFib,
    failReasons: [],
  };
}

module.exports = {
  FILTER_THRESHOLDS,
  REGIME_THRESHOLDS,
  POSITION_SIZE,
  correction,
  closePos,
  computeFibRatio,
  passesFilter,
  passesFilterDetailed,
  classifyLabel,
  isDeepFib,
  classifyRegime,
  decideAction,
  evaluateStock,
};