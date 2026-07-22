// Import data ke Supabase langsung (production)
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.oumrrmynjzxrdereljfg:082139063266@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const STORE = 'custombase';
const now = new Date().toISOString();

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
  if(s) return(s[3].length===2?'20'+s[3]:s[3])+'-'+s[2].padStart(2,'0')+'-'+s[1].padStart(2,'0');
  return '';
}
const fmt = n => Math.round(n||0).toLocaleString('id-ID');

async function main() {
  // Clear all custombase data
  for (const t of ['finance_income_raw','finance_ad_spend','finance_order_lines','finance_sku_costs']) {
    await pool.query(`DELETE FROM "${t}" WHERE store_name=$1`, [STORE]);
  }
  console.log('Cleared all data for', STORE);
  
  // Import orders
  const XLSX = require('xlsx');
  const path = require('path');
  const DATA = path.join(__dirname,'..','data tiktok','CUSTOMBASE');
  
  for (const [file, month] of [['custombase_semuapesanan_mei.xlsx','2026-05'],['custombase_semuapesanan_juni.xlsx','2026-06']]) {
    const fp = path.join(DATA, file);
    const wb = XLSX.readFile(fp, {cellDates: false, raw: true});
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['OrderSKUList'], {defval: ''});
    let cnt = 0;
    for (const r of rows) {
      const oid = String(r['Order ID']||'').trim(), sku = String(r['Seller SKU']||'').trim();
      if (!oid || !sku || oid.toLowerCase().includes('platform unique')) continue;
      const c = pd(r['Created Time']); if (!c || !c.startsWith(month)) continue;
      const qty = Math.abs(parseInt(String(r['Quantity']).trim())||0);
      const key = ct(STORE)+'|'+oid+'|'+ct(sku)+'|'+ct(String(r['Variation']||'').trim());
      await pool.query(`INSERT INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,sku,product_name,variation,quantity,unit_price,gross_product,seller_discount,platform_discount,order_amount,tracking_id,package_id,cancel_reason,shipped_time,last_seen_file,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) ON CONFLICT(line_key) DO NOTHING`,
        [key,oid,STORE,'tiktok_order',c,c,String(r['Order Status']).trim(),sku,String(r['Product Name']||'').trim(),String(r['Variation']||'').trim(),qty,rp(r['SKU Unit Original Price']),rp(r['SKU Subtotal Before Discount'])||rp(r['SKU Unit Original Price'])*qty,Math.abs(rp(r['SKU Seller Discount'])),Math.abs(rp(r['SKU Platform Discount'])),rp(r['Order Amount']),String(r['Tracking ID']||'').trim(),String(r['Package ID']||'').trim(),String(r['Cancel Reason']||'').trim(),pd(r['Shipped Time'])||null,file,now]);
      cnt++;
      if (cnt % 500 === 0) console.log('  '+file+': '+cnt+' rows...');
    }
    console.log('  '+file+': '+cnt+' rows');
  }
  
  // Import income (with SIGN preservation!)
  console.log('\nImporting income...');
  const incomePath = path.join(__dirname,'..','income_20260718110824(UTC+7).xlsx');
  const iwb = XLSX.readFile(incomePath, {cellFormula: false, cellStyles: false, cellDates: false});
  const sh = iwb.Sheets['Detail pesanan'];
  const keys = Object.keys(sh).filter(k => k && k[0] !== '!');
  let maxRow = 0;
  for (const k of keys) { try { const c = XLSX.utils.decode_cell(k); if(c.r > maxRow) maxRow = c.r; } catch(e) {} }
  sh['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:maxRow, c:79}});
  const irows = XLSX.utils.sheet_to_json(sh, {header:1, defval: ''});
  
  let incCnt = 0, gmvCnt = 0;
  for (let i = 1; i < irows.length; i++) {
    const r = irows[i]; if (!r || !r[1]) continue;
    const type = String(r[1]).trim(), tm = pd(r[2]); if (!tm) continue;
    const settlement = rp(r[5]), fees = Math.abs(rp(r[14])), refund = rp(r[11]);
    await pool.query(`INSERT INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [STORE, type, String(r[0]).trim(), tm, settlement, fees, refund, 0, now]);
    if (type === 'Pesanan') incCnt++; else if (type.includes('GMV')) gmvCnt++;
  }
  console.log('  Pesanan: '+incCnt+', GMV: '+gmvCnt);
  
  // Import SKU HPP
  console.log('\nImporting SKU HPP...');
  const swb = XLSX.readFile(path.join(__dirname,'..','sku-template.xlsx'));
  const srows = XLSX.utils.sheet_to_json(swb.Sheets['sku-template'], {defval: ''});
  let skuCnt = 0;
  for (const r of srows) {
    const sku = String(r.sku||'').trim(), hpp = Math.abs(Number(r.hppPerUnit||0));
    if (!sku || hpp <= 0) continue;
    await pool.query(`INSERT INTO finance_sku_costs(sku_key,store_name,sku,product_name,hpp_per_unit,packing_per_unit,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(sku_key) DO UPDATE SET hpp_per_unit=$5`,
      [STORE+'|'+ct(sku), STORE, sku, String(r.product_name||'').trim(), hpp, 0, now]);
    skuCnt++;
  }
  console.log('  SKU: '+skuCnt+' entries');
  
  // Import Ads
  console.log('\nImporting ads...');
  for (const [file, month] of [['custombase_iklan_mei.xlsx','2026-05'],['custombase_iklan_juni.xlsx','2026-06']]) {
    const fp = path.join(DATA, file);
    if (!require('fs').existsSync(fp)) continue;
    const awb = XLSX.readFile(fp, {cellDates: false, raw: true});
    const arows = XLSX.utils.sheet_to_json(awb.Sheets['sheet1'], {defval: ''});
    let tu = 0;
    for (const r of arows) {
      if (String(r['Transaction type']||'').trim() !== 'General') continue;
      if (String(r['Transaction subtype']||'').trim() !== 'Add balance') continue;
      if (String(r['Status']||'').trim() !== 'Success') continue;
      if (String(r['Fund type']||'').trim() !== 'Cash') continue;
      if (String(r['Description']||'').toLowerCase().includes('gmv pay')) continue;
      const sd = String(r['Transaction time']||'').trim().slice(0,10).replace(/\//g,'-');
      await pool.query(`INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [STORE, sd, rp(r['Amount']), 'TikTok Top Up', 'Manual', 'Top up', now, now]);
      tu++;
    }
    console.log('  '+file+': '+tu+' top-up');
  }
  
  // Verify
  const mayS = await pool.query("SELECT SUM(settlement_amount) as s, SUM(total_fees) as f FROM finance_income_raw WHERE store_name=$1 AND transaction_type='Pesanan' AND order_created_time LIKE '2026-05%'", [STORE]);
  console.log('\nMay Settlement:', fmt(mayS.rows[0].s), '| Target 8.772.345 |', Math.round(mayS.rows[0].s||0)===8772345?'✅':'❌');
  console.log('May Platform:', fmt(mayS.rows[0].f), '| Target 3.223.291 |', Math.round(mayS.rows[0].f||0)===3223291?'✅':'❌');
  
  await pool.end();
  console.log('\n✅ DONE - Refresh Vercel dashboard!');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
