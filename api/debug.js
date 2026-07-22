const pg = require("../lib/pg-connector");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const pg = require("../lib/pg-connector");
  await pg.initSchema();
  
  const result = {};
  
  // Test direct query
  const r1 = await pg.pgQuery("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' AND created_at >= '2026-05-01' AND created_at <= '2026-05-31'", []);
  result.directQuery = r1.rows?.[0]?.c;
  
  // Test fetchAll with filter - show generated SQL
  try {
    const pool = require('pg').Pool;
    const p = new pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}, max: 1});
    
    // Manually build the query like fetchAll does
    let sql = 'SELECT * FROM "finance_order_lines"';
    let where = [];
    
    const queryStr = "select=*&store_name=eq.custombase&and=(created_at.gte.2026-05-01,created_at.lte.2026-05-31)";
    const parts = queryStr.split('&').filter(Boolean);
    
    result.parts = parts;
    
    for (const part of parts) {
      const eqPos = part.indexOf('=');
      if (eqPos < 0) continue;
      const k = part.slice(0, eqPos);
      const v = part.slice(eqPos + 1);
      if (!k || !v) continue;
      
      result['parsed_'+k] = v;
      
      if (k === 'and') {
        const inner = v.startsWith('(') ? v.slice(1, -1) : v;
        const andParts = inner.split(',');
        result.andParts = andParts;
        
        for (const ap of andParts) {
          const firstDot = ap.indexOf('.');
          result['ap_'+ap] = 'firstDot='+firstDot;
          if (firstDot < 0) continue;
          
          const col = ap.slice(0, firstDot);
          const rest = ap.slice(firstDot + 1);
          const secondDot = rest.indexOf('.');
          
          result['parse_'+col] = {col, rest, secondDot};
          
          if (secondDot < 0) {
            where.push('"' + col + '" = \'' + rest.replace(/'/g, "''") + '\'');
          } else {
            const op = rest.slice(0, secondDot);
            const raw = decodeURIComponent(rest.slice(secondDot + 1));
            result['filter_'+col] = {op, raw};
            
            if (op === 'gte') where.push('"' + col + '" >= \'' + raw.replace(/'/g, "''") + '\'');
            else if (op === 'lte') where.push('"' + col + '" <= \'' + raw.replace(/'/g, "''") + '\'');
            else if (op === 'eq') where.push('"' + col + '" = \'' + raw.replace(/'/g, "''") + '\'');
          }
        }
      } else {
        const dot = v.indexOf('.');
        if (dot < 0) {
          where.push('"' + k + '" = \'' + v.replace(/'/g, "''") + '\'');
        } else {
          const op = v.slice(0, dot);
          const raw = decodeURIComponent(v.slice(dot + 1));
          if (op === 'eq') where.push('"' + k + '" = \'' + raw.replace(/'/g, "''") + '\'');
        }
      }
    }
    
    result.whereClauses = where;
    
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' LIMIT 10';
    
    result.generatedSQL = sql;
    
    const r2 = await p.query('SELECT COUNT(*) as c FROM (' + sql + ') sub');
    result.fetchAllDebugCount = r2.rows?.[0]?.c;
    
    await p.end();
  } catch(e) {
    result.error = e.message;
  }
  
  res.statusCode = 200;
  res.end(JSON.stringify(result, null, 2));
};
