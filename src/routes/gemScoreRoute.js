const express = require("express");
const router = express.Router();
const {
  getLatestGemScores,
  getGemScoreHistory,
  getCachedGemScores,
  computeAndCacheAllGemScores,
} = require("../services/gemScoreService");

/**
 * GET /api/gem-score/latest?codes=BBCA,RSGK
 */
router.get("/latest", async (req, res) => {
  try {
    const codesParam = req.query.codes || "";
    const codes = codesParam
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);

    if (codes.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Parameter codes wajib diisi",
      });
    }

    const data = await getLatestGemScores(codes);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error("GEM Score latest error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/gem-score/history/:code
 */
router.get("/history/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const data = await getGemScoreHistory(code);
    res.json({ success: true, code, count: data.length, data });
  } catch (err) {
    console.error("GEM Score history error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/gem-score/batch
 * Ambil semua saham dari cache (cepat)
 */
router.get("/batch", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    const result = await getCachedGemScores(force);
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      updated_at: result.updated_at,
      count: result.count,
      data: result.data,
    });
  } catch (err) {
    console.error("GEM Score batch error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/gem-score/refresh
 * Paksa hitung ulang semua saham
 */
router.post("/refresh", async (req, res) => {
  try {
    const result = await computeAndCacheAllGemScores();
    res.json({
      success: true,
      message: "GEM Score berhasil di-refresh",
      updated_at: result.updated_at,
      count: result.count,
    });
  } catch (err) {
    console.error("GEM Score refresh error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;