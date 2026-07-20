const pg=require('../lib/pg-connector');
const fs=require('fs');
const XLSX=require('xlsx');
const ct=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
process.env.DATABASE_URL='postgresql://postgres:082139063266@db.oumrrmynjzxrdereljfg.supabase.co:6543/postgres';

async function main(){
  await pg.initSchema();
  
  // Get existing SKU keys
  const exist=await pg.pgQuery('SELECT sku_key FROM finance_sku_costs');
  const existKeys=new Set(exist.rows.map(r=>r.sku_key));
  console.log('Existing SKUs:',existKeys.size);

  // Import CSV if not exists
  const csv=fs.readFileSync('master_hpp_pare_custom_corrected.csv','utf-8').replace(/^﻿/,'');
  let csvCnt=0;
  for(const line of csv.split('\n').slice(1)){
    const p=line.split(','); const sku=p[0]||''; const hpp=Math.abs(Number(p[2])||0);
    if(!sku||hpp<=0) continue;
    const key='global|'+ct(sku);
    if(existKeys.has(key)) continue;
    await pg.pgQuery('INSERT INTO finance_sku_costs(sku_key,store_name,sku,hpp_per_unit,packing_per_unit,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [key,'global',sku.trim(),hpp,Math.abs(Number(p[3])||0),new Date().toISOString()]);
    existKeys.add(key); csvCnt++;
  }
  console.log('CSV new:',csvCnt);

  // Import XLSX fallback
  const wb=XLSX.readFile('sku-template.xlsx');
  const rows=XLSX.utils.sheet_to_json(wb.Sheets['sku-template'],{defval:''});
  let xlCnt=0;
  for(const r of rows){
    const sku=String(r.sku||'').trim(); const hpp=Math.abs(Number(r.hppPerUnit||0));
    if(!sku||hpp<=0) continue;
    const key='global|'+ct(sku);
    if(existKeys.has(key)) continue;
    await pg.pgQuery('INSERT INTO finance_sku_costs(sku_key,store_name,sku,hpp_per_unit,packing_per_unit,updated_at) VALUES($1,$2,$3,$4,$5,$6)',
      [key,'global',sku,hpp,Math.abs(Number(r.packingPerUnit||0)),new Date().toISOString()]);
    existKeys.add(key); xlCnt++;
  }
  console.log('XLSX new:',xlCnt);

  const t=await pg.pgQuery('SELECT COUNT(*) as c FROM finance_sku_costs');
  console.log('TOTAL:',t.rows[0].c);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
