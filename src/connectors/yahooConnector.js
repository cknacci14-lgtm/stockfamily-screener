// src/connectors/yahooConnector.js
const axios = require('axios');

// Daftar saham IDX (hardcode dulu, nanti bisa dari file)
const IDX_CODES = [
  'AADI', 'AALI', 'ABBA', 'ABDA', 'ABMM', 'ACES', 'ACRO', 'ACST', 
  'ADCP', 'ADES', 'ADHI', 'ADMF', 'ADMG', 'ADMR', 'ADRO', 'AEGS',
  'AGAR', 'AGII', 'AGRO', 'AGRS', 'AHAP', 'AIMS', 'AISA', 'AKKU',
  'AKPI', 'AKRA', 'AKSI', 'ALDO', 'ALII', 'ALKA', 'ALMI', 'ALTO',
  'AMAG', 'AMAN', 'AMAR', 'AMFG', 'AMIN', 'AMMN', 'AMMS', 'AMOR',
  'AMRT', 'ANDI', 'ANJT', 'ANTM', 'APEX', 'APIC', 'APII', 'APLI',
  'APLN', 'ARCI', 'AREA', 'ARGO', 'ARII', 'ARKA', 'ARKO', 'ARMY',
  'ARNA', 'ARTA', 'ARTI', 'ARTO', 'ASBI', 'ASDM', 'ASGR', 'ASHA',
  'ASII', 'ASJT', 'ASLC', 'ASLI', 'ASMI', 'ASPI', 'ASPR', 'ASRI',
  'ASRM', 'ASSA', 'ATAP', 'ATIC', 'ATLA', 'AUTO', 'AVIA', 'AWAN',
  'AXIO', 'AYAM', 'AYLS', 'BABP', 'BABY', 'BACA', 'BACH', 'BAIK',
  'BAJA', 'BALI', 'BANK', 'BAPA', 'BAPI', 'BATA', 'BATR', 'BAUT',
  'BAYU', 'BBCA', 'BBHI', 'BBKP', 'BBLD', 'BBMD', 'BBNI', 'BBRI',
  'BBRM', 'BBSI', 'BBSS', 'BBTN', 'BBYB', 'BCAP', 'BCIC', 'BCIP',
  'BDKR', 'BDMN', 'BEBS', 'BEEF', 'BEER', 'BEKS', 'BELI', 'BELL',
  'BESS', 'BEST', 'BFIN', 'BGTG', 'BHAT', 'BHIT', 'BIKA', 'BIKE',
  'BIMA', 'BINA', 'BINO', 'BIPI', 'BIPP', 'BIRD', 'BISI', 'BJBR',
  'BJTM', 'BKDP', 'BKSL', 'BKSW', 'BLES', 'BLOG', 'BLTA', 'BLTZ',
  'BLUE', 'BMAS', 'BMBL', 'BMHS', 'BMRI', 'BMSR', 'BMTR', 'BNBA',
  'BNBR', 'BNGA', 'BNII', 'BNLI', 'BOAT', 'BOBA', 'BOGA', 'BOLA',
  'BOLT', 'BOSS', 'BPFI', 'BPII', 'BPTR', 'BRAM', 'BREN', 'BRIS',
  'BRMS', 'BRNA', 'BRPT', 'BRRC', 'BSBK', 'BSDE', 'BSIM', 'BSML',
  'BSSR', 'BSWD', 'BTEK', 'BTEL', 'BTON', 'BTPN', 'BTPS', 'BUAH',
  'BUDI', 'BUKA', 'BUKK', 'BULL', 'BUMI', 'BUVA', 'BVIC', 'BWPT',
  'BYAN', 'CAKK', 'CAMP', 'CANI', 'CARE', 'CARS', 'CASA', 'CASH',
  'CASS', 'CBDK', 'CBMF', 'CBPE', 'CBRE', 'CBUT', 'CCSI', 'CDIA',
  'CEKA', 'CENT', 'CFIN', 'CGAS', 'CHEK', 'CHEM', 'CHIP', 'CINT',
  'CITA', 'CITY', 'CLAY', 'CLEO', 'CLPI', 'CMNP', 'CMNT', 'CMPP',
  'CMRY', 'CNKO', 'CNMA', 'COAL', 'COCO', 'COIN', 'COWL', 'CPIN',
  'CPRI', 'CPRO', 'CRAB', 'CRSN', 'CSAP', 'CSIS', 'CSMI', 'CSRA',
  'CTBN', 'CTRA', 'CTTH', 'CUAN', 'CYBR', 'DAAZ', 'DADA', 'DART',
  'DATA', 'DAYA', 'DCII', 'DEAL', 'DEFI', 'DEPO', 'DEWA', 'DEWI',
  'DFAM', 'DGIK', 'DGNS', 'DGWG', 'DIGI', 'DILD', 'DIVA', 'DKFT',
  'DKHH', 'DLTA', 'DMAS', 'DMMX', 'DMND', 'DNAR', 'DNET', 'DOID',
  'DOOH', 'DOSS', 'DPNS', 'DPUM', 'DRMA', 'DSFI', 'DSNG', 'DSSA',
  'DUCK', 'DUTI', 'DVLA', 'DWGL', 'DYAN', 'EAST', 'ECII', 'EDGE',
  'EKAD', 'ELIT', 'ELPI', 'ELSA', 'ELTY', 'EMAS', 'EMDE', 'EMMI',
  'EMTK', 'ENAK', 'ENRG', 'ENVY', 'ENZO', 'EPAC', 'EPMT', 'ERAA',
  'ERAL', 'ERTX', 'ESIP', 'ESSA', 'ESTA', 'ESTI', 'ETWA', 'EURO',
  'EXCL', 'FAPA', 'FAST', 'FASW', 'FILM', 'FIMP', 'FIRE', 'FISH',
  'FITT', 'FLMC', 'FMII', 'FOLK', 'FOOD', 'FORE', 'FORU', 'FPNI',
  'FUJI', 'FUTR', 'FWCT', 'GAMA', 'GDST', 'GDYR', 'GEMA', 'GEMS',
  'GGRM', 'GGRP', 'GHON', 'GIAA', 'GJTL', 'GLOB', 'GLVA', 'GMFI',
  'GMTD', 'GOLD', 'GOLF', 'GOLL', 'GOOD', 'GOTO', 'GOTOM', 'GPRA',
  'GPSO', 'GRIA', 'GRPH', 'GRPM', 'GSMF', 'GTBO', 'GTRA', 'GTSI',
  'GULA', 'GUNA', 'GWSA', 'GZCO', 'HADE', 'HAIS', 'HAJJ', 'HALO',
  'HATM', 'HBAT', 'HDFA', 'HDIT', 'HEAL', 'HELI', 'HERO', 'HEXA',
  'HGII', 'HILL', 'HITS', 'HKMU', 'HMSP', 'HOKI', 'HOME', 'HOMI',
  'HOPE', 'HOTL', 'HRME', 'HRTA', 'HRUM', 'HUMI', 'HYGN', 'IATA',
  'IBFN', 'IBOS', 'IBST', 'ICBP', 'ICON', 'IDEA', 'IDPR', 'IFII',
  'IFSH', 'IGAR', 'IIKP', 'IKAI', 'IKAN', 'IKBI', 'IKPM', 'IMAS',
  'IMJS', 'IMPC', 'INAF', 'INAI', 'INCF', 'INCI', 'INCO', 'INDF',
  'INDO', 'INDR', 'INDS', 'INDX', 'INDY', 'INET', 'INKP', 'INOV',
  'INPC', 'INPP', 'INPS', 'INRU', 'INTA', 'INTD', 'INTP', 'IOTF',
  'IPAC', 'IPCC', 'IPCM', 'IPOL', 'IPPE', 'IPTV', 'IRRA', 'IRSX',
  'ISAP', 'ISAT', 'ISEA', 'ISSP', 'ITIC', 'ITMA', 'ITMG', 'JARR',
  'JAST', 'JATI', 'JAWA', 'JAYA', 'JECC', 'JECX', 'JELI', 'JGLE',
  'JIHD', 'JKON', 'JMAS', 'JPFA', 'JRPT', 'JSKY', 'JSMR', 'JSPT',
  'JTPE', 'KAEF', 'KAQI', 'KARW', 'KAYU', 'KBAG', 'KBLI', 'KBLM',
  'KBLV', 'KBRI', 'KDSI', 'KDTN', 'KEEN', 'KEJU', 'KETR', 'KIAS',
  'KICI', 'KIJA', 'KING', 'KINO', 'KIOS', 'KJEN', 'KKES', 'KKGI',
  'KLAS', 'KLBF', 'KLIN', 'KMDS', 'KMTR', 'KOBX', 'KOCI', 'KOIN',
  'KOKA', 'KONI', 'KOPI', 'KOTA', 'KPIG', 'KRAS', 'KREN', 'KRYA',
  'KSIX', 'KUAS', 'LABA', 'LABS', 'LAJU', 'LAND', 'LAPD', 'LCGP',
  'LCKM', 'LEAD', 'LFLO', 'LIFE', 'LINK', 'LION', 'LIVE', 'LMAS',
  'LMAX', 'LMPI', 'LMSH', 'LOPI', 'LPCK', 'LPGI', 'LPIN', 'LPKR',
  'LPLI', 'LPPF', 'LPPS', 'LRNA', 'LSIP', 'LTLS', 'LUCK', 'LUCY',
  'MABA', 'MAGP', 'MAHA', 'MAIN', 'MANG', 'MAPA', 'MAPB', 'MAPI',
  'MARI', 'MARK', 'MASB', 'MAXI', 'MAYA', 'MBAP', 'MBMA', 'MBSS',
  'MBTO', 'MCAS', 'MCOL', 'MCOR', 'MDIA', 'MDIY', 'MDKA', 'MDKI',
  'MDLA', 'MDLN', 'MDRN', 'MEDC', 'MEDS', 'MEGA', 'MEJA', 'MENN',
  'MERI', 'MERK', 'META', 'MFMI', 'MGLV', 'MGNA', 'MGRO', 'MHKI',
  'MICE', 'MIDI', 'MIKA', 'MINA', 'MINE', 'MIRA', 'MITI', 'MKAP',
  'MKNT', 'MKPI', 'MKTR', 'MLBI', 'MLIA', 'MLPL', 'MLPT', 'MMIX',
  'MMLP', 'MNCN', 'MOLI', 'MORA', 'MPIX', 'MPMX', 'MPOW', 'MPPA',
  'MPRO', 'MPXL', 'MRAT', 'MREI', 'MSIE', 'MSIN', 'MSJA', 'MSKY',
  'MSTI', 'MTDL', 'MTEL', 'MTFN', 'MTLA', 'MTMH', 'MTPS', 'MTRA',
  'MTSM', 'MTWI', 'MUTU', 'MYOH', 'MYOR', 'MYTX', 'NAIK', 'NANO',
  'NASA', 'NASI', 'NATO', 'NAYZ', 'NCKL', 'NELY', 'NEST', 'NETV',
  'NFCX', 'NICE', 'NICK', 'NICL', 'NIKL', 'NINE', 'NIRO', 'NISP',
  'NOBU', 'NPGF', 'NRCA', 'NSSS', 'NTBK', 'NUSA', 'NZIA', 'OASA',
  'OBAT', 'OBMD', 'OCAP', 'OILS', 'OKAS', 'OLIV', 'OMED', 'OMRE',
  'OPMS', 'PACK', 'PADA', 'PADI', 'PALM', 'PAMG', 'PANI', 'PANR',
  'PANS', 'PART', 'PBID', 'PBRX', 'PBSA', 'PCAR', 'PDES', 'PDPP',
  'PEGE', 'PEHA', 'PEVE', 'PGAS', 'PGEO', 'PGJO', 'PGLI', 'PGUN',
  'PICO', 'PIPA', 'PJAA', 'PJHB', 'PKPK', 'PLAN', 'PLAS', 'PLIN',
  'PMJS', 'PMMP', 'PMUI', 'PNBN', 'PNBS', 'PNGO', 'PNIN', 'PNLF',
  'PNSE', 'POLA', 'POLI', 'POLL', 'POLU', 'POLY', 'POOL', 'PORT',
  'POSA', 'POWR', 'PPGL', 'PPRE', 'PPRI', 'PPRO', 'PRAY', 'PRDA',
  'PRDL', 'PRIM', 'PSAB', 'PSAT', 'PSDN', 'PSGO', 'PSKT', 'PSSI',
  'PTBA', 'PTDU', 'PTIS', 'PTMP', 'PTMR', 'PTPP', 'PTPS', 'PTPW',
  'PTRO', 'PTSN', 'PTSP', 'PUDP', 'PURA', 'PURE', 'PURI', 'PWON',
  'PYFA', 'PZZA', 'RAAM', 'RAFI', 'RAJA', 'RALS', 'RANC', 'RANS',
  'RATU', 'RBMS', 'RCCC', 'RDTX', 'REAL', 'RELF', 'RELI', 'RGAS',
  'RICY', 'RIGS', 'RIMO', 'RISE', 'RLCO', 'RMKE', 'RMKO', 'ROCK',
  'RODA', 'RONY', 'ROTI', 'RSCH', 'RSGK', 'RUIS', 'RUNS', 'SAFE',
  'SAGE', 'SAME', 'SAMF', 'SAPX', 'SATU', 'SBAT', 'SBMA', 'SCCO',
  'SCMA', 'SCNP', 'SCPI', 'SDMU', 'SDPC', 'SDRA', 'SEMA', 'SFAN',
  'SGER', 'SGRO', 'SHID', 'SHIP', 'SICO', 'SIDO', 'SILO', 'SIMA',
  'SIMP', 'SINI', 'SIPD', 'SKBM', 'SKLT', 'SKRN', 'SKYB', 'SLIS',
  'SMAR', 'SMBR', 'SMCB', 'SMDM', 'SMDR', 'SMGA', 'SMGR', 'SMIL',
  'SMKL', 'SMKM', 'SMLE', 'SMMA', 'SMMT', 'SMRA', 'SMRU', 'SMSM',
  'SNLK', 'SOCI', 'SOFA', 'SOHO', 'SOLA', 'SONA', 'SOSS', 'SOTS',
  'SOUL', 'SPMA', 'SPRE', 'SPTO', 'SQMI', 'SRAJ', 'SRIL', 'SRSN',
  'SRTG', 'SSIA', 'SSMS', 'SSTM', 'STAA', 'STAR', 'STRK', 'STTP',
  'SUGI', 'SULI', 'SUNI', 'SUPA', 'SUPR', 'SURE', 'SURI', 'SWAT',
  'SWID', 'TALF', 'TAMA', 'TAMU', 'TAPG', 'TARA', 'TAXI', 'TAYS',
  'TBIG', 'TBLA', 'TBMS', 'TCID', 'TCPI', 'TDPM', 'TEBE', 'TECH',
  'TELE', 'TFAS', 'TFCO', 'TGKA', 'TGRA', 'TGUK', 'TIFA', 'TINS',
  'TIRA', 'TIRT', 'TKIM', 'TLDN', 'TLKM', 'TMAS', 'TMPO', 'TNCA',
  'TOBA', 'TOOL', 'TOPS', 'TOSK', 'TOTL', 'TOTO', 'TOWR', 'TOYS',
  'TPIA', 'TPMA', 'TRAM', 'TRGU', 'TRIL', 'TRIM', 'TRIN', 'TRIO',
  'TRIS', 'TRJA', 'TRON', 'TRST', 'TRUE', 'TRUK', 'TRUS', 'TSPC',
  'TUGU', 'TYRE', 'UANG', 'UCID', 'UDNG', 'UFOE', 'ULTJ', 'UNIC',
  'UNIQ', 'UNIT', 'UNSP', 'UNTD', 'UNTR', 'UNVR', 'URBN', 'UVCR',
  'VAST', 'VERN', 'VICI', 'VICO', 'VINS', 'VISI', 'VIVA', 'VKTR',
  'VOKS', 'VRNA', 'VTNY', 'WAPO', 'WBSA', 'WEGE', 'WEHA', 'WGSH',
  'WICO', 'WIDI', 'WIFI', 'WIIM', 'WIKA', 'WINE', 'WINR', 'WINS',
  'WIRG', 'WMPP', 'WMUU', 'WOMF', 'WOOD', 'WOWS', 'WSBP', 'WSKT',
  'WTON', 'YELO', 'YOII', 'YPAS', 'YULE', 'YUPI', 'ZATA', 'ZBRA',
  'ZINC', 'ZONE', 'ZYRX'
];

