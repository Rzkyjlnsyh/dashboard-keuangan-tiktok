const pg = require("../lib/pg-connector");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  await pg.initSchema();
  const r = {};
  
  // Count rows
  for (const t of ['finance_order_lines','finance_sku_costs','finance_ad_spend','finance_income_raw']) {
    try {
      const q = await pg.pgQuery(`SELECT COUNT(*) as c FROM "${t}"`, []);
      r[t] = q.rows?.[0]?.c || 0;
    } catch(e) { r[t] = 'error: '+e.message.substring(0,40); }
  }
  
  // Sample dates from order_lines
  try {
    const q = await pg.pgQuery("SELECT created_at, COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' GROUP BY created_at ORDER BY created_at LIMIT 5", []);
    r.sampleDates = q.rows;
  } catch(e) {}
  
  // Real insert test - mimick upload
  try {
    const testRows = [{
      line_key:'custombase|test123|TESTSKU|', order_id:'test123', store_name:'custombase',
      source:'tiktok_order', created_at:'2026-05-15', updated_at:'2026-05-15',
      status:'Selesai', sku:'TESTSKU', product_name:'Test Product', variation:'',
      quantity:2, unit_price:5000, gross_product:10000, seller_discount:1000,
      platform_discount:0, platform_fee:500, refund_amount:0, order_amount:9000,
      settlement_received:0, payment_method:'', tracking_id:'TRACK123',
      package_id:'PKG123', cancel_reason:'', shipped_time:null,
      adjustment_amount:0, last_seen_file:'test.xlsx', last_seen_at:new Date().toISOString()
    }];
    const saved = await pg.upsertRows('finance_order_lines', testRows, 'line_key');
    r.realInsert = saved ? saved.length : 0;
    // Verify
    const q = await pg.pgQuery("SELECT COUNT(*) as c FROM finance_order_lines", []);
    r.countAfterInsert = q.rows?.[0]?.c;
    // Cleanup
    await pg.pgQuery("DELETE FROM finance_order_lines WHERE line_key='custombase|test123|TESTSKU|'", []);
  } catch(e) { r.realInsertError = e.message.substring(0,150); }
  
  // List columns
  try {
    const q = await pg.pgQuery("SELECT column_name FROM information_schema.columns WHERE table_name='finance_order_lines' ORDER BY ordinal_position", []);
    r.columns = q.rows.map(r2=>r2.column_name);
  } catch(e) {}
  
  // Test computeSummary ad filter
  try {
    const ads = await pg.fetchAll("finance_ad_spend", "store_name=eq.custombase&and=(spend_date.gte.2026-05-01,spend_date.lt.2026-06-01)");
    r.adsFetched = (ads||[]).length;
    const filtered = (ads||[]).filter(row => {
      const d = String(row.spend_date || "").replace(/\//g, "-").slice(0,10);
      return d >= '2026-05-01' && d <= '2026-05-31';
    });
    r.adsFiltered = filtered.length;
    if (ads && ads.length > 0) {
      r.firstAdSpendDate = String(ads[0].spend_date || '');
      r.firstAdDateSlice = String(ads[0].spend_date || '').replace(/\//g, "-").slice(0,10);
    }
  } catch(e) { r.adsTestErr = e.message; }
  
  // May filter test
  try {
    const q = await pg.pgQuery("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-05%'", []);
    r.mayCount = q.rows?.[0]?.c;
  } catch(e) {}
  
  res.statusCode = 200;
  res.end(JSON.stringify(r));
};
