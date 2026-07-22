// Database Connector — Dual Mode (max 1 connection for Vercel)
let db=null, pool=null, mode='sqlite';

if (process.env.DATABASE_URL) {
  mode = 'postgres';
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 15000,
    });
    console.log('[db] PostgreSQL mode');
  } catch(e) {
    console.error('[db] PG init failed:', e.message);
    mode = 'sqlite';
  }
}

if (mode === 'sqlite') {
  try {
    const path=require('path'), fs=require('fs');
    const Database=require('better-sqlite3');
    const DB_PATH=path.join(__dirname,'..','data','finance.db');
    const dir=path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive:true});
    db=new Database(DB_PATH);
    db.pragma('journal_mode=WAL');
    console.log('[db] SQLite mode:', DB_PATH);
  } catch(e) {
    console.error('[db] SQLite fail:', e.message);
  }
}

function getDb() { return mode==='postgres'?null:db; }
function pgConfigured() { return true; }
function pgSetupMessage() { return ''; }

async function pgQuery(sql, params=[]) {
  if (mode==='postgres' && pool) {
    try {
      const r = await pool.query(sql, params||[]);
      return { rows: r.rows||[], changes: r.rowCount||0 };
    } catch(e) {
      console.error('[db] PG error:', e.message.substring(0,80));
      return { rows: [] };
    }
  }
  const d=getDb(); if(!d) return {rows:[]};
  try {
    let s=sql.replace(/\$\d+/g,'?').replace(/::date(\s*\+\s*interval\s*'\d+\s*day')?/gi,'').replace(/::text/gi,'');
    const u=s.trim().toUpperCase();
    if(u.startsWith('SELECT')) return {rows:d.prepare(s).all(...(params||[]))};
    if(u.startsWith('INSERT')||u.startsWith('UPDATE')||u.startsWith('DELETE')||u.startsWith('CREATE')){
      const r=d.prepare(s).run(...(params||[]));
      return {rows:[],changes:r.changes};
    }
    return {rows:[]};
  } catch(e) { console.error('[db] SQLite error:', e.message.substring(0,80)); return {rows:[]}; }
}

async function fetchAll(table, queryStr='') {
  if (mode==='postgres' && pool) {
    let sql=`SELECT * FROM "${table}"`, where=[], order='', limit=4000;
    const parts=(queryStr||'').split('&').filter(Boolean);
    for(const p of parts) {
      const eq=p.indexOf('='); if(eq<0) continue;
      const k=p.slice(0,eq), v=p.slice(eq+1); if(!k) continue;
      if(k==='select'){if(v!=='*')sql=sql.replace('*',v.split(',').map(c=>`"${c.trim()}"`).join(','));}
      else if(k==='order'){const[c,d]=v.split('.');order=`ORDER BY "${c}" ${d==='desc'?'DESC':'ASC'}`;}
      else if(k==='limit') limit=parseInt(v)||4000;
      else if(k==='and'){const inner=v.startsWith('(')?v.slice(1,-1):v;for(const ap of inner.split(',')){const dot=ap.indexOf('.');if(dot<0)continue;const col=ap.slice(0,dot),val=ap.slice(dot+1),opDot=val.indexOf('.');if(opDot<0){where.push(`"${col}"='${val.replace(/'/g,"''")}'`);continue;}const op=val.slice(0,opDot),raw=decodeURIComponent(val.slice(opDot+1));if(op==='eq')where.push(`"${col}"='${raw.replace(/'/g,"''")}'`);else if(op==='gte')where.push(`"${col}">='${raw.replace(/'/g,"''")}'`);else if(op==='lte')where.push(`"${col}"<='${raw.replace(/'/g,"''")}'`);else if(op==='like')where.push(`"${col}" LIKE '${raw.replace(/'/g,"''")}'`);}}
      else{const dot=v.indexOf('.');if(dot<0){where.push(`"${k}"='${v.replace(/'/g,"''")}'`);continue;}const op=v.slice(0,dot),raw=decodeURIComponent(v.slice(dot+1));if(op==='eq')where.push(`"${k}"='${raw.replace(/'/g,"''")}'`);else if(op==='neq')where.push(`"${k}"!='${raw.replace(/'/g,"''")}'`);}
    }
    if(where.length) sql+=' WHERE '+where.join(' AND ');
    if(order) sql+=' '+order;
    sql+=' LIMIT '+limit;
    try { const r=await pool.query(sql); return r.rows; } catch(e) { console.error('[db] fetchAll error:',e.message.substring(0,80)); return []; }
  }
  const d=getDb(); if(!d) return [];
  let sql=`SELECT * FROM "${table}"`, where=[], order='', limit=4000;
  const parts=(queryStr||'').split('&').filter(Boolean);
  for(const p of parts) {
    const [k,v]=p.split('='); if(!k||!v) continue;
    if(k==='select'&&v!=='*') sql=sql.replace('*',v.split(',').map(c=>`"${c.trim()}"`).join(','));
    else if(k==='order'){const[c,d]=v.split('.');order=`ORDER BY "${c}" ${d==='desc'?'DESC':'ASC'}`;}
    else if(k==='limit') limit=parseInt(v)||4000;
    else if(k==='and'){const inner=v.startsWith('(')?v.slice(1,-1):v;for(const ap of inner.split(',')){const dot=ap.indexOf('.');if(dot<0)continue;const col=ap.slice(0,dot),val=ap.slice(dot+1),opDot=val.indexOf('.');if(opDot<0){where.push(`"${col}"='${val.replace(/'/g,"''")}'`);continue;}const op=val.slice(0,opDot),raw=decodeURIComponent(val.slice(opDot+1));if(op==='eq')where.push(`"${col}"='${raw.replace(/'/g,"''")}'`);if(op==='gte')where.push(`"${col}">='${raw.replace(/'/g,"''")}'`);if(op==='lte')where.push(`"${col}"<='${raw.replace(/'/g,"''")}'`);if(op==='like')where.push(`"${col}" LIKE '${raw.replace(/'/g,"''")}'`);}}
    else{const dot=v.indexOf('.');if(dot<0){where.push(`"${k}"='${v.replace(/'/g,"''")}'`);continue;}const op=v.slice(0,dot),raw=decodeURIComponent(v.slice(dot+1));if(op==='eq')where.push(`"${k}"='${raw.replace(/'/g,"''")}'`);if(op==='neq')where.push(`"${k}"!='${raw.replace(/'/g,"''")}'`);}
  }
  if(where.length) sql+=' WHERE '+where.join(' AND ');
  if(order) sql+=' '+order;
  sql+=' LIMIT '+limit;
  try { return d.prepare(sql).all(); } catch(e) { return []; }
}