// Cache untuk data
const cache = new Map();

/**
 * Ambil data saham dari Yahoo Finance via API langsung
 * @param {string} code - Kode saham (contoh: 'BBCA')
 * @returns {object|null} - Data saham atau null
 */
async function getYahooQuote(code) {
  const cacheKey = `quote_${code}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.JK`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (response.data && response.data.chart && response.data.chart.result && response.data.chart.result.length > 0) {
      const result = response.data.chart.result[0];
      const meta = result.meta || {};
      const quotes = result.indicators?.quote?.[0] || {};
      const closes = quotes.close || [];
      const volumes = quotes.volume || [];
      const highs = quotes.high || [];
      const lows = quotes.low || [];
      const opens = quotes.open || [];
      
      const lastIndex = closes.length - 1;
      
      const data = {
        code: code,
        close: closes[lastIndex] || meta.regularMarketPrice || 0,
        open: opens[lastIndex] || meta.regularMarketOpen || 0,
        high: highs[lastIndex] || meta.regularMarketDayHigh || 0,
        low: lows[lastIndex] || meta.regularMarketDayLow || 0,
        volume: volumes[lastIndex] || meta.regularMarketVolume || 0,
        name: meta.longName || meta.shortName || code,
        currency: meta.currency || 'IDR'
      };
      
      cache.set(cacheKey, data);
      return data;
    }
    
    return null;
  } catch (error) {
    console.warn(`[Yahoo] Gagal mengambil ${code}:`, error.message);
    cache.set(cacheKey, null);
    return null;
  }
}

