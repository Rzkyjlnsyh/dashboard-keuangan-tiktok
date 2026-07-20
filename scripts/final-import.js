// FINAL IMPORT - Mei 2026 CUSTOMBASE
// Run: node scripts/final-import.js
process.env.DATABASE_URL='postgresql://postgres:082139063266@db.oumrrmynjzxrdereljfg.supabase.co:6543/postgres';
const pg=require('../lib/pg-connector');
const XLSX=require('xlsx');const path=require('path');
const ct=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
function rp(v){const t=String(v||'').trim();if(!t)return 0;const n=t.replace(/[^\d,.\-]/g,'');const p=Number.parseFloat(n.replace(/,/g,''));return Number.isFinite(p)?Math.round(Math.abs(p)):0;}
function pd(v){if(!v)return'';const r=String(v).trim();const iso=r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);if(iso)return iso[1]+'-'+iso[2].padStart(2,'0')+'-'+iso[3].padStart(2,'0');const s=r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(s)return(s[3].length===2?'20'+s[3]:s[3])+'-'+s[2].padStart(2,'0')+'-'+s[1].padStart(2,'0');return'';}
const DATA=p=>path.join(__dirname,'..','data tiktok','CUSTOMBASE',p);
const STORE='custombase';const MONTH='2026-05';const now=new Date().toISOString();

function field(row,...names){for(const n of names)if(row[n]!==undefined)return row[n];return'';}

