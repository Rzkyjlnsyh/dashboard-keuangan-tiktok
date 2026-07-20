/**
 * REGRESSION TEST FINAL — MEI 2026 SETTLEMENT + JUNI 2026 ACCRUAL
 * Exact match, toleransi max 1 rupiah
 */
const XLSX = require("xlsx"); const fs = require("fs"); const path = require("path");
const DATA = p => path.join(__dirname, "..", "data tiktok", "CUSTOMBASE", p);
const INCOME = path.join(__dirname, "..", "income_20260718110824(UTC+7).xlsx");
const SKU = path.join(__dirname, "..", "sku-template.xlsx");

const ct = v => String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
function rp(v) { const t=String(v||"").trim(); if(!t)return 0; const neg=/^-/.test(t); let n=t.replace(/[^\d,.\-]/g,""); if(n.startsWith("+"))n=n.slice(1); const p=Number.parseFloat(n.replace(/,/g,"")); return Number.isFinite(p)?Math.round(Math.abs(p)*(neg?-1:1)):0; }
function pd(v) { if(!v)return""; const r=String(v).trim(); const iso=r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/); if(iso)return iso[1]+"-"+iso[2].padStart(2,"0")+"-"+iso[3].padStart(2,"0"); const s=r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if(s)return(s[3].length===2?"20"+s[3]:s[3])+"-"+s[2].padStart(2,"0")+"-"+s[1].padStart(2,"0"); return""; }
const fmt = n => Math.round(n).toLocaleString("id-ID");
function ok(label, exp, act) { const d=Math.abs(act-exp); const pass=d<=1; console.log((pass?"✅":"❌")+" "+label.padEnd(35)+" | "+String(exp).padStart(14)+" | "+String(act).padStart(14)+(pass?"":" | Δ"+String(act-exp))); if(!pass)process.exitCode=1; return pass; }

// === SKU HPP ===
const skuWb=XLSX.readFile(SKU); const skuRows=XLSX.utils.sheet_to_json(skuWb.Sheets["sku-template"],{defval:""});
const eHpp=new Map(), nHpp=new Map();
for(const r of skuRows){const t=ct(r.sku||"");const h=Math.abs(Number(r.hppPerUnit||0));if(t&&h>0){eHpp.set(t,h);const nm=t.match(/^([a-z]+)(\d+)$/);if(nm){if(!nHpp.has(nm[1]))nHpp.set(nm[1],[]);nHpp.get(nm[1]).push({h,num:parseInt(nm[2])});}}}
function gh(sku){const t=ct(sku);if(eHpp.has(t))return eHpp.get(t);const nm=t.match(/^([a-z]+)(\d+)$/);if(nm&&eHpp.has(nm[1]))return eHpp.get(nm[1]);if(nm&&nHpp.has(nm[1])){const v=nHpp.get(nm[1]);v.sort((a,b)=>a.num-b.num);return v[0].h;}const v2=nHpp.get(t);if(v2){v2.sort((a,b)=>a.hpp-b.hpp);return v2[0].h;}return 0;}

// === INCOME RAW (aggregate by type+month, NO join to orders) ===
const iwb=XLSX.readFile(INCOME,{cellFormula:false,cellStyles:false,cellDates:false});
const isheet=iwb.Sheets["Detail pesanan"]; const ikeys=Object.keys(isheet).filter(k=>k&&k[0]!=="!"); let imr=0;
for(const k of ikeys){try{const c=XLSX.utils.decode_cell(k);if(c.r>imr)imr=c.r;}catch(e){}}
isheet["!ref"]=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:imr,c:79}});
const irows=XLSX.utils.sheet_to_json(isheet,{header:1,defval:""});
const incAgg={}; // key: "month|type" -> {count,settlement,fees,refund}
for(let i=1;i<irows.length;i++){const r=irows[i];if(!r||!r[1])continue;const type=String(r[1]).trim(),time=pd(r[2]);if(!time)continue;const m=time.slice(0,7),k=m+"|"+type;if(!incAgg[k])incAgg[k]={type,month:m,count:0,settlement:0,fees:0,refund:0,adj:0};incAgg[k].count++;incAgg[k].settlement+=rp(r[5]);incAgg[k].fees+=rp(r[14]);incAgg[k].refund+=rp(r[11]);incAgg[k].adj+=rp(r[62]);}

