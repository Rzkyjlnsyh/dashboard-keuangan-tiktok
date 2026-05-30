const assert = require('assert');
const finance = require('../lib/finance-cloud');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function resetEnv() {
  process.env = { ...originalEnv, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };
}

function parseQuery(url) {
  const u = new URL(url);
  const table = u.pathname.split('/').pop();
  const params = Object.fromEntries(u.searchParams.entries());
  return { table, params, headers: {} };
}

function makeFetch(db, calls) {
  return async (url, options = {}) => {
    const { table, params } = parseQuery(url);
    calls.push({ table, params, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, range: options.headers && options.headers.Range });
    if ((options.method || 'GET') === 'GET') {
      let rows = [...(db[table] || [])];
      for (const [key, value] of Object.entries(params)) {
        if (key === 'select' || key === 'order' || key === 'limit') continue;
        const [op, raw] = String(value).split('.', 2);
        if (op === 'eq') rows = rows.filter(r => String(r[key] || '') === raw);
        if (op === 'gte') rows = rows.filter(r => String(r[key] || '') >= raw);
        if (op === 'lte') rows = rows.filter(r => String(r[key] || '') <= raw);
      }
      if (params.select && params.select !== '*') {
        const cols = params.select.split(',').map(s => s.trim());
        rows = rows.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
      }
      return { ok: true, text: async () => JSON.stringify(rows) };
    }
    if ((options.method || 'GET') === 'POST') {
      return { ok: true, text: async () => JSON.stringify(calls[calls.length - 1].body || []) };
    }
    if ((options.method || 'GET') === 'PATCH') {
      return { ok: true, text: async () => JSON.stringify([calls[calls.length - 1].body || {}]) };
    }
    return { ok: true, text: async () => '[]' };
  };
}

async function testPackingUsesPerLineQuantityCost() {
  resetEnv();
  const db = {
    finance_order_lines: [
      { line_key: 'ventura|o1|a|', order_id: 'o1', store_name: 'ventura', source: 'desty_order', created_at: '2026-05-10', status: 'Selesai', sku: 'A', quantity: 2, gross_product: 200000, seller_discount: 0, platform_fee: 0, order_amount: 200000, settlement_received: 0 },
      { line_key: 'ventura|o1|b|', order_id: 'o1', store_name: 'ventura', source: 'desty_order', created_at: '2026-05-10', status: 'Selesai', sku: 'B', quantity: 1, gross_product: 100000, seller_discount: 0, platform_fee: 0, order_amount: 100000, settlement_received: 0 },
    ],
    finance_sku_costs: [
      { sku_key: 'ventura|a', store_name: 'ventura', sku: 'A', hpp_per_unit: 10000, packing_per_unit: 1000 },
      { sku_key: 'ventura|b', store_name: 'ventura', sku: 'B', hpp_per_unit: 10000, packing_per_unit: 5000 },
    ],
    finance_ad_spend: [],
    finance_import_runs: [],
    finance_audit_events: [],
  };
  const calls = [];
  global.fetch = makeFetch(db, calls);
  const summary = await finance.computeSummary({ preset: 'month', month: '2026-05', store: 'ventura' });
  assert.strictEqual(summary.totals.packing, 7000, 'packing harus 2*1000 + 1*5000, bukan max packing * package count/pro-rata');
}

async function testSummaryPushesMonthFilterToSupabase() {
  resetEnv();
  const db = { finance_order_lines: [], finance_sku_costs: [], finance_ad_spend: [], finance_import_runs: [], finance_audit_events: [] };
  const calls = [];
  global.fetch = makeFetch(db, calls);
  await finance.computeSummary({ preset: 'month', month: '2026-04', store: 'ventura' });
  const orderCall = calls.find(c => c.table === 'finance_order_lines' && c.method === 'GET' && c.params.select === '*');
  assert(orderCall, 'harus fetch finance_order_lines');
  assert.strictEqual(orderCall.params.and, '(created_at.gte.2026-04-01,created_at.lte.2026-04-30)');
}

async function testIncomeSettlementDetectsGmvAdColumns() {
  resetEnv();
  const db = {
    finance_order_lines: [
      { line_key: 'ventura|o9|sku|', order_id: 'O9', store_name: 'ventura', source: 'desty_order', created_at: '2026-05-02', status: 'Selesai', sku: 'SKU', quantity: 1, gross_product: 100000, seller_discount: 0, platform_fee: 0, order_amount: 100000, settlement_received: 0 },
    ],
    finance_sku_costs: [], finance_ad_spend: [], finance_import_runs: [], finance_audit_events: [],
  };
  const calls = [];
  global.fetch = makeFetch(db, calls);
  await finance.importRows({
    storeName: 'ventura', kind: 'income', filename: 'pencairan.csv', rows: [{
      'Order/adjustment ID': 'T9',
      'Related order ID': 'O9',
      'Type': 'Order',
      'Order settled time': '2026-05-03 10:00:00',
      'Total settlement amount': '90000',
      'Total Revenue': '100000',
      'Total Fees': '10000',
      'GMV Max Ads Fee': '12345',
    }]
  });
  const adPost = calls.find(c => c.table === 'finance_ad_spend' && c.method === 'POST' && Array.isArray(c.body) && c.body[0] && c.body[0].channel === 'TikTok Ads Settlement');
  assert(adPost, 'harus insert/upsert ad spend settlement dari kolom GMV Max Ads Fee');
  assert.strictEqual(Number(adPost.body[0].amount), 12345);
}

(async () => {
  try {
    await testPackingUsesPerLineQuantityCost();
    await testSummaryPushesMonthFilterToSupabase();
    await testIncomeSettlementDetectsGmvAdColumns();
    console.log('finance regression tests passed');
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
