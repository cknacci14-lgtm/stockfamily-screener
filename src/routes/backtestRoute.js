const express = require("express");
const router = express.Router();
const { runBacktest } = require("../engine/backtestEngine");
router.get("/backtest", async function(req, res) {
    try {
        var date = req.query.date || null;
        console.log("[API Backtest] " + (date || "LATEST"));
        var results = await runBacktest(date);
        var stats = { total: results.length, avg1: 0, avg2: 0, avg3: 0, winrate: 0 };
        if (results.length > 0) {
            var sum1 = 0, sum2 = 0, sum3 = 0, win = 0;
            for (var i=0;i<results.length;i++){ sum1+=results[i].d1_pct||0; sum2+=results[i].d2_pct||0; sum3+=results[i].d3_pct||0; if((results[i].max3_pct||0)>3) win++; }
            stats.avg1 = sum1 / results.length;
            stats.avg2 = sum2 / results.length;
            stats.avg3 = sum3 / results.length;
            stats.winrate = win / results.length * 100;
        }
        res.json({ date: date || "latest", stats: stats, results: results });
    } catch (err) {
        console.error(err); res.status(500).json({ error: err.message });
    }
});
module.exports = router;
