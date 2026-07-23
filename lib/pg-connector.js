// Database Connector — Dual Mode (SQLite local / PostgreSQL production)
let db=null, pool=null, mode='sqlite';

if (process.env.DATABASE_URL) {
  mode = 'postgres';
  try {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1, idleTimeoutMillis: 5000, connectionTimeoutMillis: 15000 });
    console.log('[db] PostgreSQL mode');
  } catch(e) { console.error('[db] PG init failed:', e.message); mode = 'sqlite'; }
}

if (mode === 'sqlite') {
  try {
    const path=require('path'), fs=require('fs'), Database=require('better-sqlite3');
    const DB_PATH=path.join(__dirname,'..','data','finance.db');
    if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), {recursive:true});
    db=new Database(DB_PATH); db.pragma('journal_mode=WAL');
    console.log('[db] SQLite mode:', DB_PATH);
  } catch(e) { console.error('[db] SQLite fail:', e.message); }
}

function getDb() { return mode==='postgres'?null:db; }
function pgConfigured() { return true; }
function pgSetupMessage() { return ''; }

async function pgQuery(sql, params=[]) {
  if (mode==='postgres' && pool) {
    try { const r = await pool.query(sql, params||[]); return { rows: r.rows||[], changes: r.rowCount||0 }; }
    catch(e) { console.error('[db] PG error:', e.message.substring(0,80)); return { rows: [] }; }
  }
  const d=getDb(); if(!d) return {rows:[]};
  try {
    let s=sql.replace(/\$\d+/g,'?').replace(/::date(\s*\+\s*interval\s*'\d+\s*day')?/gi,'').replace(/::text/gi,'');
    const u=s.trim().toUpperCase();
    if(u.startsWith('SELECT')) return {rows:d.prepare(s).all(...(params||[]))};
    const r=d.prepare(s).run(...(params||[]));
    return {rows:[],changes:r.changes};
  } catch(e) { return {rows:[]}; }
}

