const fs = require("fs");
const path = require("path");
const { runStockScreener } = require("./engine/screenerEngine");

async function main() {
    console.log("Memulai StockFamily QBS Screener...");

    const results = await runStockScreener({
        limitDays: 600,
        limit: 50,
    });

    const payload = {
        status: "success",
        lastSync: new Date().toLocaleString("id-ID"),
        total: results.length,
        data: results,
    };

    console.log(`Total hasil: ${results.length} saham`);

    const targets = [
        path.join(__dirname, "../screener_results.json"),
        path.join(__dirname, "../public/screener_results.json"),
        path.join(__dirname, "../results/screener_results.json"),
        path.join(__dirname, "../public/results/screener_results.json"),
        path.join(__dirname, "../dist/screener_results.json"),
    ];

    for (const location of targets) {
        try {
            const directory = path.dirname(location);

            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, {
                    recursive: true,
                });
            }

            fs.writeFileSync(
                location,
                JSON.stringify(payload, null, 2),
                "utf8"
            );

            console.log(`Written: ${location}`);
        } catch (error) {
            console.error(
                `Gagal menulis ${location}:`,
                error.message
            );
        }
    }

    console.log(
        "File screener_results.json berhasil diperbarui."
    );
}

main().catch((error) => {
    console.error("");
    console.error("QBS Screener gagal:");
    console.error(error);
    process.exitCode = 1;
});
