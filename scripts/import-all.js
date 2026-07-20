// Import ALL data CUSTOMBASE Mei + Juni to Supabase
const pg=require('../lib/pg-connector');
const fs=require('fs');
const path=require('path');
const XLSX=require('xlsx');
const ct=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
process.env.DATABASE_URL='postgresql://postgres:082139063266@db.oumrrmynjzxrdereljfg.supabase.co:6543/postgres';

function rp(v){const t=String(v||'').trim();if(!t)return 0;const n=t.replace(/[^\d,.\-]/g,'');const p=Number.parseFloat(n.replace(/,/g,''));return Number.isFinite(p)?Math.round(Math.abs(p)):0;}
function pd(v){if(!v)return'';const r=String(v).trim();const iso=r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);if(iso)return iso[1]+'-'+iso[2].padStart(2,'0')+'-'+iso[3].padStart(2,'0');const s=r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(s)return(s[3].length===2?'20'+s[3]:s[3])+'-'+s[2].padStart(2,'0')+'-'+s[1].padStart(2,'0');return'';}
const fmt=n=>Math.round(n).toLocaleString('id-ID');
const DATA=path.join(__dirname,'..','data tiktok','CUSTOMBASE');
const STORE='custombase';

function field(row,...names){for(const n of names)if(row[n]!==undefined)return row[n];return'';}
function lineKey(s,oid,sku,varia){return ct(s)+'|'+(oid||'')+'|'+(sku||'')+'|'+(varia||'');}

