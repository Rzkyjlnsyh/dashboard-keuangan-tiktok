// CLEAN IMPORT - May 2026 CUSTOMBASE only
process.env.DATABASE_URL='postgresql://postgres:082139063266@db.oumrrmynjzxrdereljfg.supabase.co:6543/postgres';
const pg=require('../lib/pg-connector');
const fs=require('fs');const XLSX=require('xlsx');const path=require('path');
const ct=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
function rp(v){const t=String(v||'').trim();if(!t)return 0;const n=t.replace(/[^\d,.\-]/g,'');const p=Number.parseFloat(n.replace(/,/g,''));return Number.isFinite(p)?Math.round(Math.abs(p)):0;}
function pd(v){if(!v)return'';const r=String(v).trim();const iso=r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);if(iso)return iso[1]+'-'+iso[2].padStart(2,'0')+'-'+iso[3].padStart(2,'0');const s=r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(s)return(s[3].length===2?'20'+s[3]:s[3])+'-'+s[2].padStart(2,'0')+'-'+s[1].padStart(2,'0');return'';}
const DATA=path.join(__dirname,'..','data tiktok','CUSTOMBASE');
const STORE='custombase';const MONTH='2026-05';const now=new Date().toISOString();

async function main(){
  await pg.initSchema();
  
  // 1. Import May orders
  const owb=XLSX.readFile(path.join(DATA,'custombase_semuapesanan_mei.xlsx'),{cellDates:false,raw:true});
  const orows=XLSX.utils.sheet_to_json(owb.Sheets['OrderSKUList'],{defval:''});
  let oCnt=0;
  for(const r of orows){
    const oid=String(r['Order ID']||'').trim(),sku=String(r['Seller SKU']||'').trim();
    if(!oid||!sku||oid.toLowerCase().includes('platform unique order'))continue;
    const c=pd(r['Created Time']);if(!c||!c.startsWith(MONTH))continue;
    const qty=Math.abs(parseInt(String(r['Quantity']).trim())||0);
    const up=rp(r['SKU Unit Original Price']);const varia=String(r['Variation']||'').trim();
    const key=ct(STORE)+'|'+oid+'|'+ct(sku)+'|'+ct(varia);
    await pg.pgQuery(`INSERT INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,sku,product_name,variation,quantity,unit_price,gross_product,seller_discount,platform_discount,order_amount,tracking_id,package_id,cancel_reason,shipped_time,last_seen_file,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) ON CONFLICT(line_key) DO NOTHING`,
      [key,oid,STORE,'tiktok_order',c,c,String(r['Order Status']).trim(),sku,String(r['Product Name']||'').trim(),varia,qty,up,rp(r['SKU Subtotal Before Discount'])||up*qty,Math.abs(rp(r['SKU Seller Discount'])),Math.abs(rp(r['SKU Platform Discount'])),rp(r['Order Amount']),String(r['Tracking ID']||'').trim(),String(r['Package ID']||'').trim(),String(r['Cancel Reason']||'').trim(),pd(r['Shipped Time'])||null,'custombase_semuapesanan_mei.xlsx',now]);
    oCnt++;
  }
  console.log('Orders:',oCnt,'rows');

  // 2. Import income for May ONLY (filter by Waktu pemesanan = May)
  const iwb=XLSX.readFile(path.join(__dirname,'..','income_20260718110824(UTC+7).xlsx'),{cellFormula:false,cellStyles:false,cellDates:false});
  const ish=iwb.Sheets['Detail pesanan'];const ikeys=Object.keys(ish).filter(k=>k&&k[0]!=='!');let imr=0;for(const k of ikeys){try{const c=XLSX.utils.decode_cell(k);if(c.r>imr)imr=c.r;}catch(e){}}
  ish['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:imr,c:79}});
  const irows=XLSX.utils.sheet_to_json(ish,{header:1,defval:''});
  let iCnt=0,gmv=0;
  for(let i=1;i<irows.length;i++){const r=irows[i];if(!r||!r[1])continue;const type=String(r[1]).trim(),tm=pd(r[2]);if(!tm||!tm.startsWith(MONTH))continue; // ONLY MAY
    if(type.toLowerCase().includes('gmv')){await pg.pgQuery('INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[STORE,tm,Math.abs(rp(r[5])),'TikTok GMV Ads',type,'golden',now,now]);gmv++;continue;}
    if(type.includes('Penggantian'))continue;if(type!=='Pesanan')continue;
    const rid=String(r[63]||'').trim();const oid=(rid&&rid!=='/'&&rid!=='/\\t')?rid:String(r[0]).trim();if(!oid)continue;
    await pg.pgQuery('UPDATE finance_order_lines SET source=$1,settlement_received=$2,platform_fee=$3,refund_amount=$4 WHERE order_id=$5 AND store_name=$6',['income_statement',rp(r[5])+rp(r[62]),Math.abs(rp(r[14])),rp(r[11]),oid,STORE]);
    iCnt++;
  }
  console.log('Income:',iCnt,'orders, GMV:',gmv);

  // 3. Import top-up ads
  const awb=XLSX.readFile(path.join(DATA,'custombase_iklan_mei.xlsx'),{cellDates:false,raw:true});
  let tu=0;
  for(const r of XLSX.utils.sheet_to_json(awb.Sheets['sheet1'],{defval:''})){
    if(String(r['Transaction type']||'').trim()!=='General')continue;
    if(String(r['Transaction subtype']||'').trim()!=='Add balance')continue;
    if(String(r['Status']||'').trim()!=='Success')continue;
    if(String(r['Fund type']||'').trim()!=='Cash')continue;
    if(String(r['Description']||'').toLowerCase().includes('gmv pay'))continue;
    await pg.pgQuery('INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[STORE,String(r['Transaction time']||'').trim().slice(0,10),rp(r['Amount']),'TikTok Top Up','Manual','Top up',now,now]);
    tu++;
  }
  console.log('TopUp:',tu);

  const o=await pg.pgQuery('SELECT SUM(settlement_received) as t FROM finance_order_lines WHERE store_name=$1 AND source=$2',[STORE,'income_statement']);
  const a=await pg.pgQuery('SELECT SUM(amount) as t FROM finance_ad_spend WHERE store_name=$1 AND channel=$2',[STORE,'TikTok GMV Ads']);
  const t=await pg.pgQuery('SELECT SUM(amount) as t FROM finance_ad_spend WHERE store_name=$1 AND channel=$2',[STORE,'TikTok Top Up']);
  const fmt=n=>Math.round(n||0).toLocaleString();
  console.log('\nSettlement:',fmt(o.rows[0].t),'| Target 8.772.345 |',Math.round(o.rows[0].t||0)===8772345?'✅':'❌');
  console.log('GMV:',fmt(a.rows[0].t),'| Target 1.472.709 |',Math.round(a.rows[0].t||0)===1472709?'✅':'❌');
  console.log('TopUp:',fmt(t.rows[0].t),'| Target 1.665.000 |',Math.round(t.rows[0].t||0)===1665000?'✅':'❌');
  console.log('DONE - Restart server!');
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