function whereOp(col, op, raw) {
  const v = raw.replace(/'/g, "''");
  if (op==='eq') return `"${col}"='${v}'`;
  if (op==='neq') return `"${col}"!='${v}'`;
  if (op==='gte') return `"${col}">='${v}'`;
  if (op==='lte') return `"${col}"<='${v}'`;
  if (op==='lt') return `"${col}"<'${v}'`;
  if (op==='gt') return `"${col}">'${v}'`;
  if (op==='like') return `"${col}" LIKE '${v}'`;
  return `"${col}"='${v}'`;
}

function parseFetchQuery(queryStr, table) {
  let sql = `SELECT * FROM "${table}"`, where = [], order = '', limit = 4000;
  const parts = (queryStr||'').split('&').filter(Boolean);
  for (const p of parts) {
    const eq = p.indexOf('='); if (eq < 0) continue;
    const k = p.slice(0, eq), v = p.slice(eq + 1); if (!k) continue;
    if (k === 'select') { if (v !== '*') sql = sql.replace('*', v.split(',').map(c => `"${c.trim()}"`).join(',')); }
    else if (k === 'order') { const [c, d] = v.split('.'); order = `ORDER BY "${c}" ${d === 'desc' ? 'DESC' : 'ASC'}`; }
    else if (k === 'limit') { limit = parseInt(v) || 4000; }
    else if (k === 'and') {
      const inner = v.startsWith('(') ? v.slice(1, -1) : v;
      for (const ap of inner.split(',')) {
        const dot = ap.indexOf('.'); if (dot < 0) continue;
        const col = ap.slice(0, dot), val = ap.slice(dot + 1);
        const opDot = val.indexOf('.');
        if (opDot < 0) { where.push(`"${col}"='${val.replace(/'/g,"''")}'`); continue; }
        const op = val.slice(0, opDot), raw = decodeURIComponent(val.slice(opDot + 1));
        where.push(whereOp(col, op, raw));
      }
    } else {
      const dot = v.indexOf('.');
      if (dot < 0) { where.push(`"${k}"='${v.replace(/'/g,"''")}'`); }
      else { const op = v.slice(0, dot), raw = decodeURIComponent(v.slice(dot + 1)); where.push(whereOp(k, op, raw)); }
    }
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  if (order) sql += ' ' + order;
  sql += ' LIMIT ' + limit;
  console.log('[db] fetchAll SQL:', table, sql.substring(0,250));
  return sql;
}

async function fetchAll(table, queryStr='') {
  const sql = parseFetchQuery(queryStr, table);
  if (mode==='postgres' && pool) {
    try { const r = await pool.query(sql); return r.rows; }
    catch(e) { console.error('[db] fetchAll error:', e.message.substring(0,80)); return []; }
  }
  const d = getDb(); if (!d) return [];
  try { return d.prepare(sql).all(); } catch(e) { return []; }
}

async function upsertRows(table, rows, conflictKey) {
  if (!rows || !rows.length) return [];
  if (mode === 'postgres' && pool) {
    const keys = Array.isArray(conflictKey) ? conflictKey : [conflictKey];
    const cols = Object.keys(rows[0]);
    const allCols = cols.map(c => `"${c}"`).join(',');
    const setCols = cols.filter(c => !keys.includes(c));
    const setClause = setCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(',');
    const conflictCols = keys.map(k => `"${k}"`).join(',');
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      let batch = rows.slice(i, i + BATCH);
      // Dedup within batch to prevent "cannot affect row a second time"
      const seen = new Set();
      batch = batch.filter(row => {
        const k = keys.map(k2 => row[k2] != null ? String(row[k2]) : '').join('|');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (!batch.length) continue;
      const values = [], placeholders = [];
      let idx = 1;
      for (const row of batch) {
        const ph = cols.map(() => '$' + (idx++));
        placeholders.push('(' + ph.join(',') + ')');
        for (const c of cols) values.push(row[c] != null ? row[c] : null);
      }
      const sql = `INSERT INTO "${table}" (${allCols}) VALUES ${placeholders.join(',')} ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClause}`;
      try { await pool.query(sql, values); } catch(e) { console.error('[db] upsert error:', e.message.substring(0,80)); }
    }
    return rows;
  }
  const d = getDb(); if (!d) return [];
  const keys = Array.isArray(conflictKey) ? conflictKey : [conflictKey], saved = [];
  for (const row of rows) {
    const cols = Object.keys(row);
    const ex = d.prepare(`SELECT 1 FROM "${table}" WHERE ${keys.map(k => `"${k}"=?`).join(' AND ')}`).get(...keys.map(k => row[k]));
    if (ex) {
      const sets = cols.filter(c => !keys.includes(c)).map(c => `"${c}"=?`).join(',');
      d.prepare(`UPDATE "${table}" SET ${sets} WHERE ${keys.map(k => `"${k}"=?`).join(' AND ')}`).run(...cols.filter(c => !keys.includes(c)).map(c => row[c]), ...keys.map(k => row[k]));
    } else {
      d.prepare(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => row[c]));
    }
    saved.push(row);
  }
  return saved;
}

async function insertRows(table, rows) {
  if (!rows || !rows.length) return [];
  if (mode === 'postgres' && pool) {
    const cols = Object.keys(rows[0]);
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
      try { await pool.query(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES ${placeholders.join(',')}`, values); } catch(e) {}
    }
    return rows;
  }
  const d = getDb(); if (!d) return [];
  for (const row of rows) {
    const cols = Object.keys(row);
    try { d.prepare(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => row[c])); } catch(e) {}
  }
  return rows;
}

async function upsertAdSpendRows(rows) {
  if (!rows || !rows.length) return [];
  if (mode === 'postgres' && pool) {
    const BATCH = 200;
    const saved = [];
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const cols = ["store_name","spend_date","amount","channel","campaign","note","created_at","updated_at"];
      const values = [], placeholders = [];
      let idx = 1;
      for (const row of batch) {
        placeholders.push(`(${cols.map(() => '$' + (idx++)).join(',')})`);
        for (const c of cols) values.push(row[c] != null ? row[c] : null);
      }
      try {
        await pool.query(
          `INSERT INTO finance_ad_spend(${cols.map(c=>'"'+c+'"').join(',')}) VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`,
          values
        );
        saved.push(...batch);
      } catch(e) {
        // Fallback: individual insert if batch fails (e.g., no unique constraint)
        for (const row of batch) {
          try {
            await pool.query(
              `INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
              [row.store_name,row.spend_date,row.amount,row.channel||'',row.campaign||'',row.note||'',row.created_at,row.updated_at]
            );
            saved.push(row);
          } catch(e2) { /* skip dup */ }
        }
      }
    }
    return saved;
  }
  return upsertRows('finance_ad_spend', rows, ['store_name', 'spend_date', 'channel', 'campaign']);
}

