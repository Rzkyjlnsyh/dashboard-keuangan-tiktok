// FAST BULK IMPORT - May 2026 income + ads
process.env.DATABASE_URL='postgresql://postgres:082139063266@db.oumrrmynjzxrdereljfg.supabase.co:6543/postgres';
const pg=require('../lib/pg-connector');
const XLSX=require('xlsx');const path=require('path');
function rp(v){const t=String(v||'').trim();if(!t)return 0;const n=t.replace(/[^\d,.\-]/g,'');const p=Number.parseFloat(n.replace(/,/g,''));return Number.isFinite(p)?Math.round(Math.abs(p)):0;}
function pd(v){if(!v)return'';const r=String(v).trim();const iso=r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);if(iso)return iso[1]+'-'+iso[2].padStart(2,'0')+'-'+iso[3].padStart(2,'0');return'';}

async function main(){
  await pg.initSchema();
  const STORE='custombase';const MONTH='2026-05';const now=new Date().toISOString();
  const ct=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  
  // 0. Import ORDERS first
  const owb=XLSX.readFile(path.join(__dirname,'..','data tiktok','CUSTOMBASE','custombase_semuapesanan_mei.xlsx'),{cellDates:false,raw:true});
  const orows=XLSX.utils.sheet_to_json(owb.Sheets['OrderSKUList'],{defval:''});
  let oCnt=0;
  for(const r of orows){
    const oid=String(r['Order ID']||'').trim(),sku=String(r['Seller SKU']||'').trim();
    if(!oid||!sku||oid.toLowerCase().includes('platform unique order'))continue;
    const c=pd(r['Created Time']);if(!c||!c.startsWith(MONTH))continue;
    const qty=Math.abs(parseInt(String(r['Quantity']).trim())||0);
    const up=rp(r['SKU Unit Original Price']);const varia=String(r['Variation']||'').trim();
    const key=ct(STORE)+'|'+oid+'|'+ct(sku)+'|'+ct(varia);
    await pg.pgQuery('INSERT INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,sku,product_name,variation,quantity,unit_price,gross_product,seller_discount,platform_discount,order_amount,tracking_id,package_id,cancel_reason,shipped_time,last_seen_file,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) ON CONFLICT(line_key) DO NOTHING',
      [key,oid,STORE,'tiktok_order',c,c,String(r['Order Status']).trim(),sku,String(r['Product Name']||'').trim(),varia,qty,up,rp(r['SKU Subtotal Before Discount'])||up*qty,Math.abs(rp(r['SKU Seller Discount'])),Math.abs(rp(r['SKU Platform Discount'])),rp(r['Order Amount']),String(r['Tracking ID']||'').trim(),String(r['Package ID']||'').trim(),String(r['Cancel Reason']||'').trim(),pd(r['Shipped Time'])||null,'mei.xlsx',now]);
    oCnt++;
  }
  console.log('Orders:',oCnt,'rows');
  
  // 1. FAST income update via temp table 
  const wb=XLSX.readFile(path.join(__dirname,'..','income_20260718110824(UTC+7).xlsx'),{cellFormula:false,cellStyles:false,cellDates:false});
  const sh=wb.Sheets['Detail pesanan'];const keys=Object.keys(sh).filter(k=>k&&k[0]!=='!');let mr=0;for(const k of keys){try{const c=XLSX.utils.decode_cell(k);if(c.r>mr)mr=c.r;}catch(e){}}
  sh['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:mr,c:79}});
  const rows=XLSX.utils.sheet_to_json(sh,{header:1,defval:''});
  
  const updates=new Map();
  for(let i=1;i<rows.length;i++){const r=rows[i];if(!r||!r[1])continue;const type=String(r[1]).trim(),tm=pd(r[2]);if(!tm||!tm.startsWith(MONTH))continue;
    if(type==='Pesanan'){const rid=String(r[63]||'').trim();const oid=(rid&&rid!=='/'&&rid!=='/\\t')?rid:String(r[0]).trim();if(!oid)continue;updates.set(oid,{s:rp(r[5])+rp(r[62]),f:Math.abs(rp(r[14])),r:rp(r[11])});}
  }
  
  await pg.pgQuery('CREATE TEMP TABLE IF NOT EXISTS _inc_upd(oid TEXT PRIMARY KEY, s NUMERIC, f NUMERIC, r NUMERIC)');
  const entries=[...updates.entries()];
  for(let i=0;i<entries.length;i+=200){
    const chunk=entries.slice(i,i+200);
    const vals=chunk.map((_,j)=>'($'+(j*4+1)+',$'+(j*4+2)+',$'+(j*4+3)+',$'+(j*4+4)+')').join(',');
    const params=[];for(const [oid,d] of chunk)params.push(oid,d.s,d.f,d.r);
    await pg.pgQuery('INSERT INTO _inc_upd VALUES '+vals+' ON CONFLICT(oid) DO UPDATE SET s=EXCLUDED.s,f=EXCLUDED.f,r=EXCLUDED.r',params);
  }
  await pg.pgQuery("UPDATE finance_order_lines SET source='income_statement',settlement_received=_inc_upd.s,platform_fee=_inc_upd.f,refund_amount=_inc_upd.r FROM _inc_upd WHERE finance_order_lines.order_id=_inc_upd.oid AND finance_order_lines.store_name='"+STORE+"'");
  
  const o=await pg.pgQuery("SELECT COUNT(*) as c, SUM(settlement_received) as t FROM finance_order_lines WHERE store_name='"+STORE+"' AND source='income_statement'");
  console.log('Income:',o.rows[0].c,'rows, settlement:',Math.round(o.rows[0].t||0).toLocaleString('id-ID'),Math.round(o.rows[0].t||0)===8772345?'✅':'❌');

  // 2. GMV ads
  let gmv=0;
  for(let i=1;i<rows.length;i++){const r=rows[i];if(!r||!r[1])continue;const type=String(r[1]).trim(),tm=pd(r[2]);if(!tm||!tm.startsWith(MONTH))continue;
    if(type.toLowerCase().includes('gmv')){await pg.pgQuery('INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[STORE,tm,Math.abs(rp(r[5])),'TikTok GMV Ads',type,'golden',now,now]);gmv++;}
  }
  
  // 3. TopUp ads
  const awb=XLSX.readFile(path.join(__dirname,'..','data tiktok','CUSTOMBASE','custombase_iklan_mei.xlsx'),{cellDates:false,raw:true});let tu=0;
  for(const r of XLSX.utils.sheet_to_json(awb.Sheets['sheet1'],{defval:''})){
    if(String(r['Transaction type']||'').trim()!=='General')continue;
    if(String(r['Transaction subtype']||'').trim()!=='Add balance')continue;
    if(String(r['Status']||'').trim()!=='Success')continue;
    if(String(r['Fund type']||'').trim()!=='Cash')continue;
    if(String(r['Description']||'').toLowerCase().includes('gmv pay'))continue;
    await pg.pgQuery('INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[STORE,String(r['Transaction time']||'').trim().slice(0,10),rp(r['Amount']),'TikTok Top Up','Manual','Top up',now,now]);tu++;
  }

  const a=await pg.pgQuery("SELECT SUM(amount) as t FROM finance_ad_spend WHERE store_name='"+STORE+"' AND channel='TikTok GMV Ads'");
  const t=await pg.pgQuery("SELECT SUM(amount) as t FROM finance_ad_spend WHERE store_name='"+STORE+"' AND channel='TikTok Top Up'");
  const fmt=n=>Math.round(n||0).toLocaleString('id-ID');
  console.log('GMV:',fmt(a.rows[0].t),Math.round(a.rows[0].t||0)===1472709?'✅':'❌');
  console.log('TopUp:',fmt(t.rows[0].t),Math.round(t.rows[0].t||0)===1665000?'✅':'❌');
  console.log('\n✅ DONE! Restart server: node server.js');
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