// === ORDERS ===
function loadOrders(file,month){const fp=DATA(file);if(!fs.existsSync(fp))return[];const wb=XLSX.readFile(fp,{cellDates:false,raw:true});const sheet=wb.Sheets["OrderSKUList"];if(!sheet)return[];const rows=XLSX.utils.sheet_to_json(sheet,{defval:""});const o=[];for(const r of rows){const oid=String(r["Order ID"]||"").trim(),sku=String(r["Seller SKU"]||"").trim();if(!oid||!sku||oid.toLowerCase().includes("platform unique order"))continue;const c=pd(r["Created Time"]);if(!c||!c.startsWith(month))continue;o.push({orderId:oid,sku,status:String(r["Order Status"]).trim(),cancelReason:String(r["Cancel Reason"]).trim(),qty:Math.abs(parseInt(String(r["Quantity"]).trim())||0),grossProduct:rp(r["SKU Subtotal Before Discount"]),sellerDiscount:Math.abs(rp(r["SKU Seller Discount"])),trackingId:String(r["Tracking ID"]).trim(),packageId:String(r["Package ID"]).trim(),shippedTime:pd(r["Shipped Time"])});}return o;}
function groupOrd(orders){const og=new Map();for(const o of orders){if(!og.has(o.orderId))og.set(o.orderId,[]);og.get(o.orderId).push(o);}return og;}

// === IKLAN TOP UP (exclude GMV Pay) ===
function loadTopUp(file){const fp=DATA(file);if(!fs.existsSync(fp))return 0;const wb=XLSX.readFile(fp,{cellDates:false,raw:true});const sheet=wb.Sheets["sheet1"];if(!sheet)return 0;return XLSX.utils.sheet_to_json(sheet,{defval:""}).filter(a=>String(a["Transaction type"]||"").trim()==="General"&&String(a["Transaction subtype"]||"").trim()==="Add balance"&&String(a["Status"]||"").trim()==="Success"&&String(a["Fund type"]||"").trim()==="Cash"&&!String(a["Description"]||"").toLowerCase().includes("gmv pay")).reduce((s,a)=>s+rp(a["Amount"]),0);}

// === COMPUTE ===
function compute(orders, month, mode) {
  const og = groupOrd(orders);
  const selesai=[], shipped=[], cv=[];
  for(const[oid,rows]of og){const st=rows[0].status,cr=ct(rows[0].cancelReason||""),ht=rows.some(r=>(r.trackingId||"").length>0),hs=rows.some(r=>(r.shippedTime||"").length>0);if(st==="Selesai")selesai.push({oid,rows});if(st==="Dikirim")shipped.push({oid,rows});if(st==="Dibatalkan"&&(cr.includes("pengirimanpaketgagal")||cr.includes("pakethilang"))&&(ht||hs))cv.push({oid,rows});}
  const revOrd = mode==="settlement"?selesai:[...selesai,...shipped,...cv];
  let omzet=0, disc=0;
  for(const{rows}of revOrd) for(const r of rows){omzet+=r.grossProduct;disc+=r.sellerDiscount;}

  // Settlement DARI INCOME RAW (BUKAN join order_lines!)
  const pa = incAgg[month+"|Pesanan"]||{settlement:0,fees:0,refund:0};
  const ga = incAgg[month+"|Pembayaran GMV untuk Iklan TikTok"]||{settlement:0};
  const pg = Object.entries(incAgg).filter(([k])=>k.startsWith(month)&&k.includes("Penggantian")).reduce((s,[,v])=>s+v.settlement,0);
  
  const settlementCair = pa.settlement;
  const potonganPlatform = Math.abs(pa.fees);
  
  // Refund valid: exclude pure refund (settle=0, rev=0)
  let vr=0, pr=0;
  for(let i=1;i<irows.length;i++){const r=irows[i];if(!r||!r[1])continue;if(String(r[1]).trim()!=="Pesanan")continue;const t=pd(r[2]);if(!t.startsWith(month))continue;const stl=rp(r[5]),rev=rp(r[6]),ref=rp(r[11]);if(stl===0&&rev===0)pr+=ref;else vr+=ref;}
  const refundValid = Math.abs(vr);
  
  const iklanGMV = Math.abs(ga.settlement);

  // Real vs Estimated potongan
  let realFee=0, estFee=0;
  for(let i=1;i<irows.length;i++){const r=irows[i];if(!r||!r[1])continue;if(String(r[1]).trim()!=="Pesanan")continue;const t=pd(r[2]);if(!t.startsWith(month))continue;const stl=rp(r[5]),rev=rp(r[6]),fee=rp(r[14]);if(stl!==0)realFee+=fee;else if(rev!==0)estFee+=fee;}
  const realSettled=Math.abs(realFee), estimatedPiutang=Math.abs(estFee);

  // HPP & Packing
  let hS=0,hSh=0,hCv=0; const pS=new Set(),pSh=new Set(),pCv=new Set();
  for(const{oid,rows}of selesai){for(const r of rows)hS+=r.qty*gh(r.sku);pS.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);}
  for(const{oid,rows}of shipped){for(const r of rows)hSh+=r.qty*gh(r.sku);pSh.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);}
  for(const{oid,rows}of cv){for(const r of rows)hCv+=r.qty*gh(r.sku);pCv.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);}
  const incSh = mode==="accrual";
  return {omzetKotor:omzet,disc,omzetNet:omzet-disc,settlementCair,potonganPlatform,refundValid,penggantian:pg,iklanGMV,realSettled,estimatedPiutang,hppS:hS,hppSh:hSh,hppCv:hCv,hppTotal:hS+(incSh?hSh:0)+hCv,packingS:pS.size,packingSh:pSh.size,packingCv:pCv.size,packingTotal:(pS.size+(incSh?pSh.size:0)+pCv.size)*2000,selesai:selesai.length,shipped:shipped.length,cv:cv.length};
}