async function initSchema() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS finance_order_lines(line_key TEXT PRIMARY KEY,order_id TEXT,store_name TEXT,source TEXT,created_at TEXT,updated_at TEXT,status TEXT,order_substatus TEXT,sku TEXT,product_name TEXT,variation TEXT,quantity REAL,unit_price REAL,gross_product REAL,seller_discount REAL,platform_discount REAL,platform_fee REAL,refund_amount REAL,order_amount REAL,settlement_received REAL,payment_method TEXT,tracking_id TEXT,package_id TEXT,cancel_reason TEXT,shipped_time TEXT,adjustment_amount REAL,last_seen_file TEXT,last_seen_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_sku_costs(sku_key TEXT PRIMARY KEY,store_name TEXT,sku TEXT,product_name TEXT,hpp_per_unit REAL,packing_per_unit REAL,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_ad_spend(id SERIAL PRIMARY KEY,store_name TEXT,spend_date TEXT,amount REAL,channel TEXT,campaign TEXT,note TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_income_raw(id SERIAL PRIMARY KEY,store_name TEXT,transaction_type TEXT,order_id TEXT,order_created_time TEXT,settlement_amount REAL,total_fees REAL,refund_amount REAL,adjustment_amount REAL,imported_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_import_runs(id SERIAL PRIMARY KEY,filename TEXT,kind TEXT,store_name TEXT,rows_seen INTEGER,inserted INTEGER,updated INTEGER,unchanged INTEGER,audit_count INTEGER,message TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_audit_events(id TEXT PRIMARY KEY,run_id INTEGER,filename TEXT,kind TEXT,store_name TEXT,order_id TEXT,sku TEXT,field_name TEXT,old_value TEXT,new_value TEXT,change_type TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_config(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
  `;
  if (mode === 'postgres' && pool) {
    await pool.query(ddl);
    for (const idx of ["CREATE INDEX IF NOT EXISTS idx_ol_store ON finance_order_lines(store_name)","CREATE INDEX IF NOT EXISTS idx_ol_created ON finance_order_lines(created_at)","CREATE INDEX IF NOT EXISTS idx_ir_month ON finance_income_raw(store_name,order_created_time)"]) { try { await pool.query(idx); } catch(e) {} }
    // Use UNIQUE CONSTRAINT for ON CONFLICT support (income_raw + ad_spend)
    try { await pool.query('ALTER TABLE finance_income_raw ADD CONSTRAINT IF NOT EXISTS idx_income_unique UNIQUE (store_name, order_id, transaction_type)'); } catch(e) {}
    try { await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_unique ON finance_ad_spend(store_name, spend_date, COALESCE(channel,\'\'), COALESCE(campaign,\'\'))'); } catch(e) {}
    return;
  }
  const d = getDb(); if (!d) return;
  d.exec(ddl.replace(/SERIAL/g,'INTEGER').replace(/TEXT PRIMARY KEY/g,'TEXT').replace(/id SERIAL PRIMARY KEY/g,'id INTEGER PRIMARY KEY AUTOINCREMENT'));
  for (const idx of ["CREATE INDEX IF NOT EXISTS idx_ol_store ON finance_order_lines(store_name)","CREATE INDEX IF NOT EXISTS idx_ol_created ON finance_order_lines(created_at)","CREATE INDEX IF NOT EXISTS idx_ir_month ON finance_income_raw(store_name,order_created_time)","CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_unique ON finance_ad_spend(store_name,spend_date,COALESCE(channel,''),COALESCE(campaign,''))","CREATE UNIQUE INDEX IF NOT EXISTS idx_income_unique ON finance_income_raw(store_name,order_id,transaction_type)"]) { try { d.exec(idx); } catch(e) {} }
}

async function cacheGet(k) { return null; }
async function cacheSet(k,d,t) {}
async function cacheDelete(p) {}
async function cacheDeleteByTable(t) {}

module.exports = { pgConfigured, pgSetupMessage, pgQuery, fetchAll, upsertRows, insertRows, upsertAdSpendRows, initSchema, cacheGet, cacheSet, cacheDelete, cacheDeleteByTable, getDb };
