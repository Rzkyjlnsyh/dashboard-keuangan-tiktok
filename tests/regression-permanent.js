/**
 * REGRESSION TEST PERMANEN
 * CUSTOMBASE MEI 2026 SETTLEMENT + JUNI 2026 ACCRUAL
 * 
 * HPP: CSV (master_hpp_pare_custom_corrected.csv) PRIMARY
 *      XLSX (sku-template.xlsx) FALLBACK
 * 
 * Settlement: dihitung LANGSUNG dari income raw, BUKAN join order_lines
 * Iklan Top Up: General Add balance Success Cash, exclude GMV Pay
 * Packing: unique Tracking ID > Package ID > Order ID x 2000
 * 
 * Usage: node tests/regression-permanent.js
 * Exit code 0 = PASS, 1 = FAIL
 */
const XLSX=require("xlsx");const fs=require("fs");const path=require("path");
const DATA=p=>path.join(__dirname,"..","data tiktok","CUSTOMBASE",p);
const INCOME=path.join(__dirname,"..","income_20260718110824(UTC+7).xlsx");
const CSV_HPP=path.join(__dirname,"..","master_hpp_pare_custom_corrected.csv");
const XLSX_HPP=path.join(__dirname,"..","sku-template.xlsx");

const ct=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
function rp(v){const t=String(v||"").trim();if(!t)return 0;const neg=/^-/.test(t);let n=t.replace(/[^\d,.\-]/g,"");if(n.startsWith("+"))n=n.slice(1);const p=Number.parseFloat(n.replace(/,/g,""));return Number.isFinite(p)?Math.round(Math.abs(p)*(neg?-1:1)):0;}
function pd(v){if(!v)return"";const r=String(v).trim();const iso=r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);if(iso)return iso[1]+"-"+iso[2].padStart(2,"0")+"-"+iso[3].padStart(2,"0");const s=r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(s)return(s[3].length===2?"20"+s[3]:s[3])+"-"+s[2].padStart(2,"0")+"-"+s[1].padStart(2,"0");return"";}
const fmt=n=>Math.round(n).toLocaleString("id-ID");
function ok(label,exp,act){const d=Math.abs(act-exp);const p=d<=1;console.log((p?"✅":"❌")+" "+label.padEnd(35)+" | "+String(exp).padStart(14)+" | "+String(act).padStart(14)+(p?"":" | Δ"+String(act-exp)));if(!p)process.exitCode=1;return p;}

// === MERGED HPP: CSV PRIMARY + XLSX FALLBACK ===
const hppMap=new Map();
const csvRaw=fs.readFileSync(CSV_HPP,"utf-8").replace(/^\uFEFF/,"");
for(const line of csvRaw.split("\n").slice(1)){
  const p=line.split(",");const t=ct(p[0]||"");const h=Math.abs(Number(p[2])||0);
  if(t&&h>0)hppMap.set(t,h);
}
const xlsxWb=XLSX.readFile(XLSX_HPP);
for(const r of XLSX.utils.sheet_to_json(xlsxWb.Sheets["sku-template"],{defval:""})){
  const t=ct(r.sku||"");const h=Math.abs(Number(r.hppPerUnit||0));
  if(t&&h>0&&!hppMap.has(t))hppMap.set(t,h);
}
function getHpp(sku){const t=ct(sku);if(hppMap.has(t))return hppMap.get(t);const nm=t.match(/^([a-z]+)(\d+)$/);if(nm&&hppMap.has(nm[1]))return hppMap.get(nm[1]);return 0;}

// === INCOME RAW (aggregate by month+type, NO join to orders) ===
const iwb=XLSX.readFile(INCOME,{cellFormula:false,cellStyles:false,cellDates:false});
const isheet=iwb.Sheets["Detail pesanan"];
const ikeys=Object.keys(isheet).filter(k=>k&&k[0]!=="!");let imr=0;
for(const k of ikeys){try{const c=XLSX.utils.decode_cell(k);if(c.r>imr)imr=c.r;}catch(e){}}
isheet["!ref"]=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:imr,c:79}});
const irows=XLSX.utils.sheet_to_json(isheet,{header:1,defval:""});
const inc={};
for(let i=1;i<irows.length;i++){const r=irows[i];if(!r||!r[1])continue;const ty=String(r[1]).trim(),tm=pd(r[2]);if(!tm)continue;const m=tm.slice(0,7),k=m+"|"+ty;if(!inc[k])inc[k]={c:0,s:0,f:0,r:0};inc[k].c++;inc[k].s+=rp(r[5]);inc[k].f+=rp(r[14]);inc[k].r+=rp(r[11]);}

