/**
 * ULTIMATE IMPORT — Custombase Mei + Juni 2026
 * Menggunakan 1juni-sekarang.xlsx (file income paling lengkap)
 * SKU HPP dari sku-template.xlsx + POLA hardcoded
 */
const pg = require('../lib/pg-connector');
const fs = require('fs');
const XLSX = require('xlsx');
const path = require('path');

const ct = v => String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
function rp(v) {
  const t = String(v||'').trim(); if(!t) return 0;
  const neg = /^-/.test(t); let n = t.replace(/[^\d,.\-]/g,'');
  if(n.startsWith('+')) n = n.slice(1);
  const p = Number.parseFloat(n.replace(/,/g,''));
  return Number.isFinite(p) ? Math.round(Math.abs(p) * (neg ? -1 : 1)) : 0;
}
function pd(v) {
  if(!v) return ''; const r = String(v).trim();
  const iso = r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if(iso) return iso[1]+'-'+iso[2].padStart(2,'0')+'-'+iso[3].padStart(2,'0');
  const s = r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if(s) return (s[3].length===2?'20'+s[3]:s[3])+'-'+s[2].padStart(2,'0')+'-'+s[1].padStart(2,'0');
  return '';
}

// POLA SKU HPP mapping — based on variation/quantity
const POLA_HPP = {
  'pola25pcs': 3000, 'pola50pcs': 6000, 'pola100pcs': 12000,
  'pola125pcs': 15000, 'pola150pcs': 18000, 'pola200pcs': 24000,
  'polaroid25': 3000, 'polaroid50': 6000, 'polaroid100': 12000,
  'polaroid125': 15000, 'polaroid150': 18000, 'polaroid200': 24000,
  'gancifotonama': 2000, 'holologo9': 9000,
};

const STORE = 'custombase';
const DATA_DIR = path.join(__dirname,'..','data tiktok','CUSTOMBASE');
// Use BOTH files: income_20260718110824 (verified May data) + 1juni-sekarang (June-July data)
const INCOME_FILES = [
  path.join(__dirname,'..','income_20260718110824(UTC+7).xlsx'),  // PRIMARY: has correct May golden test
  path.join(__dirname,'..','1juni-sekarang.xlsx'),                 // EXTENDS: June orders settled in July
];
const SKU_FILE = path.join(__dirname,'..','sku-template.xlsx');
const now = new Date().toISOString();
const fmt = n => Math.round(n||0).toLocaleString('id-ID');

