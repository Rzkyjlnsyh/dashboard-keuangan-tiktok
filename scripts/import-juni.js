/**
 * IMPORT JUNI ACCRUAL — Custombase Juni 2026
 * Menggabungkan multiple income files untuk coverage lengkap
 * 
 * Usage: node scripts/import-juni.js
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

const STORE = 'custombase';
const DATA_DIR = path.join(__dirname,'..','data tiktok','CUSTOMBASE');
const INCOME_FILES = [
  path.join(__dirname,'..','income_20260718110824(UTC+7).xlsx'),
  path.join(__dirname,'..','penarikan-dana-1april-29juni.xlsx'),
  path.join(__dirname,'..','penarikan-dana-30juni-18juli.xlsx'),
];
const now = new Date().toISOString();
const fmt = n => Math.round(n||0).toLocaleString('id-ID');

async function importIncomeFile(db, filepath) {
  if (!fs.existsSync(filepath)) { console.log('  SKIP (not found):', path.basename(filepath)); return 0; }
  const wb = XLSX.readFile(filepath, {cellFormula: false, cellStyles: false, cellDates: false});
  const sheet = wb.Sheets['Detail pesanan'];
  if (!sheet) { console.log('  No Detail pesanan sheet'); return 0; }
  
  const ikeys = Object.keys(sheet).filter(k => k && k[0] !== '!');
  let maxRow = 0;
  for (const k of ikeys) { try { const c = XLSX.utils.decode_cell(k); if(c.r > maxRow) maxRow = c.r; } catch(e) {} }
  sheet['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:maxRow, c:79}});
  const irows = XLSX.utils.sheet_to_json(sheet, {header:1, defval:''});
  
  let count = 0;
  for (let i = 1; i < irows.length; i++) {
    const r = irows[i]; if (!r || !r[1]) continue;
    const type = String(r[1]).trim(); const tm = pd(r[2]); if (!tm) continue;
    
    const settlementAmt = rp(r[5]);
    const feesAmt = Math.abs(rp(r[14]));
    const refundAmt = rp(r[11]);
    
    db.prepare(`INSERT OR REPLACE INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      STORE, type, String(r[0]).trim(), tm, settlementAmt, feesAmt, refundAmt, 0, now
    );
    count++;
  }
  console.log('  '+path.basename(filepath)+': '+count+' rows');
  return count;
}

async function main() {
  await pg.initSchema();
  const db = pg.getDb();
  
  // Hanya clear income_raw (order_lines tetap)
  db.prepare("DELETE FROM finance_income_raw WHERE store_name=?").run(STORE);
  console.log('Cleared income_raw for', STORE);
  
  // Import all income files
  console.log('\n=== IMPORTING INCOME STATEMENTS ===');
  let total = 0;
  for (const fp of INCOME_FILES) {
    total += await importIncomeFile(db, fp);
  }
  console.log('Total income rows:', total);
  
  // Update order_lines for drilldown (match by order_id from income)
  const incomeRows = db.prepare("SELECT DISTINCT order_id, SUM(settlement_amount) as s, SUM(total_fees) as f, SUM(refund_amount) as r FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' GROUP BY order_id").all(STORE);
  const updateStmt = db.prepare("UPDATE finance_order_lines SET source='income_statement', settlement_received=?, platform_fee=?, refund_amount=? WHERE order_id=? AND store_name=?");
  const updatedOids = new Set();
  for (const ir of incomeRows) {
    if (updatedOids.has(ir.order_id)) continue;
    updatedOids.add(ir.order_id);
    updateStmt.run(ir.s, ir.f, ir.r, ir.order_id, STORE);
  }
  console.log('Orders updated for drilldown:', updatedOids.size);
  
  // VERIFICATION
  console.log('\n=== VERIFICATION ===');
  
  // June accrual aggregates
  const juneSettlement = db.prepare("SELECT SUM(settlement_amount) as s, SUM(total_fees) as f FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' AND order_created_time LIKE '2026-06%'").get(STORE);
  const juneGMV = db.prepare("SELECT SUM(ABS(settlement_amount)) as s FROM finance_income_raw WHERE store_name=? AND transaction_type='Pembayaran GMV untuk Iklan TikTok' AND order_created_time LIKE '2026-06%'").get(STORE);
  const junePenggantian = db.prepare("SELECT SUM(settlement_amount) as s FROM finance_income_raw WHERE store_name=? AND transaction_type LIKE '%Penggantian%' AND order_created_time LIKE '2026-06%'").get(STORE);
  
  // Also check income rows with no settlement (Dikirim, piutang) - these are "estimated" platform fees
  const juneSettle0 = db.prepare("SELECT COUNT(*) as c, SUM(total_fees) as f, SUM(settlement_amount) as s FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' AND order_created_time LIKE '2026-06%' AND settlement_amount = 0").get(STORE);
  const juneSettleNon0 = db.prepare("SELECT COUNT(*) as c, SUM(total_fees) as f, SUM(settlement_amount) as s FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' AND order_created_time LIKE '2026-06%' AND settlement_amount != 0").get(STORE);
  
  console.log('June Pesanan settled (>0):', juneSettleNon0.c, 'rows, settlement='+fmt(juneSettleNon0.s), 'fees='+fmt(juneSettleNon0.f));
  console.log('June Pesanan piutang (0):', juneSettle0.c, 'rows, fees='+fmt(juneSettle0.f));
  console.log('');
  console.log('June Settlement Cair:', fmt(juneSettlement.s), '| Expected 5.026.837 (real settled)');
  console.log('June Potongan Real:', fmt(juneSettleNon0.f), '| Expected 5.026.837');
  console.log('June Potongan Est:', fmt(juneSettle0.f), '| Expected 3.638.913');
  console.log('June Iklan GMV:', fmt(juneGMV.s), '| Expected 6.625.056');
  console.log('June Penggantian:', fmt(junePenggantian.s), '| Expected 56.100');
  
  console.log('\n✅ IMPORT COMPLETE');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
