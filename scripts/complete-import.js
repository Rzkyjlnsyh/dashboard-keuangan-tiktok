/**
 * COMPLETE IMPORT — Custombase Mei + Juni 2026
 * 
 * Imports:
 * 1. Orders from all CSV/XLSX order files
 * 2. Income from income statement (into BOTH finance_income_raw AND finance_order_lines)
 * 3. SKU HPP from sku-template.xlsx
 * 4. Ads from ad spend files
 * 
 * Settlement and platform fees are stored in finance_income_raw for direct aggregation.
 * finance_order_lines is updated for drilldown purposes only.
 * 
 * Usage: node scripts/complete-import.js
 */
const pg = require('../lib/pg-connector');
const fs = require('fs');
const XLSX = require('xlsx');
const path = require('path');
const crypto = require('crypto');

const ct = v => String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
function rp(v) {
  const t = String(v||'').trim();
  if(!t) return 0;
  let n = t.replace(/[^\d,.\-]/g,'');
  if(n.startsWith('+')) n = n.slice(1);
  const p = Number.parseFloat(n.replace(/,/g,''));
  const neg=/^-/.test(t);return Number.isFinite(p)?Math.round(Math.abs(p)*(neg?-1:1)):0;
}
function pd(v) {
  if(!v) return '';
  const r = String(v).trim();
  const iso = r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if(iso) return iso[1]+'-'+iso[2].padStart(2,'0')+'-'+iso[3].padStart(2,'0');
  const s = r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if(s) return (s[3].length===2?'20'+s[3]:s[3])+'-'+s[2].padStart(2,'0')+'-'+s[1].padStart(2,'0');
  return '';
}

const STORE = 'custombase';
const DATA_DIR = path.join(__dirname,'..','data tiktok','CUSTOMBASE');
const INCOME_FILE = path.join(__dirname,'..','income_20260718110824(UTC+7).xlsx');
const SKU_FILE = path.join(__dirname,'..','sku-template.xlsx');
const now = new Date().toISOString();
const fmt = n => Math.round(n||0).toLocaleString('id-ID');