/**
 * Ambil data harian dari Yahoo Finance untuk semua saham IDX
 * @param {number} limit - Batas jumlah saham (0 = semua)
 * @returns {Array} - Array data saham
 */
async function getDailyDataFromYahoo(limit = 0) {
  const codes = limit > 0 ? IDX_CODES.slice(0, limit) : IDX_CODES;
  const results = [];
  let successCount = 0;
  let failCount = 0;
  
  console.log(`[Yahoo] Mengambil data untuk ${codes.length} saham...`);
  
  for (const code of codes) {
    try {
      const data = await getYahooQuote(code);
      if (data && data.close > 0) {
        results.push({
          code: code,
          date: new Date().toISOString().split('T')[0],
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: data.volume,
          foreign_buy: 0,
          foreign_sell: 0,
          listed_shares: 0,
          tradeable_shares: 0
        });
        successCount++;
      } else {
        failCount++;
      }
      
      // Progress setiap 50 saham
      if ((successCount + failCount) % 50 === 0) {
        console.log(`[Yahoo] Progress: ${successCount + failCount}/${codes.length} (✅ ${successCount}, ❌ ${failCount})`);
      }
      
    } catch (error) {
      failCount++;
    }
    
    // Jeda agar tidak kena rate limit
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`[Yahoo] Selesai. Berhasil: ${successCount}, Gagal: ${failCount}`);
  return results;
}

