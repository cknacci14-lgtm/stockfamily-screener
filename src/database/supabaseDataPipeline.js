const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchHistoricalDataFromSupabase(options) {
    const opts = options || {};
    const limitDays = opts.limitDays || 600; // FIXED 600
    const ticker = opts.ticker || null;
    console.log("[Pipeline] Fetching data dari Supabase... limitDays="+limitDays);

    try {
        let stockQuery = supabase.from("stocks").select("id, code, name");
        if (ticker) stockQuery = stockQuery.eq("code", ticker.toUpperCase());
        const stockRes = await stockQuery;
        if (stockRes.error) throw stockRes.error;

        const stockMap = {};
        (stockRes.data || []).forEach(s => stockMap[s.id] = s.code);
        const stockIds = Object.keys(stockMap);
        if (stockIds.length === 0) return {};

        // FIXED: PAGINATION + BATCH karena Supabase limit 1000 rows & .in() limit
        const formattedDb = {};
        const PAGE_SIZE = 1000;
        const BATCH_SIZE = 50; // ambil 50 saham sekaligus biar ga kebanyakan .in()

        for(let i=0;i<stockIds.length;i+=BATCH_SIZE){
            const batchIds = stockIds.slice(i, i+BATCH_SIZE);
            console.log(`[Pipeline] Batch ${i/BATCH_SIZE+1}/${Math.ceil(stockIds.length/BATCH_SIZE)} - ${batchIds.length} saham`);
            
            let from = 0;
            let hasMore = true;
            while(hasMore){
                let q = supabase
                    .from("daily_stock_data")
                    .select("stock_id, trade_date, open, high, low, close, previous_price, change_price, volume, value, frequency, foreign_buy, foreign_sell, bid, bid_volume, offer, offer_volume")
                    .in("stock_id", batchIds)
                    .order("trade_date", { ascending: true })
                    .range(from, from+PAGE_SIZE-1);
                
                const res = await q;
                if(res.error) throw res.error;
                
                (res.data||[]).forEach(row=>{
                    const symbol = stockMap[row.stock_id];
                    if(!symbol) return;
                    if(!formattedDb[symbol]) formattedDb[symbol]=[];
                    const foreignNet = Number(row.foreign_buy||0)-Number(row.foreign_sell||0);
                    formattedDb[symbol].push({
                        date: row.trade_date,
                        open: Number(row.open||0),
                        high: Number(row.high||0),
                        low: Number(row.low||0),
                        close: Number(row.close||0),
                        previousPrice: Number(row.previous_price||0),
                        changePrice: Number(row.change_price||0),
                        volume: Number(row.volume||0),
                        value: Number(row.value||0),
                        frequency: Number(row.frequency||0),
                        foreignBuy: Number(row.foreign_buy||0),
                        foreignSell: Number(row.foreign_sell||0),
                        foreignNet: foreignNet,
                        bidVolume: Number(row.bid_volume||0),
                        offerVolume: Number(row.offer_volume||0)
                    });
                });

                if((res.data||[]).length < PAGE_SIZE) hasMore = false;
                else from += PAGE_SIZE;
            }
        }

        // Sort & slice 600 hari terakhir per saham
        Object.keys(formattedDb).forEach(sym=>{
            formattedDb[sym].sort((a,b)=> new Date(a.date)-new Date(b.date));
            if(formattedDb[sym].length > limitDays){
                formattedDb[sym] = formattedDb[sym].slice(-limitDays);
            }
        });

        const totalRows = Object.values(formattedDb).reduce((s,a)=>s+a.length,0);
        const uniqueDates = new Set();
        Object.values(formattedDb).forEach(arr=> arr.forEach(r=> uniqueDates.add(r.date)));
        
        console.log(`[Pipeline] Sukses memuat ${Object.keys(formattedDb).length} saham, ${totalRows} rows, ${uniqueDates.size} tanggal unik`);
        console.log(`[Pipeline] Tanggal: ${Array.from(uniqueDates).sort().slice(-5).join(', ')}`);
        return formattedDb;

    } catch (err) {
        console.error("[Pipeline Error]", err.message, err);
        return null;
    }
}

module.exports = { fetchHistoricalDataFromSupabase };

