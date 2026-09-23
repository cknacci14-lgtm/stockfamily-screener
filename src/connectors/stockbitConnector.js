// src/connectors/stockbitConnector.js
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);

// Kode saham IDX selalu 2-6 huruf kapital — tolak apapun di luar itu
// sebelum menyentuh child_process, supaya tidak ada celah command injection.
const STOCK_CODE_RE = /^[A-Z]{2,6}$/;

function assertValidCode(code) {
  if (typeof code !== 'string' || !STOCK_CODE_RE.test(code)) {
    throw new Error(`Kode saham tidak valid: ${JSON.stringify(code)}`);
  }
}

/**
 * Ambil data broker summary dari Stockbit-MCP
 * @param {string} code - Kode saham (contoh: 'BBCA')
 * @returns {object|null} - Data broker summary atau null jika gagal
 */
async function getBrokerSummary(code) {
  try {
    assertValidCode(code);
    // execFile TIDAK melewati shell — argumen dikirim sebagai array,
    // jadi tidak mungkin ada shell/command injection lewat `code`.
    const { stdout, stderr } = await execFilePromise(
      'npx',
      ['stockbit-mcp', 'broker-summary', '--code', code]
    );

    if (stderr) {
      console.warn(`[Stockbit] Warning untuk ${code}: ${stderr}`);
      return null;
    }

    if (!stdout || stdout.trim() === '') {
      console.warn(`[Stockbit] Tidak ada data untuk ${code}`);
      return null;
    }

    return JSON.parse(stdout);
  } catch (error) {
    console.warn(`[Stockbit] Gagal mengambil data untuk ${code}:`, error.message);
    return null;
  }
}

/**
 * Ambil data akumulasi broker 5 hari
 * @param {string} code - Kode saham
 * @returns {object|null} - Data akumulasi atau null
 */
async function getBrokerAccumulation(code) {
  try {
    assertValidCode(code);
    const { stdout, stderr } = await execFilePromise(
      'npx',
      ['stockbit-mcp', 'broker-accumulation', '--code', code, '--days', '5']
    );

    if (stderr) {
      console.warn(`[Stockbit] Warning akumulasi untuk ${code}: ${stderr}`);
      return null;
    }

    if (!stdout || stdout.trim() === '') {
      return null;
    }

    return JSON.parse(stdout);
  } catch (error) {
    console.warn(`[Stockbit] Gagal ambil akumulasi ${code}:`, error.message);
    return null;
  }
}

module.exports = { getBrokerSummary, getBrokerAccumulation };
