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
  
  // Sample rows
  try {
    const q = await pg.pgQuery("SELECT order_id, created_at, status, sku FROM finance_order_lines WHERE store_name='custombase' LIMIT 3", []);
    r.sampleRows = q.rows;
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
