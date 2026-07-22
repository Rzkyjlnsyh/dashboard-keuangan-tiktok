const pg = require("../lib/pg-connector");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  
  let dbStatus = "unknown", poolExists = false, connTest = "";
  
  try {
    const { Pool } = require('pg');
    const testPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: 8000,
    });
    const client = await testPool.connect();
    const result = await client.query("SELECT 1 as test");
    connTest = result.rows && result.rows.length > 0 ? "OK - row: " + JSON.stringify(result.rows[0]) : "no_rows";
    dbStatus = "connected";
    client.release();
    await testPool.end();
  } catch(e) {
    dbStatus = "error";
    connTest = e.message.substring(0, 200);
  }
  
  res.statusCode = 200;
  res.end(JSON.stringify({
    ok: true,
    hasUrl: !!process.env.DATABASE_URL,
    poolOk: poolExists,
    dbStatus,
    error: connTest,
    urlPrefix: (process.env.DATABASE_URL||'').substring(0, 40) + '...',
  }));
};