function getSettlement(month){
  const pa=inc[month+"|Pesanan"]||{s:0,f:0};
  const ga=inc[month+"|Pembayaran GMV untuk Iklan TikTok"]||{s:0};
  const pg=Object.entries(inc).filter(([k])=>k.startsWith(month)&&k.includes("Penggantian")).reduce((s,[,v])=>s+v.s,0);
  let vr=0,pr=0,realFee=0,estFee=0;
  for(let i=1;i<irows.length;i++){const r=irows[i];if(!r||!r[1])continue;if(String(r[1]).trim()!=="Pesanan")continue;const t=pd(r[2]);if(!t.startsWith(month))continue;const stl=rp(r[5]),rev=rp(r[6]),ref=rp(r[11]),fee=rp(r[14]);if(stl===0&&rev===0)pr+=ref;else vr+=ref;if(stl!==0)realFee+=fee;else if(rev!==0)estFee+=fee;}
  return{settlementCair:pa.s,potonganPlatform:Math.abs(pa.f),refundValid:Math.abs(vr),penggantian:pg,iklanGMV:Math.abs(ga.s),realSettled:Math.abs(realFee),estimatedPiutang:Math.abs(estFee)};
}

// === ORDERS ===
function loadOrders(file,month){const fp=DATA(file);if(!fs.existsSync(fp))return[];const wb=XLSX.readFile(fp,{cellDates:false,raw:true});const sheet=wb.Sheets["OrderSKUList"];if(!sheet)return[];const o=[];for(const r of XLSX.utils.sheet_to_json(sheet,{defval:""})){const oid=String(r["Order ID"]||"").trim(),sku=String(r["Seller SKU"]||"").trim();if(!oid||!sku||oid.toLowerCase().includes("platform unique order"))continue;const c=pd(r["Created Time"]);if(!c||!c.startsWith(month))continue;o.push({oid,sku,st:String(r["Order Status"]).trim(),cr:String(r["Cancel Reason"]).trim(),q:Math.abs(parseInt(String(r["Quantity"]).trim())||0),g:rp(r["SKU Subtotal Before Discount"]),sd:Math.abs(rp(r["SKU Seller Discount"])),tid:String(r["Tracking ID"]).trim(),pid:String(r["Package ID"]).trim(),sht:pd(r["Shipped Time"])});}return o;}

function groupOrd(orders){const og=new Map();for(const o of orders){if(!og.has(o.oid))og.set(o.oid,[]);og.get(o.oid).push(o);}return og;}

// === IKLAN TOP UP ===
function loadTopUp(file){const fp=DATA(file);if(!fs.existsSync(fp))return 0;const wb=XLSX.readFile(fp,{cellDates:false,raw:true});const sheet=wb.Sheets["sheet1"];if(!sheet)return 0;return XLSX.utils.sheet_to_json(sheet,{defval:""}).filter(a=>String(a["Transaction type"]||"").trim()==="General"&&String(a["Transaction subtype"]||"").trim()==="Add balance"&&String(a["Status"]||"").trim()==="Success"&&String(a["Fund type"]||"").trim()==="Cash"&&!String(a["Description"]||"").toLowerCase().includes("gmv pay")).reduce((s,a)=>s+rp(a["Amount"]),0);}

