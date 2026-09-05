// src/connectors/stockbitConnector.js
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Ambil data broker summary dari Stockbit-MCP
 * @param {string} code - Kode saham (contoh: 'BBCA')
 * @returns {object|null} - Data broker summary atau null jika gagal
 */
async function getBrokerSummary(code) {
  try {
    // Panggil stockbit-mcp via command line
    const { stdout, stderr } = await execPromise(
      `npx stockbit-mcp broker-summary --code ${code}`
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
    const { stdout, stderr } = await execPromise(
      `npx stockbit-mcp broker-accumulation --code ${code} --days 5`
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