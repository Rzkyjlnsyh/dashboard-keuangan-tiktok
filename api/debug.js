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
  
  // Test insert
  try {
    const testRow = {
      line_key: 'test|custombase|123|',
      order_id: '123',
      store_name: 'custombase',
      source: 'test',
      created_at: '2026-05-15',
      updated_at: '2026-05-15',
      status: 'Selesai',
      sku: 'TEST',
      product_name: 'Test',
      variation: '',
      quantity: 1,
      unit_price: 1000,
      gross_product: 1000,
      seller_discount: 0,
      platform_discount: 0,
      platform_fee: 0,
      refund_amount: 0,
      order_amount: 1000,
      settlement_received: 0,
      payment_method: '',
      tracking_id: '',
      package_id: '',
      cancel_reason: '',
      shipped_time: null,
      adjustment_amount: 0,
      last_seen_file: 'test',
      last_seen_at: new Date().toISOString()
    };
    const saved = await pg.upsertRows('finance_order_lines', [testRow], 'line_key');
    r.testInsert = saved ? 'OK' : 'FAIL';
    // Clean up
    await pg.pgQuery("DELETE FROM finance_order_lines WHERE line_key='test|custombase|123|'", []);
  } catch(e) { r.testInsertError = e.message.substring(0,100); }
  
  // List columns
  try {
    const q = await pg.pgQuery("SELECT column_name FROM information_schema.columns WHERE table_name='finance_order_lines' ORDER BY ordinal_position", []);
    r.columns = q.rows.map(r2=>r2.column_name);
  } catch(e) {}
  
  // Test fetchAll (fixed version)
  try {
    const rows = await pg.fetchAll("finance_order_lines", "select=*&store_name=eq.custombase&limit=5");
    r.fetchAllTest = rows.length;
  } catch(e) { r.fetchAllError = e.message; }
  
  // May filter test
  try {
    const q = await pg.pgQuery("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-05%'", []);
    r.mayCount = q.rows?.[0]?.c;
  } catch(e) {}
  
  res.statusCode = 200;
  res.end(JSON.stringify(r));
};