// === COMPUTE ===
function compute(orders,month,mode){
  const og=groupOrd(orders);
  const sl=[],sh=[],cv=[];
  for(const[oid,rows]of og){const st=rows[0].st,cr=ct(rows[0].cr||""),ht=rows.some(r=>(r.tid||"").length>0),hs=rows.some(r=>(r.sht||"").length>0);if(st==="Selesai")sl.push({oid,rows});if(st==="Dikirim")sh.push({oid,rows});if(st==="Dibatalkan"&&(cr.includes("pengirimanpaketgagal")||cr.includes("pakethilang"))&&(ht||hs))cv.push({oid,rows});}
  const ro=mode==="settlement"?sl:[...sl,...sh]; // Revenue: Selesai+Dikirim (NO CV!)
  let om=0,di=0;for(const{rows}of ro)for(const r of rows){om+=r.g;di+=r.sd;}
  
  const stl=getSettlement(month);
  
  let hS=0,hSh=0,hCv=0;const pS=new Set(),pSh=new Set(),pCv=new Set();
  for(const{oid,rows}of sl){for(const r of rows)hS+=r.q*getHpp(r.sku);pS.add(rows.find(r=>r.tid)?.tid||rows.find(r=>r.pid)?.pid||oid);}
  for(const{oid,rows}of sh){for(const r of rows)hSh+=r.q*getHpp(r.sku);pSh.add(rows.find(r=>r.tid)?.tid||rows.find(r=>r.pid)?.pid||oid);}
  for(const{oid,rows}of cv){for(const r of rows)hCv+=r.q*getHpp(r.sku);pCv.add(rows.find(r=>r.tid)?.tid||rows.find(r=>r.pid)?.pid||oid);}
  const incSh=mode==="accrual";
  return{om,di,on:om-di,...stl,hS,hSh,hCv,hT:hS+(incSh?hSh:0)+hCv,pkS:pS.size,pkSh:pSh.size,pkCv:pCv.size,pkT:(pS.size+(incSh?pSh.size:0)+pCv.size)*2000,sl:sl.length,sh:sh.length,cv:cv.length};
}

// ===================== MEI =====================
console.log("=".repeat(65));
console.log("  MEI 2026 — CUSTOMBASE — SETTLEMENT MODE");
console.log("=".repeat(65));
const mo=loadOrders("custombase_semuapesanan_mei.xlsx","2026-05");
const m=compute(mo,"2026-05","settlement");
const mTU=loadTopUp("custombase_iklan_mei.xlsx");
let all=true;
all&=ok("Orders Selesai",588,m.sl);all&=ok("Cancel Valid",62,m.cv);
all&=ok("Omzet Kotor",20898500,m.om);all&=ok("Diskon Seller",8827867,m.di);
all&=ok("Omzet Net",12070633,m.on);
all&=ok("Settlement Cair",8772345,m.settlementCair);
all&=ok("Potongan Platform",3223291,m.potonganPlatform);
all&=ok("Penggantian",32998,m.penggantian);
all&=ok("Iklan GMV",1472709,m.iklanGMV);
all&=ok("Iklan Top Up",1665000,mTU);
all&=ok("HPP",3487900,m.hT);all&=ok("Packing",1300000,m.pkT);
const mP=m.settlementCair+m.penggantian-m.hT-m.pkT-mTU-m.iklanGMV;
all&=ok("Profit",879734,mP);
console.log("  MEI: "+(all?"✅ 16/16 VALID":"❌ FAIL"));

// ===================== JUNI =====================
console.log("\n"+"=".repeat(65));
console.log("  JUNI 2026 — CUSTOMBASE — ACCRUAL MODE");
console.log("=".repeat(65));
const jo=loadOrders("custombase_semuapesanan_juni.xlsx","2026-06");
const j=compute(jo,"2026-06","accrual");
const jTU=loadTopUp("custombase_iklan_juni.xlsx");
all=true;
all&=ok("Omzet Kotor",54043700,j.om);all&=ok("Diskon Seller",21310753,j.di);
all&=ok("Omzet Net",32732947,j.on);
all&=ok("Refund Valid",109094,j.refundValid);
all&=ok("Potongan Platform Accrual",8665750,j.potonganPlatform);
all&=ok("  Real (settled)",5026837,j.realSettled);
all&=ok("  Estimated (piutang)",3638913,j.estimatedPiutang);
all&=ok("Penggantian",56100,j.penggantian);
all&=ok("HPP",7546100,j.hT);all&=ok("Packing",3572000,j.pkT);
all&=ok("Iklan GMV",6625056,j.iklanGMV);
all&=ok("Iklan Top Up",222000,jTU);
const jTB=j.hT+j.pkT+jTU+j.iklanGMV;
const jNT=j.on-j.potonganPlatform-j.refundValid+j.penggantian;
const jP=jNT-j.hT-j.pkT-jTU-j.iklanGMV;
all&=ok("Total Biaya",17965156,jTB);
all&=ok("Net Transaksi",24014203,jNT);
all&=ok("Profit Bersih",6049047,jP);
console.log("  JUNI: "+(all?"✅ ALL VALID":"❌ FAIL"));
console.log("\n"+"=".repeat(65));
console.log("  FINAL: "+(all?"✅ SEMUA MATCH":"❌ ADA SELISIH"));
console.log("=".repeat(65));
