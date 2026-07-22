const pg = require("../lib/pg-connector");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const pg = require("../lib/pg-connector");
  await pg.initSchema();
  
  const result = {};
  
  // Test connection
  try {
    const r = await pg.pgQuery("SELECT 1 as test", []);
    result.dbOk = r.rows && r.rows.length > 0;
  } catch(e) { result.dbOk = false; result.dbError = e.message; }
  
  // Count rows in each table
  for (const table of ['finance_order_lines','finance_sku_costs','finance_ad_spend','finance_income_raw','finance_config']) {
    try {
      const r = await pg.pgQuery(`SELECT COUNT(*) as cnt FROM "${table}"`, []);
      result[table] = r.rows && r.rows.length > 0 ? Number(r.rows[0].cnt) : 0;
    } catch(e) { result[table] = 'error: '+e.message.substring(0,50); }
  }
  
  // Show sample data
  try {
    const r = await pg.pgQuery('SELECT store_name, created_at, status, order_id FROM finance_order_lines LIMIT 3', []);
    result.sampleOrders = r.rows || [];
  } catch(e) { result.sampleOrders = 'error: '+e.message.substring(0,50); }
  
  res.statusCode = 200;
  res.end(JSON.stringify(result, null, 2));
};
