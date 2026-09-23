const fs = require("fs");
const path = require("path");
const { runBacktest } = require("./engine/backtestEngine");
async function main() {
    const args = process.argv.slice(2);
    let targetDate = null;
    args.forEach(arg => { if (arg.startsWith("--date=")) targetDate = arg.split("=")[1]; });
    console.log(`?? Backtest tanggal: ${targetDate || "TERAKHIR"}`);
    const results = await runBacktest(targetDate);
    console.log(`[Backtest] Ditemukan ${results.length} saham`);
    if (results.length > 0) {
        const avg1 = results.reduce((a,b) => a + (b.d1_pct||0), 0) / results.length;
        const avg2 = results.reduce((a,b) => a + (b.d2_pct||0), 0) / results.length;
        const avg3 = results.reduce((a,b) => a + (b.d3_pct||0), 0) / results.length;
        const winRate = results.filter(r => (r.max3_pct||0) > 3).length / results.length * 100;
        console.log(`?? Avg H+1: ${avg1.toFixed(2)}% | H+2: ${avg2.toFixed(2)}% | H+3: ${avg3.toFixed(2)}% | Winrate >3%: ${winRate.toFixed(1)}%`);
    }
    const outPaths = [
        path.join(__dirname, "..", "backtest_results.json"),
        path.join(__dirname, "..", "public", "backtest_results.json"),
        path.join(__dirname, "..", "public", "results", "backtest_results.json"),
        path.join(__dirname, "..", "results", "backtest_results.json"),
    ];
    outPaths.forEach(p => {
        try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(results, null, 2)); console.log(`? Written: ${p}`); } catch(e){}
    });
}
main();