// ===================== MEI =====================
console.log("=".repeat(70));
console.log("  REGRESSION TEST — MEI 2026 CUSTOMBASE SETTLEMENT");
console.log("=".repeat(70));
const mayOrd=loadOrders("custombase_semuapesanan_mei.xlsx","2026-05");
const mei=compute(mayOrd,"2026-05","settlement");
const mayTU=loadTopUp("custombase_iklan_mei.xlsx");
let all=true;
all&=ok("Orders Selesai",588,mei.selesai);
all&=ok("Cancel Valid",62,mei.cv);
all&=ok("Omzet Kotor",20898500,mei.omzetKotor);
all&=ok("Diskon Seller",8827867,mei.disc);
all&=ok("Omzet Net",12070633,mei.omzetNet);
all&=ok("Settlement Cair",8772345,mei.settlementCair);
all&=ok("Potongan Platform",3223291,mei.potonganPlatform);
all&=ok("Penggantian",32998,mei.penggantian);
all&=ok("Iklan GMV",1472709,mei.iklanGMV);
all&=ok("Iklan Top Up",1665000,mayTU);
all&=ok("HPP",3487900,mei.hppTotal);
all&=ok("Packing",1300000,mei.packingTotal);
const meiP=mei.settlementCair+mei.penggantian-mei.hppTotal-mei.packingTotal-mayTU-mei.iklanGMV;
all&=ok("Profit",879734,meiP);
console.log("\n  HPP detail: Selesai="+fmt(mei.hppS)+" CV="+fmt(mei.hppCv)+" Total="+fmt(mei.hppTotal));
console.log("  Packing: Selesai="+mei.packingS+" CV="+mei.packingCv+" = "+(mei.packingS+mei.packingCv)+" pkt x2000");
console.log("  Refund: valid="+fmt(mei.refundValid)+" (pure refund excluded)");
console.log("  "+ (all?"✅ MEI VALID":"❌ MEI FAIL"));

// ===================== JUNI =====================
console.log("\n"+"=".repeat(70));
console.log("  REGRESSION TEST — JUNI 2026 CUSTOMBASE ACCRUAL");
console.log("=".repeat(70));
const juneOrd=loadOrders("custombase_semuapesanan_juni.xlsx","2026-06");
const juni=compute(juneOrd,"2026-06","accrual");
const juneTU=loadTopUp("custombase_iklan_juni.xlsx");
all=true;
all&=ok("Omzet Kotor",54043700,juni.omzetKotor);
all&=ok("Diskon Seller",21310753,juni.disc);
all&=ok("Omzet Net",32732947,juni.omzetNet);
all&=ok("Refund Valid",109094,juni.refundValid);
all&=ok("Potongan Platform Accrual",8665750,juni.potonganPlatform);
all&=ok("  Real (settled)",5026837,juni.realSettled);
all&=ok("  Estimated (piutang)",3638913,juni.estimatedPiutang);
all&=ok("Penggantian",56100,juni.penggantian);
all&=ok("HPP",7546100,juni.hppTotal);
all&=ok("Packing",3572000,juni.packingTotal);
all&=ok("Iklan GMV",6625056,juni.iklanGMV);
all&=ok("Iklan Top Up",222000,juneTU);
const juneTB=juni.hppTotal+juni.packingTotal+juneTU+juni.iklanGMV;
const juneNT=juni.omzetNet-juni.potonganPlatform-juni.refundValid+juni.penggantian;
const juneP=juneNT-juni.hppTotal-juni.packingTotal-juneTU-juni.iklanGMV;
all&=ok("Total Biaya",17965156,juneTB);
all&=ok("Net Transaksi",24014203,juneNT);
all&=ok("Profit Bersih",6049047,juneP);
console.log("\n  Order: Selesai="+juni.selesai+" Dikirim="+juni.shipped+" CV="+juni.cv);
console.log("  HPP: S="+fmt(juni.hppS)+" Sh="+fmt(juni.hppSh)+" CV="+fmt(juni.hppCv)+" Total="+fmt(juni.hppTotal));
console.log("  Packing: S="+juni.packingS+" Sh="+juni.packingSh+" CV="+juni.packingCv+" = "+(juni.packingS+juni.packingSh+juni.packingCv)+" pkt x2000");
console.log("  "+ (all?"✅ JUNI VALID":"❌ JUNI FAIL"));