async function main(){
  await pg.initSchema();
  console.log('Schema OK');
  const now=new Date().toISOString();

  // === IMPORT ORDERS ===
  for(const [month,file] of [['2026-05','custombase_semuapesanan_mei.xlsx'],['2026-06','custombase_semuapesanan_juni.xlsx']]){
    const fp=path.join(DATA,file);
    if(!fs.existsSync(fp)){console.log('MISSING:',file);continue;}
    const wb=XLSX.readFile(fp,{cellDates:false,raw:true});
    const sh=wb.Sheets['OrderSKUList'];if(!sh)continue;
    const rows=XLSX.utils.sheet_to_json(sh,{defval:''});
    const prepared=[];
    for(const r of rows){
      const oid=String(field(r,'Order ID')).trim();
      const sku=String(field(r,'Seller SKU')).trim();
      if(!oid||!sku||oid.toLowerCase().includes('platform unique order'))continue;
      const c=pd(field(r,'Created Time'));if(!c||!c.startsWith(month))continue;
      const qty=Math.abs(parseInt(String(field(r,'Quantity')).trim())||0);
      const up=rp(field(r,'SKU Unit Original Price'));
      const varia=String(field(r,'Variation')).trim();
      prepared.push({
        line_key:lineKey(STORE,oid,sku,varia),order_id:oid,store_name:STORE,
        source:'tiktok_order',created_at:c,updated_at:pd(field(r,'Delivered Time'))||c,
        status:String(field(r,'Order Status')).trim(),sku,product_name:String(field(r,'Product Name')).trim(),
        variation:varia,quantity:qty,unit_price:up,
        gross_product:rp(field(r,'SKU Subtotal Before Discount'))||up*qty,
        seller_discount:Math.abs(rp(field(r,'SKU Seller Discount'))),
        platform_discount:Math.abs(rp(field(r,'SKU Platform Discount'))),
        platform_fee:0,refund_amount:0,
        order_amount:rp(field(r,'Order Amount')),
        settlement_received:0,
        payment_method:String(field(r,'Payment Method')).trim(),
        tracking_id:String(field(r,'Tracking ID')).trim(),
        last_seen_file:file,last_seen_at:now,
      });
    }
    const dedup=new Map();for(const r of prepared)dedup.set(r.line_key,r);
    const uniq=[...dedup.values()];
    await pg.upsertRows('finance_order_lines',uniq,'line_key');
    console.log(file+': '+uniq.length+' rows imported');
  }

  // === IMPORT INCOME ===
  for(const incFile of ['penarikan-dana-1april-29juni.xlsx','penarikan-dana-30juni-18juli.xlsx']){
    const fp=path.join(__dirname,'..',incFile);
    if(!fs.existsSync(fp)){console.log('MISSING:',incFile);continue;}
    const wb=XLSX.readFile(fp,{cellFormula:false,cellStyles:false,cellDates:false});
    const sh=wb.Sheets['Detail pesanan'];if(!sh)continue;
    const keys=Object.keys(sh).filter(k=>k&&k[0]!=='!');let mr=0;for(const k of keys){try{const c=XLSX.utils.decode_cell(k);if(c.r>mr)mr=c.r;}catch(e){}}
    sh['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:mr,c:79}});
    const rows=XLSX.utils.sheet_to_json(sh,{header:1,defval:''});
    let updated=0,gmv=0;
    for(let i=1;i<rows.length;i++){
      const r=rows[i];if(!r||!r[1])continue;
      const type=String(r[1]).trim();if(!type)continue;
      const rid=String(r[63]||'').trim();
      const oid=(rid&&rid!=='/'&&rid!=='/\\t')?rid:String(r[0]).trim();
      if(!oid)continue;
      const settle=rp(r[5]),fee=rp(r[14]);
      
      // GMV Ads
      if(type.toLowerCase().includes('gmv')){
        const dt=pd(r[2]);if(!dt)continue;const m=dt.slice(0,7);
        await pg.pgQuery(`INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[STORE,dt.slice(0,10),Math.abs(settle),'TikTok GMV Ads',type,'GMV from income: '+incFile,now,now]);
        gmv++;continue;
      }
      // Penggantian
      if(type.includes('Penggantian'))continue;
      // Pesanan
      if(type!=='Pesanan')continue;
      
      // Update settlement on order lines
      const time=pd(r[2]);if(!time)continue;
      await pg.pgQuery(`UPDATE finance_order_lines SET source='income_statement',settlement_received=$1,platform_fee=$2,refund_amount=$3,updated_at=$4 WHERE order_id=$5 AND store_name=$6`,[settle+rp(r[62]),Math.abs(fee),rp(r[11]),now,oid,STORE]);
      updated++;
    }
    console.log(incFile+': '+updated+' orders updated, '+gmv+' GMV ads');
  }

  // === IMPORT ADS (Top Up) ===
  for(const [month,file] of [['2026-05','custombase_iklan_mei.xlsx'],['2026-06','custombase_iklan_juni.xlsx']]){
    const fp=path.join(DATA,file);
    if(!fs.existsSync(fp)){console.log('MISSING:',file);continue;}
    const wb=XLSX.readFile(fp,{cellDates:false,raw:true});
    const sh=wb.Sheets['sheet1'];if(!sh)continue;
    const rows=XLSX.utils.sheet_to_json(sh,{defval:''});
    let cnt=0;
    for(const r of rows){
      const type=String(field(r,'Transaction type')).trim();
      const subtype=String(field(r,'Transaction subtype')).trim();
      const status=String(field(r,'Status')).trim();
      const fund=String(field(r,'Fund type')).trim();
      const desc=String(field(r,'Description')).trim().toLowerCase();
      const amt=rp(field(r,'Amount'));
      // Top Up = General Add balance Success Cash, NOT GMV Pay
      if(type!=='General'||subtype!=='Add balance'||status!=='Success'||fund!=='Cash')continue;
      if(desc.includes('gmv pay'))continue;
      const dt=String(field(r,'Transaction time')).trim().slice(0,10);
      await pg.pgQuery(`INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[STORE,dt,amt,'TikTok Top Up','Manual Top Up','Top Up: '+file,now,now]);
      cnt++;
    }
    console.log(file+': '+cnt+' top-up rows');
  }

  // === VERIFY ===
  const ord=await pg.pgQuery('SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name=$1',[STORE]);
  const ad=await pg.pgQuery('SELECT COUNT(*) as c,SUM(amount) as t FROM finance_ad_spend WHERE store_name=$1',[STORE]);
  const sku=await pg.pgQuery('SELECT COUNT(*) as c FROM finance_sku_costs');
  console.log('\n=== DB SUMMARY ===');
  console.log('Orders:',ord.rows[0].c,'rows');
  console.log('Ad spend:',ad.rows[0].c,'rows, Total:',fmt(ad.rows[0].t));
  console.log('SKU HPP:',sku.rows[0].c,'entries');
  console.log('✅ IMPORT COMPLETE');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
