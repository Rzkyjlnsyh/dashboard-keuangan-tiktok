/**
 * PostgreSQL Connector — pengganti Supabase REST API untuk Dashboard Keuangan.
 * 
 * Menggantikan supabaseRequest/fetchAll/upsertRows/insertRows/upsertAdSpendRows
 * dengan query PostgreSQL langsung via node-postgres (pg).
 *
 * Environment variables:
 *   DATABASE_URL — required, format: postgresql://user:pass@host:port/database
 *   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD — fallback
 */

const { Pool } = require('pg');

let pool = null;

function pgEnv() {
  const url = process.env.DATABASE_URL || '';
  if (url) return { url, host: '', port: '', database: '', user: '', password: '' };
  return {
    url: '',
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || '5432',
    database: process.env.PGDATABASE || 'dashboard_keuangan',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
  };
}

function getPool() {
  if (pool) return pool;
  const env = pgEnv();
  pool = env.url
    ? new Pool({ connectionString: env.url })
    : new Pool({ host: env.host, port: parseInt(env.port, 10), database: env.database, user: env.user, password: env.password });
  pool.on('error', (err) => console.error('[pg-connector] Pool error:', err.message));
  return pool;
}

function pgConfigured() {
  const env = pgEnv();
  return Boolean(env.url || (env.host && env.database));
}

function pgSetupMessage() {
  return 'PostgreSQL belum tersambung. Isi DATABASE_URL atau set PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD.';
}

async function pgQuery(text, params = []) {
  if (!pgConfigured()) throw new Error(pgSetupMessage());
  const result = await getPool().query(text, params);
  return result;
}

function escapeL(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/'/g, "''");
}

function parseQueryParams(qs) {
  const r = { select: '*', where: [], order: '', limit: 0 };
  if (!qs) return r;
  for (const part of qs.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq), v = part.slice(eq + 1);
    if (!k || !v) continue;
    if (k === 'select') {
      r.select = v === '*' ? '*' : v.split(',').map(c => `"${c.trim()}"`).filter(Boolean).join(', ');
    } else if (k === 'order') {
      r.order = v.split(',').map(o => {
        const [c, d] = o.trim().split('.');
        return c ? `"${c}" ${d === 'desc' ? 'DESC' : 'ASC'}` : '';
      }).filter(Boolean).join(', ');
    } else if (k === 'limit') {
      r.limit = parseInt(v, 10) || 0;
    } else if (k.startsWith('and(') && k.endsWith(')')) {
      r.where.push(parseAndGroup(k.slice(4, -1)));
    } else if (k === 'or') {
      r.where.push(parseAndGroup(v)); // simplified: treat as AND group
    } else {
      r.where.push(parseCondition(k, v));
    }
  }
  return r;
}

function parseAndGroup(s) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      const trimmed = cur.trim();
      const dot = trimmed.indexOf('.');
      if (dot > 0) parts.push(parseCondition(trimmed.slice(0, dot), trimmed.slice(dot + 1)));
      cur = '';
    } else {
      cur += ch;
    }
  }
  const trimmed = cur.trim();
  const dot = trimmed.indexOf('.');
  if (dot > 0) parts.push(parseCondition(trimmed.slice(0, dot), trimmed.slice(dot + 1)));
  return parts.length ? `(${parts.join(' AND ')})` : '';
}

function parseCondition(col, val) {
  const d = val.indexOf('.');
  if (d < 0) return `"${col}" = '${escapeL(val)}'`;
  const op = val.slice(0, d);
  const raw = decodeURIComponent(val.slice(d + 1));
  switch (op) {
    case 'eq': return `"${col}" = '${escapeL(raw)}'`;
    case 'neq': return `"${col}" != '${escapeL(raw)}'`;
    case 'gte': return `"${col}" >= '${escapeL(raw)}'`;
    case 'lte': return `"${col}" <= '${escapeL(raw)}'`;
    case 'gt': return `"${col}" > '${escapeL(raw)}'`;
    case 'lt': return `"${col}" < '${escapeL(raw)}'`;
    case 'like': return `"${col}" ILIKE '${escapeL(raw)}'`;
    case 'is': return raw === 'null' ? `"${col}" IS NULL` : `"${col}" IS ${escapeL(raw)}`;
    case 'in': {
      const items = raw.slice(1, -1).split(',').map(s => `'${escapeL(s.trim())}'`).join(', ');
      return `"${col}" IN (${items})`;
    }
    default: return `"${col}" = '${escapeL(raw)}'`;
  }
}