async function main(){
  await pg.initSchema();
  
  // DELETE all custombase data
  await pg.pgQuery("DELETE FROM finance_order_lines WHERE store_name='"+STORE+"'");
  await pg.pgQuery("DELETE FROM finance_ad_spend WHERE store_name='"+STORE+"'");
  console.log('Cleaned');
  
  // 1. IMPORT ORDERS
  const owb=XLSX.readFile(DATA('custombase_semuapesanan_mei.xlsx'),{cellDates:false,raw:true});
  const orows=XLSX.utils.sheet_to_json(owb.Sheets['OrderSKUList'],{defval:''});
  let oc=0;
  for(const r of orows){
    const oid=String(field(r,'Order ID')).trim();
    const sku=String(field(r,'Seller SKU')).trim();
    if(!oid||!sku||oid.toLowerCase().includes('platform unique order'))continue;
    const dt=pd(field(r,'Created Time'));if(!dt||!dt.startsWith(MONTH))continue;
    const qty=Math.abs(parseInt(String(field(r,'Quantity')).trim())||0);
    const up=rp(field(r,'SKU Unit Original Price'));
    const varia=String(field(r,'Variation')).trim();
    const lk=ct(STORE)+'|'+oid+'|'+ct(sku)+'|'+ct(varia);
    await pg.pgQuery(
      'INSERT INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,sku,product_name,variation,quantity,unit_price,gross_product,seller_discount,platform_discount,order_amount,tracking_id,package_id,cancel_reason,shipped_time,last_seen_file,last_seen_at) VALUES('+
      ['$1','$2','$3','$4','$5','$6','$7','$8','$9','$10','$11','$12','$13','$14','$15','$16','$17','$18','$19','$20','$21','$22'].join(',')+
      ') ON CONFLICT(line_key) DO NOTHING',
      [lk,oid,STORE,'tiktok_order',dt,dt,String(field(r,'Order Status')).trim(),sku,String(field(r,'Product Name')).trim(),varia,qty,up,rp(field(r,'SKU Subtotal Before Discount'))||up*qty,Math.abs(rp(field(r,'SKU Seller Discount'))),Math.abs(rp(field(r,'SKU Platform Discount'))),rp(field(r,'Order Amount')),String(field(r,'Tracking ID')).trim(),String(field(r,'Package ID')).trim(),String(field(r,'Cancel Reason')).trim(),pd(field(r,'Shipped Time'))||null,'mei.xlsx',now]
    );
    oc++;if(oc%200===0)console.log('Orders:',oc);
  }
  console.log('Orders:',oc,'rows');

  // 2. IMPORT INCOME (golden test file, May only)
  const iwb=XLSX.readFile(path.join(__dirname,'..','income_20260718110824(UTC+7).xlsx'),{cellFormula:false,cellStyles:false,cellDates:false});
  const ish=iwb.Sheets['Detail pesanan'];const ikeys=Object.keys(ish).filter(k=>k&&k[0]!=='!');let imr=0;for(const k of ikeys){try{const c=XLSX.utils.decode_cell(k);if(c.r>imr)imr=c.r;}catch(e){}}
  ish['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:imr,c:79}});
  const irows=XLSX.utils.sheet_to_json(ish,{header:1,defval:''});
  let ic=0,gc=0;
  for(let i=1;i<irows.length;i++){const r=irows[i];if(!r||!r[1])continue;const type=String(r[1]).trim(),tm=pd(r[2]);if(!tm||!tm.startsWith(MONTH))continue;
    if(type.toLowerCase().includes('gmv')){
      await pg.pgQuery('INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[STORE,tm,Math.abs(rp(r[5])),'TikTok GMV Ads',type,'golden',now,now]);
      gc++;continue;
    }
    if(type.includes('Penggantian'))continue;if(type!=='Pesanan')continue;
    const rid=String(r[63]||'').trim();const oid=(rid&&rid!=='/'&&rid!=='/\\t')?rid:String(r[0]).trim();if(!oid)continue;
    await pg.pgQuery('UPDATE finance_order_lines SET source=$1,settlement_received=$2,platform_fee=$3,refund_amount=$4 WHERE order_id=$5 AND store_name=$6',['income_statement',rp(r[5])+rp(r[62]),Math.abs(rp(r[14])),rp(r[11]),oid,STORE]);
    ic++;if(ic%200===0)console.log('Income:',ic);
  }
  console.log('Income:',ic,'orders, GMV:',gc);

  // 3. IMPORT TOP-UP ADS
  const awb=XLSX.readFile(DATA('custombase_iklan_mei.xlsx'),{cellDates:false,raw:true});
  let tc=0;
  for(const r of XLSX.utils.sheet_to_json(awb.Sheets['sheet1'],{defval:''})){
    if(String(field(r,'Transaction type')).trim()!=='General')continue;
    if(String(field(r,'Transaction subtype')).trim()!=='Add balance')continue;
    if(String(field(r,'Status')).trim()!=='Success')continue;
    if(String(field(r,'Fund type')).trim()!=='Cash')continue;
    if(String(field(r,'Description')).toLowerCase().includes('gmv pay'))continue;
    await pg.pgQuery('INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[STORE,String(field(r,'Transaction time')).trim().slice(0,10),rp(field(r,'Amount')),'TikTok Top Up','Manual','Top up',now,now]);
    tc++;
  }
  console.log('TopUp:',tc);

  // VERIFY
  const o=await pg.pgQuery("SELECT COUNT(*) as c, SUM(settlement_received) as t FROM finance_order_lines WHERE store_name='"+STORE+"' AND source='income_statement'");
  const a=await pg.pgQuery("SELECT SUM(amount) as t FROM finance_ad_spend WHERE store_name='"+STORE+"' AND channel='TikTok GMV Ads'");
  const t=await pg.pgQuery("SELECT SUM(amount) as t FROM finance_ad_spend WHERE store_name='"+STORE+"' AND channel='TikTok Top Up'");
  const fmt=n=>Math.round(n||0).toLocaleString('id-ID');
  console.log('\n=== VERIFICATION ===');
  console.log('Settlement:',fmt(o.rows[0].t),'| Target 8.772.345 |',Math.round(o.rows[0].t||0)===8772345?'✅':'❌');
  console.log('GMV:',fmt(a.rows[0].t),'| Target 1.472.709 |',Math.round(a.rows[0].t||0)===1472709?'✅':'❌');
  console.log('TopUp:',fmt(t.rows[0].t),'| Target 1.665.000 |',Math.round(t.rows[0].t||0)===1665000?'✅':'❌');
  console.log('\n✅ DONE! Run: node server.js');
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