async function upsertRows(table, rows, conflictKey) {
  if(!rows||!rows.length) return [];
  if(mode==='postgres' && pool) {
    const keys = Array.isArray(conflictKey) ? conflictKey : [conflictKey];
    const cols = Object.keys(rows[0]);
    const allCols = cols.map(c => `"${c}"`).join(',');
    const setCols = cols.filter(c => !keys.includes(c));
    const setClause = setCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(',');
    const conflictCols = keys.map(k => `"${k}"`).join(',');
    // Batch insert: 200 rows per query for speed
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = [], placeholders = [];
      let idx = 1;
      for (const row of batch) {
        const ph = cols.map(() => '$' + (idx++));
        placeholders.push('(' + ph.join(',') + ')');
        for (const c of cols) values.push(row[c] != null ? row[c] : null);
      }
      const sql = `INSERT INTO "${table}" (${allCols}) VALUES ${placeholders.join(',')} ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClause}`;
      try { await pool.query(sql, values); } catch(e) { console.error('[db] batch upsert error:', e.message.substring(0,80)); }
    }
    return rows;
  }
  const d=getDb(); if(!d) return [];
  const keys=Array.isArray(conflictKey)?conflictKey:[conflictKey], saved=[];
  for(const row of rows) {
    const cols=Object.keys(row);
    const ex=d.prepare(`SELECT 1 FROM "${table}" WHERE ${keys.map(k=>`"${k}"=?`).join(' AND ')}`).get(...keys.map(k=>row[k]));
    if(ex) {
      const sets=cols.filter(c=>!keys.includes(c)).map(c=>`"${c}"=?`).join(',');
      d.prepare(`UPDATE "${table}" SET ${sets} WHERE ${keys.map(k=>`"${k}"=?`).join(' AND ')}`).run(...cols.filter(c=>!keys.includes(c)).map(c=>row[c]),...keys.map(k=>row[k]));
    } else {
      d.prepare(`INSERT INTO "${table}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`).run(...cols.map(c=>row[c]));
    }
    saved.push(row);
  }
  return saved;
}

async function insertRows(table, rows) {
  if(!rows||!rows.length) return [];
  if(mode==='postgres' && pool) {
    for(const row of rows) {
      const cols=Object.keys(row), vals=cols.map(c=>row[c]);
      const ph=vals.map((_,i)=>'$'+(i+1)).join(',');
      try { await pool.query(`INSERT INTO "${table}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${ph})`, vals); } catch(e) {}
    }
    return rows;
  }
  const d=getDb(); if(!d) return [];
  for(const row of rows) {
    const cols=Object.keys(row);
    try { d.prepare(`INSERT INTO "${table}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`).run(...cols.map(c=>row[c])); } catch(e) {}
  }
  return rows;
}

