// src/connectors/arjumConnector.js
const axios = require('axios');
require('dotenv').config();

const ARJUM_BASE_URL = 'https://stock.arjum.com/api';
const ARJUM_API_KEY = process.env.ARJUM_API_KEY;

// Cache untuk mengurangi panggilan API
const cache = new Map();

/**
 * Ambil data seasonality dari Arjum API
 * @param {string} code - Kode saham
 * @returns {object|null} - Data seasonality atau null
 */
async function getSeasonality(code) {
  if (!ARJUM_API_KEY || ARJUM_API_KEY === 'your_arjum_api_key_here') {
    console.warn('[Arjum] API Key tidak ditemukan. Seasonality tidak aktif.');
    return null;
  }

  const cacheKey = `seasonal_${code}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const response = await axios.get(`${ARJUM_BASE_URL}/seasonal/${code}`, {
      headers: {
        'X-API-Key': ARJUM_API_KEY,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    const data = response.data;
    cache.set(cacheKey, data);
    return data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // Data tidak tersedia
      cache.set(cacheKey, null);
      return null;
    }
    console.warn(`[Arjum] Gagal ambil seasonality untuk ${code}:`, error.message);
    return null;
  }
}

/**
 * Ambil data insider dari Arjum API
 * @param {string} code - Kode saham
 * @returns {object|null} - Data insider atau null
 */
async function getInsider(code) {
  if (!ARJUM_API_KEY || ARJUM_API_KEY === 'your_arjum_api_key_here') {
    return null;
  }

  const cacheKey = `insider_${code}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const response = await axios.get(`${ARJUM_BASE_URL}/insiders/${code}`, {
      headers: {
        'X-API-Key': ARJUM_API_KEY,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    const data = response.data;
    cache.set(cacheKey, data);
    return data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      cache.set(cacheKey, null);
      return null;
    }
    console.warn(`[Arjum] Gagal ambil insider untuk ${code}:`, error.message);
    return null;
  }
}

/**
 * Clear cache (panggil setiap hari untuk refresh)
 */
function clearArjumCache() {
  cache.clear();
  console.log('[Arjum] Cache dibersihkan');
}

module.exports = { getSeasonality, getInsider, clearArjumCache };