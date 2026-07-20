// SIMPLE SQLITE IMPORT - May 2026 Custombase
const pg=require('../lib/pg-connector');
const XLSX=require('xlsx');const path=require('path');const ct=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
function rp(v){const t=String(v||'').trim();if(!t)return 0;const n=t.replace(/[^\d,.\-]/g,'');const p=Number.parseFloat(n.replace(/,/g,''));return Number.isFinite(p)?Math.round(Math.abs(p)):0;}
function pd(v){if(!v)return'';const r=String(v).trim();const iso=r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);if(iso)return iso[1]+'-'+iso[2].padStart(2,'0')+'-'+iso[3].padStart(2,'0');const s=r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(s)return(s[3].length===2?'20'+s[3]:s[3])+'-'+s[2].padStart(2,'0')+'-'+s[1].padStart(2,'0');return'';}
const DATA=p=>path.join(__dirname,'..','data tiktok','CUSTOMBASE',p);
const STORE='custombase';const MONTH='2026-05';

async function main(){
  await pg.initSchema();
  const now=new Date().toISOString();
  console.log('Importing...');

  // 1. Orders
  const owb=XLSX.readFile(DATA('custombase_semuapesanan_mei.xlsx'),{cellDates:false,raw:true});
  const orows=XLSX.utils.sheet_to_json(owb.Sheets['OrderSKUList'],{defval:''});
  let oc=0;
  const insertOrd=pg.pgQuery; // shorthand
  for(const r of orows){
    const oid=String(r['Order ID']||'').trim(),sku=String(r['Seller SKU']||'').trim();
    if(!oid||!sku||oid.toLowerCase().includes('platform unique order'))continue;
    const dt=pd(r['Created Time']);if(!dt||!dt.startsWith(MONTH))continue;
    const q=Math.abs(parseInt(String(r['Quantity']).trim())||0),up=rp(r['SKU Unit Original Price']);
    const v=String(r['Variation']||'').trim();
    const lk=ct(STORE)+'|'+oid+'|'+ct(sku)+'|'+ct(v);
    await insertOrd(`INSERT OR IGNORE INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,sku,product_name,variation,quantity,unit_price,gross_product,seller_discount,platform_discount,order_amount,tracking_id,package_id,cancel_reason,shipped_time,last_seen_file,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [lk,oid,STORE,'tiktok_order',dt,dt,String(r['Order Status']).trim(),sku,String(r['Product Name']||'').trim(),v,q,up,rp(r['SKU Subtotal Before Discount'])||up*q,Math.abs(rp(r['SKU Seller Discount'])),Math.abs(rp(r['SKU Platform Discount'])),rp(r['Order Amount']),String(r['Tracking ID']||'').trim(),String(r['Package ID']||'').trim(),String(r['Cancel Reason']||'').trim(),pd(r['Shipped Time'])||null,'mei.xlsx',now]);
    oc++;if(oc%200===0)console.log('Orders:',oc);
  }
  console.log('Orders:',oc);

  // 2. Income (SUM per order, May only)
  const iwb=XLSX.readFile(path.join(__dirname,'..','income_20260718110824(UTC+7).xlsx'),{cellFormula:false,cellStyles:false,cellDates:false});
  const ish=iwb.Sheets['Detail pesanan'];const ikeys=Object.keys(ish).filter(k=>k&&k[0]!=='!');let imr=0;for(const k of ikeys){try{const c=XLSX.utils.decode_cell(k);if(c.r>imr)imr=c.r;}catch(e){}}
  ish['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:imr,c:79}});
  const irows=XLSX.utils.sheet_to_json(ish,{header:1,defval:''});
  const incAgg=new Map();
  for(let i=1;i<irows.length;i++){const r=irows[i];if(!r||!r[1])continue;const type=String(r[1]).trim(),tm=pd(r[2]);if(!tm||!tm.startsWith(MONTH))continue;
    if(type.toLowerCase().includes('gmv')){
      await insertOrd('INSERT OR IGNORE INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[STORE,tm,Math.abs(rp(r[5])),'TikTok GMV Ads',type,'golden',now,now]);
      continue;
    }
    if(type.includes('Penggantian'))continue;if(type!=='Pesanan')continue;
    const rid=String(r[63]||'').trim();const oid=(rid&&rid!=='/'&&rid!=='/\\t')?rid:String(r[0]).trim();if(!oid)continue;
    if(!incAgg.has(oid))incAgg.set(oid,{s:0,f:0,r:0});
    const a=incAgg.get(oid);a.s+=rp(r[5])+rp(r[62]);a.f+=Math.abs(rp(r[14]));a.r+=rp(r[11]);
  }
  let ic=0;
  for(const [oid,d] of incAgg){
    await insertOrd('UPDATE finance_order_lines SET source=?,settlement_received=?,platform_fee=?,refund_amount=? WHERE order_id=? AND store_name=? AND created_at LIKE ?',['income_statement',d.s,d.f,d.r,oid,STORE,'2026-05-%']);
    ic++;if(ic%200===0)console.log('Income:',ic);
  }
  console.log('Income:',ic);

  // 3. TopUp ads
  const awb=XLSX.readFile(DATA('custombase_iklan_mei.xlsx'),{cellDates:false,raw:true});
  let tu=0;
  for(const r of XLSX.utils.sheet_to_json(awb.Sheets['sheet1'],{defval:''})){
    if(String(r['Transaction type']||'').trim()!=='General')continue;
    if(String(r['Transaction subtype']||'').trim()!=='Add balance')continue;
    if(String(r['Status']||'').trim()!=='Success')continue;
    if(String(r['Fund type']||'').trim()!=='Cash')continue;
    if(String(r['Description']||'').toLowerCase().includes('gmv pay'))continue;
    await insertOrd('INSERT OR IGNORE INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[STORE,String(r['Transaction time']||'').trim().slice(0,10).replace(///g,'-'),rp(r['Amount']),'TikTok Top Up','Manual','Top up',now,now]);
    tu++;
  }
  console.log('TopUp:',tu);

  // 4. SKU HPP
  const swb=XLSX.readFile(path.join(__dirname,'..','sku-template.xlsx'));
  const srows=XLSX.utils.sheet_to_json(swb.Sheets['sku-template'],{defval:''});
  let sc=0;
  for(const r of srows){const sku=String(r.sku||'').trim();const hpp=Math.abs(Number(r.hppPerUnit||0));if(!sku||hpp<=0)continue;
    await insertOrd('INSERT OR IGNORE INTO finance_sku_costs(sku_key,store_name,sku,hpp_per_unit,packing_per_unit,updated_at) VALUES(?,?,?,?,?,?)',['global|'+ct(sku),'global',sku,hpp,Math.abs(Number(r.packingPerUnit||0)),now]);
    sc++;
  }
  console.log('SKU:',sc);

  // VERIFY
  const fmt=n=>Math.round(n||0).toLocaleString('id-ID');
  const o=await pg.pgQuery("SELECT COUNT(*) as c, SUM(settlement_received) as t FROM finance_order_lines WHERE store_name=? AND source=?",[STORE,'income_statement']);
  const a=await pg.pgQuery("SELECT SUM(amount) as t FROM finance_ad_spend WHERE store_name=? AND channel=?",[STORE,'TikTok GMV Ads']);
  const t=await pg.pgQuery("SELECT SUM(amount) as t FROM finance_ad_spend WHERE store_name=? AND channel=?",[STORE,'TikTok Top Up']);
  console.log('\nSettlement:',fmt(o.rows[0].t),'| Target 8.772.345 |',Math.round(o.rows[0].t||0)===8772345?'✅':'❌');
  console.log('GMV:',fmt(a.rows[0].t),'| Target 1.472.709 |',Math.round(a.rows[0].t||0)===1472709?'✅':'❌');
  console.log('TopUp:',fmt(t.rows[0].t),'| Target 1.665.000 |',Math.round(t.rows[0].t||0)===1665000?'✅':'❌');
  console.log('\n✅ Run: node server.js');
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
