const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const PAGE_SIZE = 1000;

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function validOHLC(row) {
  const open = n(row.open);
  const high = n(row.high);
  const low = n(row.low);
  const close = n(row.close);

  return (
    open !== null &&
    high !== null &&
    low !== null &&
    close !== null &&
    open > 0 &&
    high > 0 &&
    low > 0 &&
    close > 0
  );
}

function invalidFields(row) {
  const bad = [];

  for (const field of ['open', 'high', 'low', 'close']) {
    const value = n(row[field]);
    if (value === null || value <= 0) bad.push(field);
  }

  return bad;
}

(async () => {
  console.log('');
  console.log('======================================================');
  console.log('CHARTNALIST — FULL DAILY STOCK DATA QUALITY AUDIT');
  console.log('======================================================');
  console.log('');

  console.log('Supabase URL:', process.env.SUPABASE_URL ? 'OK' : 'MISSING');
  console.log(
    'Supabase Key:',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
      ? 'OK'
      : 'MISSING'
  );

  // ----------------------------------------------------
  // STOCK MASTER
  // ----------------------------------------------------

  const { data: stocks, error: stockError } = await supabase
    .from('stocks')
    .select('id,code,name')
    .order('id', { ascending: true });

  if (stockError) throw stockError;

  const stockMap = new Map(
    (stocks || []).map(s => [
      String(s.id),
      {
        code: String(s.code || '').trim().toUpperCase(),
        name: s.name || ''
      }
    ])
  );

  console.log('');
  console.log('Stocks master:', stockMap.size);

  // ----------------------------------------------------
  // AUDIT STATE
  // ----------------------------------------------------

  const stats = new Map();

  function ensureStock(stockId) {
    const key = String(stockId);

    if (!stats.has(key)) {
      const master = stockMap.get(key);

      stats.set(key, {
        stockId: key,
        code: master?.code || key,
        name: master?.name || '',
        rows: 0,
        valid: 0,
        invalid: 0,
        zeroOpen: 0,
        zeroHigh: 0,
        zeroLow: 0,
        zeroClose: 0,
        validDates: [],
        firstDate: null,
        lastDate: null
      });
    }

    return stats.get(key);
  }

  let totalRows = 0;
  let totalValid = 0;
  let totalInvalid = 0;

  const invalidByDate = new Map();
  const invalidFieldCounts = {
    open: 0,
    high: 0,
    low: 0,
    close: 0
  };

  let offset = 0;
  let pageNumber = 0;

  // ----------------------------------------------------
  // FULL PAGINATION
  // ----------------------------------------------------

  while (true) {
    pageNumber++;

    const { data, error } = await supabase
      .from('daily_stock_data')
      .select(
        'stock_id,trade_date,open,high,low,close,volume,value,frequency'
      )
      .order('trade_date', { ascending: true })
      .order('stock_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const rows = data || [];

    if (!rows.length) break;

    totalRows += rows.length;

    for (const row of rows) {
      const s = ensureStock(row.stock_id);

      s.rows++;

      const date = String(row.trade_date || '');

      if (!s.firstDate || date < s.firstDate) {
        s.firstDate = date;
      }

      if (!s.lastDate || date > s.lastDate) {
        s.lastDate = date;
      }

      if (validOHLC(row)) {
        s.valid++;
        totalValid++;

        if (s.validDates.length < 3) {
          s.validDates.push(date);
        }
      } else {
        s.invalid++;
        totalInvalid++;

        const bad = invalidFields(row);

        for (const field of bad) {
          invalidFieldCounts[field]++;
          if (field === 'open') s.zeroOpen++;
          if (field === 'high') s.zeroHigh++;
          if (field === 'low') s.zeroLow++;
          if (field === 'close') s.zeroClose++;
        }

        if (!invalidByDate.has(date)) {
          invalidByDate.set(date, 0);
        }

        invalidByDate.set(
          date,
          invalidByDate.get(date) + 1
        );
      }
    }

    console.log(
      `PAGE ${String(pageNumber).padStart(3, '0')} | ` +
      `rows=${String(rows.length).padStart(4)} | ` +
      `total=${String(totalRows).padStart(7)}`
    );

    if (rows.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
  }

  // ----------------------------------------------------
  // STOCK-LEVEL SUMMARY
  // ----------------------------------------------------

  const stockStats = [...stats.values()];

  const valid20 = stockStats.filter(s => s.valid >= 20);
  const valid50 = stockStats.filter(s => s.valid >= 50);
  const valid100 = stockStats.filter(s => s.valid >= 100);
  const zeroValid = stockStats.filter(s => s.valid === 0);
  const below20 = stockStats.filter(s => s.valid < 20);

  // ----------------------------------------------------
  // WORST STOCKS
  // ----------------------------------------------------

  const worst = [...stockStats]
    .sort((a, b) => {
      if (a.valid !== b.valid) return a.valid - b.valid;
      return b.rows - a.rows;
    })
    .slice(0, 40);

  // ----------------------------------------------------
  // INVALID DATES
  // ----------------------------------------------------

  const worstDates = [...invalidByDate.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  // ----------------------------------------------------
  // GLOBAL SUMMARY
  // ----------------------------------------------------

  console.log('');
  console.log('======================================================');
  console.log('GLOBAL SUMMARY');
  console.log('======================================================');

  console.log('stocks master :', stockMap.size);
  console.log('stocks audited:', stockStats.length);
  console.log('total rows    :', totalRows);
  console.log('valid OHLC    :', totalValid);
  console.log('invalid OHLC  :', totalInvalid);

  console.log('');
  console.log('STOCK HISTORY DEPTH');
  console.log('valid >=20  :', valid20.length);
  console.log('valid >=50  :', valid50.length);
  console.log('valid >=100 :', valid100.length);
  console.log('valid <20   :', below20.length);
  console.log('valid =0    :', zeroValid.length);

  console.log('');
  console.log('INVALID OHLC FIELD COUNTS');
  console.log('open  :', invalidFieldCounts.open);
  console.log('high  :', invalidFieldCounts.high);
  console.log('low   :', invalidFieldCounts.low);
  console.log('close :', invalidFieldCounts.close);

  // ----------------------------------------------------
  // WORST STOCK TABLE
  // ----------------------------------------------------

  console.log('');
  console.log('======================================================');
  console.log('WORST STOCKS — LOWEST VALID OHLC HISTORY');
  console.log('======================================================');

  console.log(
    worst.map(s =>
      [
        s.code,
        s.rows,
        s.valid,
        s.invalid,
        s.zeroOpen,
        s.zeroHigh,
        s.zeroLow,
        s.zeroClose,
        s.firstDate,
        s.lastDate
      ].join('|')
    ).join('\n')
  );

  // ----------------------------------------------------
  // ZERO VALID
  // ----------------------------------------------------

  console.log('');
  console.log('======================================================');
  console.log('ZERO VALID OHLC STOCKS');
  console.log('======================================================');

  console.log('Count:', zeroValid.length);

  console.log(
    zeroValid.slice(0, 100).map(s =>
      [
        s.code,
        s.rows,
        s.invalid,
        s.zeroOpen,
        s.zeroHigh,
        s.zeroLow,
        s.zeroClose,
        s.firstDate,
        s.lastDate
      ].join('|')
    ).join('\n')
  );

  // ----------------------------------------------------
  // INVALID BY DATE
  // ----------------------------------------------------

  console.log('');
  console.log('======================================================');
  console.log('DATES WITH MOST INVALID OHLC ROWS');
  console.log('======================================================');

  console.log(
    worstDates.map(([date, count]) =>
      [date, count].join('|')
    ).join('\n')
  );

  // ----------------------------------------------------
  // KNOWN STOCKS
  // ----------------------------------------------------

  console.log('');
  console.log('======================================================');
  console.log('KNOWN STOCK CHECK');
  console.log('======================================================');

  for (const code of ['BIPP', 'MEJA', 'UNSP']) {
    const s = stockStats.find(x => x.code === code);

    if (!s) {
      console.log(code, 'NOT FOUND');
      continue;
    }

    console.log({
      code: s.code,
      rows: s.rows,
      valid: s.valid,
      invalid: s.invalid,
      firstDate: s.firstDate,
      lastDate: s.lastDate
    });
  }

  console.log('');
  console.log('======================================================');
  console.log('AUDIT COMPLETE');
  console.log('======================================================');
})();