async function upsertAdSpendRows(rows) { return upsertRows('finance_ad_spend',rows,['store_name','spend_date','channel','campaign']); }

async function initSchema() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS finance_order_lines(line_key TEXT PRIMARY KEY,order_id TEXT,store_name TEXT DEFAULT 'ventura',source TEXT,created_at TEXT,updated_at TEXT,status TEXT,sku TEXT,product_name TEXT,variation TEXT,quantity REAL DEFAULT 0,unit_price REAL DEFAULT 0,gross_product REAL DEFAULT 0,seller_discount REAL DEFAULT 0,platform_discount REAL DEFAULT 0,platform_fee REAL DEFAULT 0,refund_amount REAL DEFAULT 0,order_amount REAL DEFAULT 0,settlement_received REAL DEFAULT 0,payment_method TEXT,tracking_id TEXT,package_id TEXT,cancel_reason TEXT,shipped_time TEXT,adjustment_amount REAL DEFAULT 0,last_seen_file TEXT,last_seen_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_sku_costs(sku_key TEXT PRIMARY KEY,store_name TEXT DEFAULT 'global',sku TEXT,product_name TEXT,hpp_per_unit REAL DEFAULT 0,packing_per_unit REAL DEFAULT 0,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_ad_spend(id SERIAL PRIMARY KEY,store_name TEXT DEFAULT 'ventura',spend_date TEXT,amount REAL DEFAULT 0,channel TEXT,campaign TEXT,note TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_import_runs(id SERIAL PRIMARY KEY,filename TEXT,kind TEXT,store_name TEXT,rows_seen INTEGER DEFAULT 0,inserted INTEGER DEFAULT 0,updated INTEGER DEFAULT 0,unchanged INTEGER DEFAULT 0,audit_count INTEGER DEFAULT 0,message TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_audit_events(id TEXT PRIMARY KEY,run_id INTEGER,filename TEXT,kind TEXT,store_name TEXT,order_id TEXT,sku TEXT,field_name TEXT,old_value TEXT,new_value TEXT,change_type TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_config(key TEXT PRIMARY KEY,value TEXT DEFAULT '{}',updated_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_income_raw(id SERIAL PRIMARY KEY,store_name TEXT,transaction_type TEXT,order_id TEXT,order_created_time TEXT,settlement_amount REAL DEFAULT 0,total_fees REAL DEFAULT 0,refund_amount REAL DEFAULT 0,adjustment_amount REAL DEFAULT 0,imported_at TEXT);
  `;
  if(mode==='postgres' && pool) {
    await pool.query(ddl);
    for(const idx of [
      "CREATE INDEX IF NOT EXISTS idx_ol_store ON finance_order_lines(store_name)",
      "CREATE INDEX IF NOT EXISTS idx_ol_created ON finance_order_lines(created_at)",
      "CREATE INDEX IF NOT EXISTS idx_ir_month ON finance_income_raw(store_name,order_created_time)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_unique ON finance_ad_spend(store_name,spend_date,COALESCE(channel,''),COALESCE(campaign,''))",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_income_unique ON finance_income_raw(store_name,order_id,transaction_type)",
    ]) { try { await pool.query(idx); } catch(e) {} }
    console.log('[db] PG schema ready');
    return;
  }
  const d=getDb(); if(!d) return;
  d.exec(ddl.replace(/SERIAL/g,'INTEGER').replace(/TEXT PRIMARY KEY/g,'TEXT').replace(/id SERIAL PRIMARY KEY/g,'id INTEGER PRIMARY KEY AUTOINCREMENT'));
  for(const idx of [
    "CREATE INDEX IF NOT EXISTS idx_ol_store ON finance_order_lines(store_name)",
    "CREATE INDEX IF NOT EXISTS idx_ol_created ON finance_order_lines(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_ir_month ON finance_income_raw(store_name,order_created_time)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_unique ON finance_ad_spend(store_name,spend_date,COALESCE(channel,''),COALESCE(campaign,''))",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_income_unique ON finance_income_raw(store_name,order_id,transaction_type)",
  ]) { try { d.exec(idx); } catch(e) {} }
  console.log('[db] SQLite schema ready');
}

async function cacheGet(key) { return null; }
async function cacheSet(key, data, ttl) {}
async function cacheDelete(p) {}
async function cacheDeleteByTable(t) {}

module.exports = { pgConfigured, pgSetupMessage, pgQuery, fetchAll, upsertRows, insertRows, upsertAdSpendRows, initSchema, cacheGet, cacheSet, cacheDelete, cacheDeleteByTable, getDb };
