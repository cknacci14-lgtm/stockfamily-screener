const fs = require("fs");
const path = require("path");
const {
  calculateLatestGemScores,
  calculateGemScoreForTicker,
} = require("../engine/gemScoreEngine");
const { fetchHistoricalDataFromSupabase } = require("../database/supabaseDataPipeline");

const os = require("os");

const LOCAL_CACHE_DIR = path.join(__dirname, "../../data");
const SERVERLESS_CACHE_DIR = path.join(os.tmpdir(), "stockfamily-gem-cache");

const IS_SERVERLESS =
  process.env.NETLIFY === "true" ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

const CACHE_DIR = IS_SERVERLESS
  ? SERVERLESS_CACHE_DIR
  : LOCAL_CACHE_DIR;

const CACHE_FILE = path.join(CACHE_DIR, "gem_score_latest.json");

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Ambil GEM Score terbaru untuk banyak kode
 */
async function getLatestGemScores(codes = []) {
  if (!Array.isArray(codes) || codes.length === 0) return [];
  return await calculateLatestGemScores(codes);
}

/**
 * Ambil historical GEM Score untuk 1 ticker
 */
async function getGemScoreHistory(code) {
  if (!code) return [];
  return await calculateGemScoreForTicker(code.toUpperCase());
}

/**
 * Hitung & cache SEMUA saham (batch)
 */
async function computeAndCacheAllGemScores() {
  console.log("[GEM] Mulai hitung batch semua saham...");

  // Ambil semua data
  const allData = await fetchHistoricalDataFromSupabase({ limitDays: 60 });
  if (!allData) {
    throw new Error("Gagal mengambil data dari Supabase");
  }

  const codes = Object.keys(allData);
  console.log(`[GEM] Total saham: ${codes.length}`);

  const results = [];
  let processed = 0;

  for (const code of codes) {
    try {
      const history = allData[code];
      if (!history || history.length < 25) continue;

      history.sort((a, b) => new Date(a.date) - new Date(b.date));
      const lastIndex = history.length - 1;

      // Pakai function dari engine
      const { calculateGemScore } = require("../engine/gemScoreEngine");
      const scoreData = calculateGemScore(history, lastIndex);

      results.push({
        code,
        trade_date: history[lastIndex].date,
        close: history[lastIndex].close,
        ...scoreData,
      });

      processed++;
      if (processed % 100 === 0) {
        console.log(`[GEM] Progress: ${processed}/${codes.length}`);
      }
    } catch (err) {
      console.error(`[GEM] Error ${code}:`, err.message);
    }
  }

  // Sort by score descending
  results.sort((a, b) => (b.gem_score || 0) - (a.gem_score || 0));

  // Simpan ke cache
  const payload = {
    updated_at: new Date().toISOString(),
    count: results.length,
    data: results,
  };

  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
  console.log(`[GEM] Cache disimpan: ${CACHE_FILE} (${results.length} saham)`);

  return payload;
}

/**
 * Ambil dari cache (atau hitung ulang kalau belum ada / force)
 */
async function getCachedGemScores(force = false) {
  if (!force && fs.existsSync(CACHE_FILE)) {
    try {
      const raw = fs.readFileSync(CACHE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      console.log(`[GEM] Load dari cache (${parsed.count} saham)`);
      return parsed;
    } catch (e) {
      console.warn("[GEM] Cache corrupt, hitung ulang...");
    }
  }
  return await computeAndCacheAllGemScores();
}

module.exports = {
  getLatestGemScores,
  getGemScoreHistory,
  computeAndCacheAllGemScores,
  getCachedGemScores,
};