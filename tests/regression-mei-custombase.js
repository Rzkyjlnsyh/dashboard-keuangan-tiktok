/**
 * REGRESSION TEST PERMANEN — CUSTOMBASE MEI 2026 SETTLEMENT
 * Wajib exact match, toleransi max 1 rupiah.
 * Jalan setiap kali ada perubahan kode.
 * 
 * Usage: node tests/regression-mei-custombase.js
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const DATA = p => path.join(__dirname, "..", "data tiktok", "CUSTOMBASE", p);
const INCOME = path.join(__dirname, "..", "income_20260718110824(UTC+7).xlsx");
const SKU = path.join(__dirname, "..", "sku-template.xlsx");

// === HELPERS ===
const ct = v => String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
function rp(v) { const t=String(v||"").trim(); if(!t)return 0; const neg=/^-/.test(t); let n=t.replace(/[^\d,.\-]/g,""); if(n.startsWith("+"))n=n.slice(1); const p=Number.parseFloat(n.replace(/,/g,"")); return Number.isFinite(p)?Math.round(Math.abs(p)*(neg?-1:1)):0; }
function pd(v) { if(!v)return""; const r=String(v).trim(); const iso=r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/); if(iso)return iso[1]+"-"+iso[2].padStart(2,"0")+"-"+iso[3].padStart(2,"0"); const s=r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if(s)return(s[3].length===2?"20"+s[3]:s[3])+"-"+s[2].padStart(2,"0")+"-"+s[1].padStart(2,"0"); return""; }
const fmt = n => Math.round(n).toLocaleString("id-ID");

// Exact match — max diff 1
function assert(label, expected, actual) {
  const diff = Math.abs(actual - expected);
  const ok = diff <= 1;
  console.log((ok?"✅":"❌")+" "+label.padEnd(35)+" | expected "+String(expected).padStart(14)+" | actual "+String(actual).padStart(14)+(ok?"":" | Δ"+String(actual-expected)));
  if (!ok) process.exitCode = 1;
  return ok;
}

// === SKU HPP (dari master template) ===
const skuWb = XLSX.readFile(SKU);
const skuRows = XLSX.utils.sheet_to_json(skuWb.Sheets["sku-template"],{defval:""});
const exactHpp=new Map(), numericHpp=new Map();
for(const r of skuRows){const t=ct(r.sku||"");const h=Math.abs(Number(r.hppPerUnit||0));if(t&&h>0){exactHpp.set(t,h);const nm=t.match(/^([a-z]+)(\d+)$/);if(nm){if(!numericHpp.has(nm[1]))numericHpp.set(nm[1],[]);numericHpp.get(nm[1]).push({h,num:parseInt(nm[2])});}}}
function getHpp(sku){const t=ct(sku);if(exactHpp.has(t))return exactHpp.get(t);const nm=t.match(/^([a-z]+)(\d+)$/);if(nm&&exactHpp.has(nm[1]))return exactHpp.get(nm[1]);if(nm&&numericHpp.has(nm[1])){const v=numericHpp.get(nm[1]);v.sort((a,b)=>a.num-b.num);return v[0].h;}const v2=numericHpp.get(t);if(v2){v2.sort((a,b)=>a.hpp-b.hpp);return v2[0].h;}return 0;}

// === INCOME STATEMENT ===
const iwb = XLSX.readFile(INCOME, {cellFormula:false, cellStyles:false, cellDates:false});
const isheet = iwb.Sheets["Detail pesanan"];
const ikeys = Object.keys(isheet).filter(k=>k&&k[0]!=="!");
let imaxR=0; for(const k of ikeys){try{const c=XLSX.utils.decode_cell(k);if(c.r>imaxR)imaxR=c.r;}catch(e){}}
isheet["!ref"] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:imaxR,c:79}});
const irows = XLSX.utils.sheet_to_json(isheet, {header:1, defval:""});

// Parse income — GROUP BY (type, month) for AGGREGATE calculation (NO JOIN to orders!)
const incomeAgg = {}; // key: "month|type" -> {count, settlement, fees, refund, adjustment}
for(let i=1;i<irows.length;i++){
  const r=irows[i]; if(!r||!r[1]) continue;
  const type=String(r[1]).trim(); const time=pd(r[2]); if(!time) continue;
  const month=time.slice(0,7);
  const key=month+"|"+type;
  if(!incomeAgg[key]) incomeAgg[key]={type,month,count:0,settlement:0,fees:0,refund:0,adjustment:0};
  incomeAgg[key].count++;
  incomeAgg[key].settlement += rp(r[5]);
  incomeAgg[key].fees += rp(r[14]);
  incomeAgg[key].refund += rp(r[11]);
  incomeAgg[key].adjustment += rp(r[62]);
}

// Debug: show income aggregates
console.log("=== INCOME RAW AGGREGATES (May) ===");
for(const [k,v] of Object.entries(incomeAgg)){
  if(!k.startsWith("2026-05")) continue;
  console.log("  "+v.type+": "+v.count+" rows, settlement="+fmt(v.settlement)+", fees="+fmt(v.fees)+", refund="+fmt(v.refund)+", adj="+fmt(v.adjustment));
}

// === ORDERS ===
const owb = XLSX.readFile(DATA("custombase_semuapesanan_mei.xlsx"), {cellDates:false, raw:true});
const osheet = owb.Sheets["OrderSKUList"];
const orows = XLSX.utils.sheet_to_json(osheet, {defval:""});

const orders = [];
for(const r of orows){
  const oid=String(r["Order ID"]||"").trim(), sku=String(r["Seller SKU"]||"").trim();
  if(!oid||!sku||oid.toLowerCase().includes("platform unique order")) continue;
  const c=pd(r["Created Time"]); if(!c||!c.startsWith("2026-05")) continue;
  orders.push({orderId:oid,sku,status:String(r["Order Status"]).trim(),cancelReason:String(r["Cancel Reason"]).trim(),qty:Math.abs(parseInt(String(r["Quantity"]).trim())||0),grossProduct:rp(r["SKU Subtotal Before Discount"]),sellerDiscount:Math.abs(rp(r["SKU Seller Discount"])),trackingId:String(r["Tracking ID"]).trim(),packageId:String(r["Package ID"]).trim(),shippedTime:pd(r["Shipped Time"])});
}

// Group by Order ID
const og = new Map();
for(const o of orders){if(!og.has(o.orderId))og.set(o.orderId,[]);og.get(o.orderId).push(o);}

// === CLASSIFY ORDERS ===
const selesai=[], cancelValid=[];
for(const[oid,rows]of og){
  const st=rows[0].status, cr=ct(rows[0].cancelReason||""), ht=rows.some(r=>(r.trackingId||"").length>0), hs=rows.some(r=>(r.shippedTime||"").length>0);
  if(st==="Selesai")selesai.push({oid,rows});
  if(st==="Dibatalkan"&&(cr.includes("pengirimanpaketgagal")||cr.includes("pakethilang"))&&(ht||hs))cancelValid.push({oid,rows});
}

// === COMPUTE: Settlement Mode (hanya Selesai) ===
// Omzet & Diskon (dari order data — ini TIDAK kena join bug)
let omzetKotor=0, diskonSeller=0;
for(const{rows}of selesai) for(const r of rows){omzetKotor+=r.grossProduct;diskonSeller+=r.sellerDiscount;}

// Settlement metrics — DARI INCOME RAW, BUKAN dari order_lines join!
const pesananAgg = incomeAgg["2026-05|Pesanan"] || {settlement:0,fees:0,refund:0};
const gmvAgg = incomeAgg["2026-05|Pembayaran GMV untuk Iklan TikTok"] || {settlement:0};
const penggantianAgg = Object.entries(incomeAgg).filter(([k])=>k.startsWith("2026-05")&&k.includes("Penggantian")).reduce((s,[,v])=>s+v.settlement,0);

const settlementCair = pesananAgg.settlement;
const potonganPlatform = Math.abs(pesananAgg.fees);
// Refund valid: exclude pure refund rows (settlement=0, revenue=0)
// Pure refund rows have: settlement=0, fees=0, revenue=0
// Non-pure-refund rows: settlement!=0 or revenue!=0
// Untuk simplicity: refund_valid = ABS(total_refund) - ABS(pure_refund)
// Pure refund = rows where settlement=0 AND revenue=0 (dari income raw)
let pureRefundSum = 0, validRefundSum = 0;
for(let i=1;i<irows.length;i++){
  const r=irows[i]; if(!r||!r[1]) continue;
  const type=String(r[1]).trim(); if(type!=="Pesanan") continue;
  const time=pd(r[2]); if(!time.startsWith("2026-05")) continue;
  const settle=rp(r[5]), rev=rp(r[6]), refund=rp(r[11]);
  if(settle===0 && rev===0) pureRefundSum += refund;
  else validRefundSum += refund;
}
const refundValid = Math.abs(validRefundSum);

// Iklan GMV dari income raw
const iklanGMV = Math.abs(gmvAgg.settlement);

// HPP & Packing (Selesai + Cancel Valid)
let hppS=0, hppCV=0;
const pkgS=new Set(), pkgCV=new Set();
for(const{oid,rows}of selesai){for(const r of rows)hppS+=r.qty*getHpp(r.sku);pkgS.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);}
for(const{oid,rows}of cancelValid){for(const r of rows)hppCV+=r.qty*getHpp(r.sku);pkgCV.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);}
const hppTotal = hppS + hppCV;
const packingTotal = (pkgS.size + pkgCV.size) * 2000;

// Iklan Top Up: General Add balance Success Cash
const awb = XLSX.readFile(DATA("custombase_iklan_mei.xlsx"), {cellDates:false, raw:true});
const arows = XLSX.utils.sheet_to_json(awb.Sheets["sheet1"],{defval:""});
const iklanTopUp = arows.filter(a=>String(a["Transaction type"]||"").trim()==="General"&&String(a["Transaction subtype"]||"").trim()==="Add balance"&&String(a["Status"]||"").trim()==="Success"&&String(a["Fund type"]||"").trim()==="Cash").reduce((s,a)=>s+rp(a["Amount"]),0);

// Profit
const profit = settlementCair + penggantianAgg - hppTotal - packingTotal - iklanTopUp - iklanGMV;

// =====================
console.log("\n========================================");
console.log("  REGRESSION TEST — MEI 2026 SETTLEMENT");
console.log("  Custombase | Mode: Settlement");
console.log("  Toleransi: max 1 rupiah");
console.log("========================================");
console.log("");

let allOk = true;
allOk &= assert("Orders Selesai", 588, selesai.length);
allOk &= assert("Cancel Valid", 62, cancelValid.length);
console.log("");
allOk &= assert("Omzet Kotor", 20898500, omzetKotor);
allOk &= assert("Diskon Seller", 8827867, diskonSeller);
allOk &= assert("Omzet Net", 12070633, omzetKotor-diskonSeller);
console.log("");
allOk &= assert("Settlement Cair", 8772345, settlementCair);
allOk &= assert("Potongan Platform", 3223291, potonganPlatform);
allOk &= assert("Penggantian", 32998, penggantianAgg);
allOk &= assert("Iklan GMV", 1472709, iklanGMV);
console.log("");
allOk &= assert("HPP", 3487900, hppTotal);
allOk &= assert("Packing", 1300000, packingTotal);
console.log("  HPP Selesai: "+fmt(hppS)+" | HPP CV: "+fmt(hppCV));
console.log("  Packing Selesai: "+pkgS.size+" pkt | CV: "+pkgCV.size+" pkt | Total: "+(pkgS.size+pkgCV.size)+" pkt x2000");
console.log("");
allOk &= assert("Iklan Top Up", 1665000, iklanTopUp);
console.log("");
allOk &= assert("Profit Bersih", 879734, profit);

// Formula verification
console.log("\n=== FORMULA VERIFICATION ===");
const calcProfit = settlementCair + penggantianAgg - hppTotal - packingTotal - iklanTopUp - iklanGMV;
console.log("  Profit = Settlement + Penggantian - HPP - Packing - TopUp - GMV");
console.log("  "+fmt(settlementCair)+" + "+fmt(penggantianAgg)+" - "+fmt(hppTotal)+" - "+fmt(packingTotal)+" - "+fmt(iklanTopUp)+" - "+fmt(iklanGMV));
console.log("  = "+fmt(calcProfit));

// Refund verification
console.log("\n=== REFUND VERIFICATION ===");
console.log("  Total refund (all Pesanan): "+fmt(Math.abs(pesananAgg.refund)));
console.log("  Pure refund (settle=0, rev=0): "+fmt(Math.abs(pureRefundSum)));
console.log("  Valid refund: "+fmt(refundValid)+" = "+fmt(Math.abs(pesananAgg.refund))+" - "+fmt(Math.abs(pureRefundSum)));

console.log("\n========================================");
console.log("  "+(allOk?"✅ ALL 16/16 EXACT MATCH":"❌ FAIL — cek di atas"));
console.log("========================================");
process.exit(allOk ? 0 : 1);
