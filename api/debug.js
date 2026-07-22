const pg = require("../lib/pg-connector");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  
  let dbStatus = "unknown", poolExists = false, connTest = "";
  
  try {
    const pgMod = require("pg");
    poolExists = true;
    
    const client = await new pgMod.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    }).connect();
    
    const result = await client.query("SELECT 1 as test");
    connTest = result.rows && result.rows.length > 0 ? "OK" : "no_rows";
    dbStatus = "connected";
    client.release();
  } catch(e) {
    dbStatus = "error";
    connTest = e.message.substring(0, 120);
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
