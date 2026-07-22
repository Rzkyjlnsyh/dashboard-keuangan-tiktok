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
  
  // Test fetchAll vs direct query
  try {
    const r1 = await pg.fetchAll("finance_order_lines", "select=*&store_name=eq.custombase&and=(created_at.gte.2026-05-01,created_at.lte.2026-05-31)");
    result.fetchAllTest = (r1||[]).length;
    const r2 = await pg.pgQuery("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' AND created_at >= '2026-05-01' AND created_at <= '2026-05-31'", []);
    result.directQuery = r2.rows?.[0]?.c;
    const r3 = await pg.fetchAll("finance_order_lines", "limit=5");
    result.simpleFetch = (r3||[]).length;
  } catch(e) { result.fetchErr = e.message; }
  
  res.statusCode = 200;
  res.end(JSON.stringify(result, null, 2));
};
