"use strict";
/**
 * CHARTNALIST Screener — Production Runner
 * Engine: Late Momentum (longgar, validated)
 */
const fs = require("fs");
const path = require("path");
const { runLateMomentumScreener } = require("./engine/lateMomentumEngine");

async function main() {
  console.log("Engine: Late Momentum longgar v1 (validated)");
  const result = await runLateMomentumScreener({ limitDays: 60 });

  const payload = {
    status: result.status,
    engine: result.engine,
    formula: result.formula,
    validation: result.validation,
    total: result.total,
    scan_date: result.scan_date,
    generated_at: new Date().toISOString(),
    data: result.data,
    results: result.results,
    signals: result.signals,
  };

  const outs = [
    path.join(__dirname, "../screener_results.json"),
    path.join(__dirname, "../public/screener_results.json"),
    path.join(__dirname, "../results/screener_results.json"),
    path.join(__dirname, "../public/results/screener_results.json"),
  ];

  for (const file of outs) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
      console.log("Wrote", file);
    } catch (e) {
      console.warn("Skip write", file, e.message);
    }
  }

  console.log(`Signals: ${payload.total}`);
  console.log("File screener_results.json berhasil diperbarui.");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main };