async function main() {
  await pg.initSchema();
  const db = pg.getDb();
  
  // Fix schema
  try { db.prepare("ALTER TABLE finance_sku_costs ADD COLUMN product_name TEXT").run(); } catch(e) {}
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_income_unique ON finance_income_raw(store_name,order_id,transaction_type)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_key ON finance_sku_costs(sku_key)").run();
  
  // Clear all custombase data
  db.prepare("DELETE FROM finance_income_raw WHERE store_name=?").run(STORE);
  db.prepare("DELETE FROM finance_ad_spend WHERE store_name=?").run(STORE);
  db.prepare("DELETE FROM finance_order_lines WHERE store_name=?").run(STORE);
  db.prepare("DELETE FROM finance_sku_costs WHERE store_name=?").run(STORE);
  console.log('Cleared all data for', STORE);
  
  // ========================================
  // 1. IMPORT ORDERS (Mei + Juni)
  // ========================================
  console.log('\n=== ORDERS ===');
  const orderFiles = [
    ['custombase_semuapesanan_mei.xlsx', '2026-05'],
    ['custombase_semuapesanan_juni.xlsx', '2026-06'],
  ];
  let totalOrders = 0;
  for (const [file, month] of orderFiles) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) { console.log('  SKIP:', file); continue; }
    const wb = XLSX.readFile(fp, {cellDates: false, raw: true});
    const sheet = wb.Sheets['OrderSKUList'];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, {defval: ''});
    let count = 0;
    const stmt = db.prepare("INSERT OR REPLACE INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,sku,product_name,variation,quantity,unit_price,gross_product,seller_discount,platform_discount,order_amount,tracking_id,package_id,cancel_reason,shipped_time,last_seen_file,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const r of rows) {
      const oid = String(r['Order ID']||'').trim();
      const sku = String(r['Seller SKU']||'').trim();
      if (!oid || !sku || oid.toLowerCase().includes('platform unique')) continue;
      const c = pd(r['Created Time']); if (!c || !c.startsWith(month)) continue;
      const qty = Math.abs(parseInt(String(r['Quantity']).trim())||0);
      const up = rp(r['SKU Unit Original Price']);
      const varia = String(r['Variation']||'').trim();
      const key = ct(STORE)+'|'+oid+'|'+ct(sku)+'|'+ct(varia);
      stmt.run(key, oid, STORE, 'tiktok_order', c, c,
        String(r['Order Status']).trim(), sku,
        String(r['Product Name']||'').trim(), varia,
        qty, up, rp(r['SKU Subtotal Before Discount'])||up*qty,
        Math.abs(rp(r['SKU Seller Discount'])),
        Math.abs(rp(r['SKU Platform Discount'])),
        rp(r['Order Amount']),
        String(r['Tracking ID']||'').trim(),
        String(r['Package ID']||'').trim(),
        String(r['Cancel Reason']||'').trim(),
        pd(r['Shipped Time'])||null, file, now);
      count++;
    }
    console.log('  '+file+': '+count+' rows');
    totalOrders += count;
  }
  console.log('  Total: '+totalOrders+' order line rows');
  
  // ========================================
  // 2. IMPORT INCOME (multiple files, deduplicated)
  // ========================================
  console.log('\n=== INCOME STATEMENTS ===');
  const incomeStmt = db.prepare("INSERT OR IGNORE INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at) VALUES(?,?,?,?,?,?,?,?,?)");
  let totalIncome = 0, totalGMV = 0, totalPenggantian = 0;
  
  for (const incomePath of INCOME_FILES) {
    if (!fs.existsSync(incomePath)) { console.log('  SKIP (not found):', path.basename(incomePath)); continue; }
    console.log('  Reading:', path.basename(incomePath));
    const iwb = XLSX.readFile(incomePath, {cellFormula: false, cellStyles: false, cellDates: false});
    const sheet = iwb.Sheets['Detail pesanan'];
    if (!sheet) { console.log('    No Detail pesanan sheet'); continue; }
    const ikeys = Object.keys(sheet).filter(k => k && k[0] !== '!');
    let maxRow = 0;
    for (const k of ikeys) { try { const c = XLSX.utils.decode_cell(k); if(c.r > maxRow) maxRow = c.r; } catch(e) {} }
    sheet['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:maxRow, c:79}});
    const irows = XLSX.utils.sheet_to_json(sheet, {header:1, defval:''});
    
    let fIncome = 0, fGMV = 0, fPenggantian = 0;
    for (let i = 1; i < irows.length; i++) {
      const r = irows[i]; if (!r || !r[1]) continue;
      const type = String(r[1]).trim(); const tm = pd(r[2]); if (!tm) continue;
      const settlementAmt = rp(r[5]);
      const feesAmt = Math.abs(rp(r[14]));
      const refundAmt = rp(r[11]);
      
      incomeStmt.run(STORE, type, String(r[0]).trim(), tm, settlementAmt, feesAmt, refundAmt, 0, now);
      
      if (type === 'Pesanan') fIncome++;
      else if (type === 'Pembayaran GMV untuk Iklan TikTok') fGMV++;
      else if (type.toLowerCase().includes('penggantian')) fPenggantian++;
    }
    console.log('    Pesanan: '+fIncome+', GMV: '+fGMV+', Penggantian: '+fPenggantian);
    totalIncome += fIncome; totalGMV += fGMV; totalPenggantian += fPenggantian;
  }
  
  // Count AFTER dedup (INSERT OR IGNORE means only first occurrence stored)
  const actualIncome = db.prepare("SELECT COUNT(*) as c FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan'").get(STORE);
  const actualGMV = db.prepare("SELECT COUNT(*) as c FROM finance_income_raw WHERE store_name=? AND transaction_type='Pembayaran GMV untuk Iklan TikTok'").get(STORE);
  console.log('  Stored (dedup): Pesanan='+actualIncome.c+', GMV='+actualGMV.c);
  
  // Match income to order_lines for drilldown
  const incomeOrders = db.prepare("SELECT DISTINCT order_id, SUM(settlement_amount) as s, SUM(total_fees) as f, SUM(refund_amount) as r FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' GROUP BY order_id").all(STORE);
  const updateStmt = db.prepare("UPDATE finance_order_lines SET source='income_statement', settlement_received=?, platform_fee=?, refund_amount=? WHERE order_id=? AND store_name=?");
  let updatedOids = 0;
  for (const ir of incomeOrders) {
    const result = updateStmt.run(ir.s, ir.f, ir.r, ir.order_id, STORE);
    updatedOids += result.changes;
  }
  console.log('  Orders matched: '+incomeOrders.length+' unique, '+updatedOids+' line rows updated');
  
  // ========================================
  // 3. IMPORT SKU HPP (sku-template + POLA)
  // ========================================
  console.log('\n=== SKU HPP ===');
  const swb = XLSX.readFile(SKU_FILE);
  const ssheet = swb.Sheets['sku-template'];
  let skuCnt = 0;
  if (ssheet) {
    const srows = XLSX.utils.sheet_to_json(ssheet, {defval: ''});
    const skuStmt = db.prepare("INSERT OR REPLACE INTO finance_sku_costs(sku_key,store_name,sku,product_name,hpp_per_unit,packing_per_unit,updated_at) VALUES(?,?,?,?,?,?,?)");
    for (const r of srows) {
      const sku = String(r.sku||'').trim();
      const hpp = Math.abs(Number(r.hppPerUnit||0));
      if (!sku || hpp <= 0) continue;
      const key = STORE+'|'+ct(sku);
      skuStmt.run(key, STORE, sku, String(r.product_name||'').trim(), hpp, 0, now);
      skuCnt++;
    }
    console.log('  sku-template.xlsx: '+skuCnt+' entries');
  }
  
  // Add POLA HPP entries
  const polaStmt = db.prepare("INSERT OR REPLACE INTO finance_sku_costs(sku_key,store_name,sku,product_name,hpp_per_unit,packing_per_unit,updated_at) VALUES(?,?,?,?,?,?,?)");
  for (const [skuName, hpp] of Object.entries(POLA_HPP)) {
    const key = STORE+'|'+ct(skuName);
    polaStmt.run(key, STORE, skuName, 'POLA '+skuName, hpp, 0, now);
    skuCnt++;
  }
  console.log('  POLA hardcoded: '+Object.keys(POLA_HPP).length+' entries');
  console.log('  Total SKU: '+skuCnt+' entries');
  
  // ========================================
  // 4. IMPORT AD SPEND (Top Up only)
  // ========================================
  console.log('\n=== AD SPEND ===');
  const adFiles = [
    ['custombase_iklan_mei.xlsx', '2026-05'],
    ['custombase_iklan_juni.xlsx', '2026-06'],
  ];
  const adStmt = db.prepare("INSERT OR IGNORE INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
  for (const [file, month] of adFiles) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) { console.log('  SKIP:', file); continue; }
    const wb = XLSX.readFile(fp, {cellDates: false, raw: true});
    const asheet = wb.Sheets['sheet1'];
    if (!asheet) continue;
    const arows = XLSX.utils.sheet_to_json(asheet, {defval: ''});
    let tuCnt = 0;
    for (const r of arows) {
      if (String(r['Transaction type']||'').trim() !== 'General') continue;
      if (String(r['Transaction subtype']||'').trim() !== 'Add balance') continue;
      if (String(r['Status']||'').trim() !== 'Success') continue;
      if (String(r['Fund type']||'').trim() !== 'Cash') continue;
      if (String(r['Description']||'').toLowerCase().includes('gmv pay')) continue;
      const spendDate = String(r['Transaction time']||'').trim().slice(0,10).replace(/\//g,'-');
      adStmt.run(STORE, spendDate, rp(r['Amount']), 'TikTok Top Up', 'Manual', 'Top up manual', now, now);
      tuCnt++;
    }
    console.log('  '+file+': '+tuCnt+' top-up');
  }
  
  // ========================================
  // VERIFICATION
  // ========================================
  console.log('\n========================================');
  console.log('  VERIFICATION');
  console.log('========================================');
  
  // May
  const mayS = db.prepare("SELECT SUM(settlement_amount) as s, SUM(total_fees) as f FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' AND order_created_time LIKE '2026-05%'").get(STORE);
  const mayG = db.prepare("SELECT SUM(ABS(settlement_amount)) as s FROM finance_income_raw WHERE store_name=? AND transaction_type='Pembayaran GMV untuk Iklan TikTok' AND order_created_time LIKE '2026-05%'").get(STORE);
  const mayT = db.prepare("SELECT SUM(amount) as s FROM finance_ad_spend WHERE store_name=? AND channel='TikTok Top Up' AND spend_date LIKE '2026-05%'").get(STORE);
  
  console.log('\n[MEI]');
  console.log('  Settlement Cair:  '+fmt(mayS.s)+' | Expected 8.772.345 | '+(Math.round(mayS.s||0)===8772345?'✅':'❌ Δ'+fmt(Math.round(mayS.s||0)-8772345)));
  console.log('  Potongan Platform: '+fmt(mayS.f)+' | Expected 3.223.291 | '+(Math.round(mayS.f||0)===3223291?'✅':'❌'));
  console.log('  Iklan GMV:        '+fmt(mayG.s)+' | Expected 1.472.709 | '+(Math.round(mayG.s||0)===1472709?'✅':'❌'));
  console.log('  Iklan Top Up:     '+fmt(mayT.s)+' | Expected 1.665.000 | '+(Math.round(mayT.s||0)===1665000?'✅':'❌'));
  
  // June
  const junS = db.prepare("SELECT SUM(settlement_amount) as s, SUM(total_fees) as f FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' AND order_created_time LIKE '2026-06%'").get(STORE);
  const junG = db.prepare("SELECT SUM(ABS(settlement_amount)) as s FROM finance_income_raw WHERE store_name=? AND transaction_type='Pembayaran GMV untuk Iklan TikTok' AND order_created_time LIKE '2026-06%'").get(STORE);
  const junT = db.prepare("SELECT SUM(amount) as s FROM finance_ad_spend WHERE store_name=? AND channel='TikTok Top Up' AND spend_date LIKE '2026-06%'").get(STORE);
  const junP = db.prepare("SELECT SUM(settlement_amount) as s FROM finance_income_raw WHERE store_name=? AND transaction_type LIKE '%Penggantian%' AND order_created_time LIKE '2026-06%'").get(STORE);
  
  // Count orders by status for June
  const junOrders = db.prepare("SELECT status, COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at LIKE '2026-06%' AND (status='Selesai' OR status='Dikirim') GROUP BY status").all(STORE);
  console.log('\n[JUNI]');
  for (const o of junOrders) console.log('  Orders '+o.status+': '+o.c);
  console.log('  Settlement Cair:  '+fmt(junS.s)+' | Expected 5.026.837 (real)');
  console.log('  Potongan Platform: '+fmt(junS.f)+' | Expected 8.665.750 (total accrual)');
  console.log('  Iklan GMV:        '+fmt(junG.s)+' | Expected 6.625.056 | '+(Math.round(junG.s||0)===6625056?'✅':'❌'));
  console.log('  Iklan Top Up:     '+fmt(junT.s)+' | Expected 222.000 | '+(Math.round(junT.s||0)===222000?'✅':'❌'));
  console.log('  Penggantian:      '+fmt(junP.s)+' | Expected 56.100 | '+(Math.round(junP.s||0)===56100?'✅':'❌'));
  
  console.log('\n✅ IMPORT COMPLETE — Jalankan: node server.js');
  process.exit(0);
}

main().catch(e => { console.error(e.message); console.error(e.stack); process.exit(1); });