/**
 * Ambil data historis untuk satu saham
 * @param {string} code - Kode saham
 * @param {string} range - Rentang waktu (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y)
 * @returns {Array} - Data historis
 */
async function getHistoricalData(code, range = '1mo') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.JK?range=${range}&interval=1d`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    if (response.data && response.data.chart && response.data.chart.result && response.data.chart.result.length > 0) {
      const result = response.data.chart.result[0];
      const timestamps = result.timestamp || [];
      const quotes = result.indicators?.quote?.[0] || {};
      const closes = quotes.close || [];
      const volumes = quotes.volume || [];
      const highs = quotes.high || [];
      const lows = quotes.low || [];
      const opens = quotes.open || [];
      
      const historical = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] !== null && closes[i] !== undefined) {
          historical.push({
            date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
            open: opens[i] || 0,
            high: highs[i] || 0,
            low: lows[i] || 0,
            close: closes[i] || 0,
            volume: volumes[i] || 0
          });
        }
      }
      
      return historical;
    }
    
    return [];
  } catch (error) {
    console.warn(`[Yahoo] Gagal ambil historis ${code}:`, error.message);
    return [];
  }
}

/**
 * Clear cache
 */
function clearYahooCache() {
  cache.clear();
  console.log('[Yahoo] Cache dibersihkan');
}

// ============================================================
// TEST FUNCTION
// ============================================================
async function testYahooConnector() {
  console.log('[Yahoo Test] Memulai test koneksi...');
  
  try {
    // Test ambil 1 saham dulu
    const testCode = 'BBCA';
    console.log(`[Yahoo Test] Mencoba mengambil data untuk ${testCode}...`);
    
    const data = await getYahooQuote(testCode);
    
    if (data && data.close > 0) {
      console.log(`[Yahoo Test] ✅ Berhasil!`);
      console.log(`   Kode: ${data.code}`);
      console.log(`   Nama: ${data.name}`);
      console.log(`   Harga: ${data.close}`);
      console.log(`   Volume: ${data.volume}`);
      console.log(`   High: ${data.high}`);
      console.log(`   Low: ${data.low}`);
      console.log(`   Currency: ${data.currency}`);
    } else {
      console.log(`[Yahoo Test] ❌ Gagal mengambil data untuk ${testCode}`);
    }
    
    console.log('\n[Yahoo Test] Test selesai!');
    
  } catch (error) {
    console.error('[Yahoo Test] ❌ Error:', error.message);
  }
}

module.exports = { 
  getYahooQuote, 
  getDailyDataFromYahoo, 
  getHistoricalData, 
  clearYahooCache,
  IDX_CODES 
};

// Jalankan test jika file dieksekusi langsung
if (require.main === module) {
  testYahooConnector();
}