const pg = require("../lib/pg-connector");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  
  let dbStatus = "unknown";
  try {
    const result = await pg.pgQuery("SELECT 1 as test", []);
    dbStatus = result.rows && result.rows.length > 0 ? "connected" : "no_result";
  } catch(e) {
    dbStatus = "error: " + e.message.substring(0, 50);
  }
  
  res.statusCode = 200;
  res.end(JSON.stringify({
    ok: true,
    mode: process.env.DATABASE_URL ? "postgres" : "sqlite",
    dbStatus,
    env: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      nodeVersion: process.version,
    }
  }));
};