function buildSQL(table, params) {
  let sql = `SELECT ${params.select} FROM "${table}"`;
  if (params.where.length) sql += ' WHERE ' + params.where.join(' AND ');
  if (params.order) sql += ' ORDER BY ' + params.order;
  return sql;
}

async function fetchAll(table, queryParams = '') {
  if (!pgConfigured()) throw new Error(pgSetupMessage());
  const params = parseQueryParams(queryParams);
  const sql = buildSQL(table, params);
  const pageSize = params.limit || 1000;
  const allRows = [];
  let offset = 0;
  while (true) {
    const r = await pgQuery(sql + ` LIMIT ${pageSize} OFFSET ${offset}`);
    allRows.push(...r.rows);
    if (r.rows.length < pageSize) break;
    offset += pageSize;
  }
  return allRows;
}

async function upsertRows(table, rows, conflictKey) {
  if (!rows.length) return [];
  if (!pgConfigured()) throw new Error(pgSetupMessage());
  const keys = Array.isArray(conflictKey) ? conflictKey : [conflictKey];
  const saved = [];
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    for (const row of batch) {
      const cols = Object.keys(row);
      const cnames = cols.map(c => `"${c}"`).join(', ');
      const ph = cols.map((_, j) => `$${j + 1}`).join(', ');
      const ups = cols.filter(c => !keys.includes(c)).map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');
      const vals = cols.map(c => (row[c] !== undefined && row[c] !== null ? row[c] : null));
      const ck = keys.map(k => `"${k}"`).join(', ');
      const result = await pgQuery(
        `INSERT INTO "${table}" (${cnames}) VALUES (${ph}) ON CONFLICT (${ck}) DO UPDATE SET ${ups || 'true = true'} RETURNING *`,
        vals
      );
      if (result.rows.length) saved.push(result.rows[0]);
    }
  }
  return saved;
}

async function insertRows(table, rows) {
  if (!rows.length) return [];
  if (!pgConfigured()) throw new Error(pgSetupMessage());
  const saved = [];
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    for (const row of batch) {
      const cols = Object.keys(row);
      const cnames = cols.map(c => `"${c}"`).join(', ');
      const ph = cols.map((_, j) => `$${j + 1}`).join(', ');
      const vals = cols.map(c => (row[c] !== undefined && row[c] !== null ? row[c] : null));
      const result = await pgQuery(
        `INSERT INTO "${table}" (${cnames}) VALUES (${ph}) RETURNING *`, vals
      );
      if (result.rows.length) saved.push(result.rows[0]);
    }
  }
  return saved;
}

async function upsertAdSpendRows(rows) {
  if (!rows.length) return [];
  if (!pgConfigured()) throw new Error(pgSetupMessage());
  const saved = [];
  const p = getPool();
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
  for (const row of rows) {
    const store = String(row.store_name || 'ventura').toLowerCase().trim();
    const spendDate = String(row.spend_date || '').slice(0, 10);
    const channel = String(row.channel || 'TikTok Ads').trim() || 'TikTok Ads';
    const campaign = String(row.campaign || '').trim();
    const exist = await p.query(
      `SELECT id FROM "finance_ad_spend" WHERE "store_name"=$1 AND "spend_date"=$2 AND COALESCE("channel",'')=$3 AND COALESCE("campaign",'')=$4 LIMIT 1`,
      [store, spendDate, channel, campaign]
    );
    const prep = { ...row, store_name: store, spend_date: spendDate, channel, campaign, updated_at: now };
    if (exist.rows[0]) {
      const cols = Object.keys(prep).filter(k => k !== 'id');
      const sets = cols.map((k, j) => `"${k}" = $${j + 1}`).join(', ');
      const vals = cols.map(k => (prep[k] !== undefined && prep[k] !== null ? prep[k] : null));
      const r = await p.query(`UPDATE "finance_ad_spend" SET ${sets} WHERE id = $${cols.length + 1} RETURNING *`, [...vals, exist.rows[0].id]);
      if (r.rows.length) saved.push(r.rows[0]);
    } else {
      const cols = Object.keys(prep);
      const cnames = cols.map(c => `"${c}"`).join(', ');
      const ph = cols.map((_, j) => `$${j + 1}`).join(', ');
      const vals = cols.map(k => (prep[k] !== undefined && prep[k] !== null ? prep[k] : null));
      const r = await p.query(`INSERT INTO "finance_ad_spend" (${cnames}) VALUES (${ph}) RETURNING *`, vals);
      if (r.rows.length) saved.push(r.rows[0]);
    }
  }
  return saved;
}