async function main() {
  await pg.initSchema();
  
  // Clear existing data for clean import
  const db = pg.getDb();
  db.prepare("DELETE FROM finance_income_raw WHERE store_name=?").run(STORE);
  db.prepare("DELETE FROM finance_ad_spend WHERE store_name=?").run(STORE);
  db.prepare("DELETE FROM finance_order_lines WHERE store_name=?").run(STORE);
  db.prepare("DELETE FROM finance_sku_costs WHERE store_name=? OR store_name='global'").run(STORE);
  console.log('Cleared existing data for', STORE);
  
  // Fix schema: ensure tables have correct columns
  try { db.prepare("ALTER TABLE finance_sku_costs ADD COLUMN product_name TEXT").run(); } catch(e) { /* already exists */ }
  
  // ========== 1. IMPORT ORDERS ==========
  console.log('\n=== IMPORTING ORDERS ===');
  const orderFiles = [
    ['custombase_semuapesanan_mei.xlsx', '2026-05'],
    ['custombase_semuapesanan_juni.xlsx', '2026-06'],
  ];
  
  let totalOrders = 0;
  for (const [file, month] of orderFiles) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) { console.log('  SKIP (not found):', file); continue; }
    const wb = XLSX.readFile(fp, {cellDates: false, raw: true});
    const sheet = wb.Sheets['OrderSKUList'];
    if (!sheet) { console.log('  No OrderSKUList sheet in:', file); continue; }
    const rows = XLSX.utils.sheet_to_json(sheet, {defval: ''});
    let count = 0;
    for (const r of rows) {
      const oid = String(r['Order ID']||'').trim();
      const sku = String(r['Seller SKU']||'').trim();
      if (!oid || !sku || oid.toLowerCase().includes('platform unique order')) continue;
      // Skip description row
      if (oid.toLowerCase().includes('platform unique')) continue;
      const c = pd(r['Created Time']);
      if (!c || !c.startsWith(month)) continue;
      const qty = Math.abs(parseInt(String(r['Quantity']).trim())||0);
      const up = rp(r['SKU Unit Original Price']);
      const varia = String(r['Variation']||'').trim();
      const key = ct(STORE)+'|'+oid+'|'+ct(sku)+'|'+ct(varia);
      db.prepare(`INSERT OR IGNORE INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,sku,product_name,variation,quantity,unit_price,gross_product,seller_discount,platform_discount,order_amount,tracking_id,package_id,cancel_reason,shipped_time,last_seen_file,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        key, oid, STORE, 'tiktok_order', c, c,
        String(r['Order Status']).trim(), sku,
        String(r['Product Name']||'').trim(), varia,
        qty, up,
        rp(r['SKU Subtotal Before Discount']) || up*qty,
        Math.abs(rp(r['SKU Seller Discount'])),
        Math.abs(rp(r['SKU Platform Discount'])),
        rp(r['Order Amount']),
        String(r['Tracking ID']||'').trim(),
        String(r['Package ID']||'').trim(),
        String(r['Cancel Reason']||'').trim(),
        pd(r['Shipped Time']) || null,
        file, now
      );
      count++;
    }
    console.log(`  ${file}: ${count} rows (month ${month})`);
    totalOrders += count;
  }
  console.log(`  Total orders: ${totalOrders} rows`);
  
  // ========== 2. IMPORT INCOME ==========
  console.log('\n=== IMPORTING INCOME STATEMENT ===');
  if (!fs.existsSync(INCOME_FILE)) {
    console.log('  SKIP: income file not found:', INCOME_FILE);
  } else {
    const iwb = XLSX.readFile(INCOME_FILE, {cellFormula: false, cellStyles: false, cellDates: false});
    const sheet = iwb.Sheets['Detail pesanan'];
    if (!sheet) { console.log('  No Detail pesanan sheet'); }
    else {
      // Fix !ref to include all rows
      const ikeys = Object.keys(sheet).filter(k => k && k[0] !== '!');
      let maxRow = 0;
      for (const k of ikeys) {
        try { const c = XLSX.utils.decode_cell(k); if(c.r > maxRow) maxRow = c.r; } catch(e) {}
      }
      sheet['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:maxRow, c:79}});
      const irows = XLSX.utils.sheet_to_json(sheet, {header:1, defval:''});
      
      let incomeCnt = 0, gmvCnt = 0, penggantianCnt = 0;
      const orderUpdates = [];
      
      for (let i = 1; i < irows.length; i++) {
        const r = irows[i];
        if (!r || !r[1]) continue;
        const type = String(r[1]).trim();
        const tm = pd(r[2]); // Waktu pemesanan
        if (!tm) continue;
        
        // Store raw income row (ALL types, ALL months for completeness)
        const rawKey = `${STORE}|${String(r[0]).trim()}|${type}|${tm.slice(0,10)}`;
        const settlementAmt = rp(r[5]);
        const feesAmt = Math.abs(rp(r[14]));
        const refundAmt = rp(r[11]);
        db.prepare(`INSERT OR REPLACE INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(
          STORE, type, String(r[0]).trim(), tm, settlementAmt, feesAmt, refundAmt, 0, now
        );
        
        // Track counts for specific types
        if (type === 'Pesanan') incomeCnt++;
        else if (type === 'Pembayaran GMV untuk Iklan TikTok') gmvCnt++;
        else if (type.toLowerCase().includes('penggantian')) penggantianCnt++;
        
        // Update order_lines for drilldown (only Pesanan)
        if (type !== 'Pesanan') continue;
        
        const rid = String(r[63]||'').trim();
        const oid = (rid && rid !== '/' && rid !== '/\\t') ? rid : String(r[0]).trim();
        if (!oid) continue;
        
        // Store for batch update
        orderUpdates.push({
          oid,
          settlement: settlementAmt + rp(r[62]),
          platformFee: feesAmt,
          refund: rp(r[11]),
          createdAt: tm,
        });
      }
      
      // Batch update order_lines for drilldown
      const updateStmt = db.prepare(`UPDATE finance_order_lines SET source='income_statement',settlement_received=?,platform_fee=?,refund_amount=? WHERE order_id=? AND store_name=?`);
      let updatedOrders = 0;
      const updatedOids = new Set();
      for (const u of orderUpdates) {
        if (updatedOids.has(u.oid)) continue; // Only update once per order
        updatedOids.add(u.oid);
        const result = updateStmt.run(u.settlement, u.platformFee, u.refund, u.oid, STORE);
        if (result.changes > 0) updatedOrders++;
      }
      
      console.log(`  Income raw rows: ${irows.length - 1} total`);
      console.log(`  Pesanan: ${incomeCnt}, GMV: ${gmvCnt}, Penggantian: ${penggantianCnt}`);
      console.log(`  Orders updated for drilldown: ${updatedOrders}`);
    }
  }
  
  // ========== 3. IMPORT SKU HPP ==========
  console.log('\n=== IMPORTING SKU HPP ===');
  if (!fs.existsSync(SKU_FILE)) {
    console.log('  SKIP: SKU file not found:', SKU_FILE);
  } else {
    const wb = XLSX.readFile(SKU_FILE);
    const sheet = wb.Sheets['sku-template'];
    if (!sheet) { console.log('  No sku-template sheet'); }
    else {
      const rows = XLSX.utils.sheet_to_json(sheet, {defval: ''});
      let skuCnt = 0;
      for (const r of rows) {
        const sku = String(r.sku||'').trim();
        const hpp = Math.abs(Number(r.hppPerUnit||0));
        if (!sku || hpp <= 0) continue;
        const key = `${STORE}|${ct(sku)}`;
        db.prepare(`INSERT OR REPLACE INTO finance_sku_costs(sku_key,store_name,sku,product_name,hpp_per_unit,packing_per_unit,updated_at) VALUES(?,?,?,?,?,?,?)`).run(
          key, STORE, sku, String(r.product_name||'').trim(), hpp, 0, now
        );
        skuCnt++;
      }
      console.log(`  SKU HPP imported: ${skuCnt} entries`);
    }
  }
  
  // ========== 4. IMPORT ADS ==========
  console.log('\n=== IMPORTING AD SPEND ===');
  const adFiles = [
    ['custombase_iklan_mei.xlsx', '2026-05'],
    ['custombase_iklan_juni.xlsx', '2026-06'],
  ];
  
  for (const [file, month] of adFiles) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) { console.log('  SKIP:', file); continue; }
    const wb = XLSX.readFile(fp, {cellDates: false, raw: true});
    const sheet = wb.Sheets['sheet1'];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, {defval: ''});
    let tuCnt = 0;
    for (const r of rows) {
      if (String(r['Transaction type']||'').trim() !== 'General') continue;
      if (String(r['Transaction subtype']||'').trim() !== 'Add balance') continue;
      if (String(r['Status']||'').trim() !== 'Success') continue;
      if (String(r['Fund type']||'').trim() !== 'Cash') continue;
      if (String(r['Description']||'').toLowerCase().includes('gmv pay')) continue;
      const spendDate = String(r['Transaction time']||'').trim().slice(0,10).replace(/\//g,'-');
      db.prepare(`INSERT OR IGNORE INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).run(
        STORE, spendDate, rp(r['Amount']), 'TikTok Top Up', 'Manual', 'Top up manual', now, now
      );
      tuCnt++;
    }
    console.log(`  ${file}: ${tuCnt} top-up transactions`);
  }
  
  // ========== VERIFICATION ==========
  console.log('\n=== VERIFICATION ===');
  
  // Income raw aggregation
  const incomeAgg = db.prepare(`SELECT transaction_type, COUNT(*) as cnt, SUM(settlement_amount) as s, SUM(total_fees) as f, SUM(refund_amount) as r FROM finance_income_raw WHERE store_name=? GROUP BY transaction_type ORDER BY transaction_type`).all(STORE);
  console.log('\nIncome Raw by Type:');
  for (const row of incomeAgg) {
    console.log(`  ${row.transaction_type}: ${row.cnt} rows, settlement=${fmt(row.s)}, fees=${fmt(row.f)}, refund=${fmt(row.r)}`);
  }
  
  // May settlement from income
  const maySettlement = db.prepare(`SELECT SUM(settlement_amount) as s, SUM(total_fees) as f FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' AND order_created_time LIKE '2026-05%'`).get(STORE);
  console.log(`\n  May Settlement Cair: ${fmt(maySettlement.s)} | Target: 8.772.345 | ${Math.round(maySettlement.s||0)===8772345?'✅':'❌'}`);
  console.log(`  May Potongan Platform: ${fmt(maySettlement.f)} | Target: 3.223.291 | ${Math.round(maySettlement.f||0)===3223291?'✅':'❌'}`);
  
  const mayGMV = db.prepare(`SELECT SUM(ABS(settlement_amount)) as s FROM finance_income_raw WHERE store_name=? AND transaction_type='Pembayaran GMV untuk Iklan TikTok' AND order_created_time LIKE '2026-05%'`).get(STORE);
  console.log(`  May Iklan GMV: ${fmt(mayGMV.s)} | Target: 1.472.709 | ${Math.round(mayGMV.s||0)===1472709?'✅':'❌'}`);
  
  const mayPenggantian = db.prepare(`SELECT SUM(settlement_amount) as s FROM finance_income_raw WHERE store_name=? AND transaction_type LIKE '%Penggantian%' AND order_created_time LIKE '2026-05%'`).get(STORE);
  console.log(`  May Penggantian: ${fmt(mayPenggantian.s)} | Target: 32.998 | ${Math.round(mayPenggantian.s||0)===32998?'✅':'❌'}`);
  
  // Ad spend
  const mayTopUp = db.prepare(`SELECT SUM(amount) as s FROM finance_ad_spend WHERE store_name=? AND channel='TikTok Top Up' AND spend_date LIKE '2026-05%'`).get(STORE);
  console.log(`\n  May Iklan Top Up: ${fmt(mayTopUp.s)} | Target: 1.665.000 | ${Math.round(mayTopUp.s||0)===1665000?'✅':'❌'}`);
  
  // Orders
  const mayOrders = db.prepare(`SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at LIKE '2026-05%' AND status='Selesai'`).get(STORE);
  const mayCV = db.prepare(`SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at LIKE '2026-05%' AND status='Dibatalkan' AND (LOWER(cancel_reason) LIKE '%gagal%' OR LOWER(cancel_reason) LIKE '%hilang%') AND (tracking_id IS NOT NULL AND tracking_id != '' OR shipped_time IS NOT NULL)`).get(STORE);
  console.log(`\n  May Orders Selesai: ${mayOrders.c} | Target: 588 | ${mayOrders.c===588?'✅':'❌'}`);
  console.log(`  May Cancel Valid: ${mayCV.c} | Target: 62 | ${mayCV.c===62?'✅':'❌'}`);
  
  console.log('\n✅ IMPORT COMPLETE — Restart server!');
  process.exit(0);
}

main().catch(e => { console.error(e.message); console.error(e.stack); process.exit(1); });