async function initSchema() {
  if (!pgConfigured()) return;
  const stmts = `
    CREATE TABLE IF NOT EXISTS "finance_order_lines" ( "line_key" TEXT PRIMARY KEY, "order_id" TEXT, "store_name" TEXT NOT NULL DEFAULT 'ventura', "source" TEXT, "created_at" TEXT, "updated_at" TEXT, "status" TEXT, "sku" TEXT, "product_name" TEXT, "variation" TEXT, "quantity" NUMERIC DEFAULT 0, "unit_price" NUMERIC DEFAULT 0, "gross_product" NUMERIC DEFAULT 0, "seller_discount" NUMERIC DEFAULT 0, "platform_discount" NUMERIC DEFAULT 0, "platform_fee" NUMERIC DEFAULT 0, "refund_amount" NUMERIC DEFAULT 0, "order_amount" NUMERIC DEFAULT 0, "settlement_received" NUMERIC DEFAULT 0, "payment_method" TEXT, "tracking_id" TEXT, "last_seen_file" TEXT, "last_seen_at" TEXT );
    CREATE INDEX IF NOT EXISTS idx_finance_order_lines_store ON "finance_order_lines" ("store_name");
    CREATE INDEX IF NOT EXISTS idx_finance_order_lines_created ON "finance_order_lines" ("created_at");
    CREATE INDEX IF NOT EXISTS idx_finance_order_lines_order ON "finance_order_lines" ("order_id");
    CREATE INDEX IF NOT EXISTS idx_finance_order_lines_sku ON "finance_order_lines" ("sku");
    CREATE TABLE IF NOT EXISTS "finance_sku_costs" ( "sku_key" TEXT PRIMARY KEY, "store_name" TEXT NOT NULL DEFAULT 'global', "sku" TEXT NOT NULL, "product_name" TEXT, "hpp_per_unit" NUMERIC DEFAULT 0, "packing_per_unit" NUMERIC DEFAULT 0, "updated_at" TEXT );
    CREATE INDEX IF NOT EXISTS idx_finance_sku_costs_store_sku ON "finance_sku_costs" ("store_name", "sku");
    CREATE TABLE IF NOT EXISTS "finance_ad_spend" ( "id" BIGSERIAL PRIMARY KEY, "store_name" TEXT NOT NULL DEFAULT 'ventura', "spend_date" DATE NOT NULL, "amount" NUMERIC NOT NULL DEFAULT 0, "channel" TEXT, "campaign" TEXT, "note" TEXT, "created_at" TEXT, "updated_at" TEXT );
    CREATE INDEX IF NOT EXISTS idx_finance_ad_spend_store_date ON "finance_ad_spend" ("store_name", "spend_date");
    CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_ad_spend_unique ON "finance_ad_spend" ("store_name", "spend_date", COALESCE("channel", ''), COALESCE("campaign", ''));
    CREATE TABLE IF NOT EXISTS "finance_import_runs" ( "id" BIGSERIAL PRIMARY KEY, "filename" TEXT, "kind" TEXT, "store_name" TEXT, "rows_seen" INTEGER DEFAULT 0, "inserted" INTEGER DEFAULT 0, "updated" INTEGER DEFAULT 0, "unchanged" INTEGER DEFAULT 0, "audit_count" INTEGER DEFAULT 0, "message" TEXT, "created_at" TEXT );
    CREATE TABLE IF NOT EXISTS "finance_audit_events" ( "id" BIGSERIAL PRIMARY KEY, "run_id" BIGINT REFERENCES "finance_import_runs"("id") ON DELETE SET NULL, "filename" TEXT, "kind" TEXT, "store_name" TEXT, "order_id" TEXT, "sku" TEXT, "field_name" TEXT, "old_value" TEXT, "new_value" TEXT, "change_type" TEXT, "created_at" TEXT );
    CREATE INDEX IF NOT EXISTS idx_finance_audit_events_store ON "finance_audit_events" ("store_name");
    CREATE INDEX IF NOT EXISTS idx_finance_audit_events_run ON "finance_audit_events" ("run_id");
    CREATE TABLE IF NOT EXISTS "finance_config" ( "key" TEXT PRIMARY KEY, "value" JSONB NOT NULL DEFAULT '{}', "updated_at" TEXT );
  `.split(';').filter(s => s.trim());
  for (const stmt of stmts) {
    if (stmt.trim()) await pgQuery(stmt.trim());
  }
}

module.exports = {
  pgConfigured,
  pgSetupMessage,
  pgQuery,
  fetchAll,
  upsertRows,
  insertRows,
  upsertAdSpendRows,
  initSchema,
};
