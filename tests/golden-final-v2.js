/**
 * GOLDEN TEST FINAL - MEI SETTLEMENT + JUNI ACCRUAL
 * Custombase - verified against income statement
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data tiktok", "CUSTOMBASE");
const INCOME = path.join(__dirname, "..", "income_20260718110824(UTC+7).xlsx");
const SKU = path.join(__dirname, "..", "sku-template.xlsx");

const ct = v => String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
function rp(v) { const t=String(v||"").trim(); if(!t)return 0; const neg=/^-/.test(t); let n=t.replace(/[^\d,.\-]/g,""); if(n.startsWith("+"))n=n.slice(1); const p=Number.parseFloat(n.replace(/,/g,"")); return Number.isFinite(p)?Math.round(Math.abs(p)*(neg?-1:1)):0; }
function pd(v) { if(!v)return""; const r=String(v).trim(); const iso=r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/); if(iso)return iso[1]+"-"+iso[2].padStart(2,"0")+"-"+iso[3].padStart(2,"0"); const s=r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if(s)return(s[3].length===2?"20"+s[3]:s[3])+"-"+s[2].padStart(2,"0")+"-"+s[1].padStart(2,"0"); return""; }
const fmt = n => Math.round(n).toLocaleString("id-ID");
function chk(label, exp, act) { const ok=exp===act; console.log((ok?"✅":"❌")+" "+label+": expected "+fmt(exp)+" | actual "+fmt(act)+(ok?"":" | diff "+fmt(act-exp))); return ok; }

// === SKU HPP ===
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

// Parse all income rows into flat arrays
const incomeByMonth = {};
for(let i=1;i<irows.length;i++){
  const r=irows[i]; if(!r||!r[1]) continue;
  const type=String(r[1]).trim();
  const time=pd(r[2]);
  if(!time) continue;
  const month=time.slice(0,7);
  if(!incomeByMonth[month]) incomeByMonth[month] = {pesanan:[],gmv:[],penggantian:[],lain:[]};
  const entry = {
    type, orderId: String(r[0]).trim(), relatedId: String(r[63]||"").trim(),
    waktuPemesanan: time, waktuPembayaran: pd(r[3]),
    settlement: rp(r[5]), revenue: rp(r[6]), afterDiscount: rp(r[7]),
    beforeDiscount: rp(r[8]), sellerDiscount: rp(r[9]), refund: rp(r[11]),
    totalFees: rp(r[14]), adjustment: rp(r[62]), gmvAdFee: rp(r[54]),
  };
  if(type==="Pesanan") incomeByMonth[month].pesanan.push(entry);
  else if(type.toLowerCase().includes("gmv")) incomeByMonth[month].gmv.push(entry);
  else if(type.includes("Penggantian")) incomeByMonth[month].penggantian.push(entry);
  else incomeByMonth[month].lain.push(entry);
}
console.log("Income months:", Object.keys(incomeByMonth).sort().join(", "));
for(const [m,d] of Object.entries(incomeByMonth))
  console.log("  "+m+": Pesanan="+d.pesanan.length+" GMV="+d.gmv.length+" Penggantian="+d.penggantian.length);

// === ORDERS ===
function loadOrders(file) {
  const fp = path.join(DATA, file);
  if(!fs.existsSync(fp)) return [];
  const wb = XLSX.readFile(fp, {cellDates:false, raw:true});
  const sheet = wb.Sheets["OrderSKUList"];
  if(!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, {defval:""});
  const orders = [];
  for(const r of rows){
    const oid=String(r["Order ID"]||"").trim(), sku=String(r["Seller SKU"]||"").trim();
    if(!oid||!sku||oid.toLowerCase().includes("platform unique order")) continue;
    orders.push({
      orderId:oid, sku,
      status: String(r["Order Status"]).trim(),
      cancelReason: String(r["Cancel Reason"]).trim(),
      qty: Math.abs(parseInt(String(r["Quantity"]).trim())||0),
      grossProduct: rp(r["SKU Subtotal Before Discount"]),
      sellerDiscount: Math.abs(rp(r["SKU Seller Discount"])),
      trackingId: String(r["Tracking ID"]).trim(),
      packageId: String(r["Package ID"]).trim(),
      shippedTime: pd(r["Shipped Time"]),
      createdTime: pd(r["Created Time"]),
    });
  }
  return orders;
}

function groupOrders(orders) {
  const og = new Map();
  for(const o of orders){if(!og.has(o.orderId))og.set(o.orderId,[]);og.get(o.orderId).push(o);}
  return og;
}

// === IKLAN ===
function loadAds(file) {
  const fp = path.join(DATA, file);
  if(!fs.existsSync(fp)) return [];
  const wb = XLSX.readFile(fp, {cellDates:false, raw:true});
  const sheet = wb.Sheets["sheet1"];
  if(!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {defval:""}).map(r=>({
    time: String(r["Transaction time"]||"").trim(),
    type: String(r["Transaction type"]||"").trim(),
    subtype: String(r["Transaction subtype"]||"").trim(),
    status: String(r["Status"]||"").trim(),
    description: String(r["Description"]||"").trim(),
    fundType: String(r["Fund type"]||"").trim(),
    amount: rp(r["Amount"]),
  }));
}

// === COMPUTE ===
function compute(orders, month, mode) {
  const og = groupOrders(orders);
  const inc = incomeByMonth[month] || {pesanan:[],gmv:[],penggantian:[]};
  
  // Classify orders
  const selesai=[], shipped=[], cancelValid=[];
  for(const[oid,rows]of og){
    const st=rows[0].status, cr=ct(rows[0].cancelReason||""), ht=rows.some(r=>(r.trackingId||"").length>0), hs=rows.some(r=>(r.shippedTime||"").length>0);
    if(st==="Selesai")selesai.push({oid,rows});
    if(st==="Dikirim")shipped.push({oid,rows});
    if(st==="Dibatalkan"&&(cr.includes("pengirimanpaketgagal")||cr.includes("pakethilang"))&&(ht||hs))cancelValid.push({oid,rows});
  }
  const revenueOrders = mode==="settlement" ? selesai : [...selesai, ...shipped, ...cancelValid];
  
  // Omzet & Diskon from revenueOrders
  let omzetKotor=0, diskonSeller=0;
  for(const{rows}of revenueOrders) for(const r of rows){omzetKotor+=r.grossProduct;diskonSeller+=r.sellerDiscount;}
  
  // Settlement from income
  const settlementCair = inc.pesanan.reduce((s,r)=>s+r.settlement,0);
  const potonganPlatform = Math.abs(inc.pesanan.reduce((s,r)=>s+r.totalFees,0));
  const refundValid = Math.abs(inc.pesanan.reduce((s,r)=>s+(r.settlement===0&&r.revenue===0?0:r.refund),0));
  const penggantian = inc.penggantian.reduce((s,r)=>s+r.settlement,0);
  const iklanGMV = inc.gmv.reduce((s,r)=>s+Math.abs(r.settlement),0);
  
  // Potongan split (real vs estimated)
  const realSettled = Math.abs(inc.pesanan.filter(r=>r.settlement!==0).reduce((s,r)=>s+r.totalFees,0));
  const estimatedPiutang = Math.abs(inc.pesanan.filter(r=>r.settlement===0&&r.revenue!==0).reduce((s,r)=>s+r.totalFees,0));
  
  // HPP & Packing
  let hppS=0, hppSh=0, hppCV=0;
  const pkgS=new Set(), pkgSh=new Set(), pkgCV=new Set();
  for(const{oid,rows}of selesai){for(const r of rows)hppS+=r.qty*getHpp(r.sku);pkgS.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);}
  for(const{oid,rows}of shipped){for(const r of rows)hppSh+=r.qty*getHpp(r.sku);pkgSh.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);}
  for(const{oid,rows}of cancelValid){for(const r of rows)hppCV+=r.qty*getHpp(r.sku);pkgCV.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);}
  
  const hppTotal = hppS + (mode==="accrual"?hppSh:0) + hppCV;
  const packingTotal = (pkgS.size + (mode==="accrual"?pkgSh.size:0) + pkgCV.size) * 2000;
  
  return {
    omzetKotor, diskonSeller, omzetNet: omzetKotor-diskonSeller,
    settlementCair, potonganPlatform, refundValid, penggantian, iklanGMV,
    realSettled, estimatedPiutang,
    hppS, hppSh, hppCV, hppTotal,
    packingS: pkgS.size, packingSh: pkgSh.size, packingCV: pkgCV.size, packingTotal,
    totalHppPacking: hppTotal + packingTotal,
    selesai: selesai.length, shipped: shipped.length, cancelValid: cancelValid.length,
    pesananRows: inc.pesanan.length, gmvRows: inc.gmv.length,
  };
}

// =====================
console.log("\n========================================");
console.log("=== GOLDEN TEST MEI 2026 - SETTLEMENT ===");
console.log("========================================");
const mayOrders = loadOrders("custombase_semuapesanan_mei.xlsx");
const mayAds = loadAds("custombase_iklan_mei.xlsx");
const mei = compute(mayOrders, "2026-05", "settlement");
const mayTopUp = mayAds.filter(a=>a.type==="General"&&a.subtype==="Add balance"&&a.status==="Success"&&a.fundType==="Cash").reduce((s,a)=>s+a.amount,0);
const mayGMVfromAds = mayAds.filter(a=>{const d=a.description.toLowerCase();return (d.includes("gmv pay")||d.includes("gmv payment"))&&a.status==="Success"&&(a.subtype==="Bill payment"||a.subtype==="Add balance");}).reduce((s,a)=>s+Math.abs(a.amount),0);

let allOk = true;
allOk &= chk("Omzet Kotor", 20898500, mei.omzetKotor);
allOk &= chk("Diskon Seller", 8827867, mei.diskonSeller);
allOk &= chk("Omzet Net", 12070633, mei.omzetNet);
allOk &= chk("Settlement Cair", 8772345, mei.settlementCair);
allOk &= chk("Potongan Platform", 3223291, mei.potonganPlatform);
allOk &= chk("Refund Valid", 74997, mei.refundValid);
allOk &= chk("Penggantian", 32998, mei.penggantian);
allOk &= chk("Iklan GMV (settlement)", 1472709, mei.iklanGMV);
console.log("Iklan Top Up: expected 1.665.000 | actual "+fmt(mayTopUp)+" | diff "+fmt(mayTopUp-1665000));
console.log("Iklan GMV from ads: "+fmt(mayGMVfromAds)+" (validasi, jangan dobel hitung)");
console.log("");
console.log("HPP Selesai: "+fmt(mei.hppS)+" | expected 3.099.300");
console.log("Packing Selesai: "+mei.packingS+" pkt | expected 588");
console.log("HPP CV: "+fmt(mei.hppCV)+" | expected 388.600");
console.log("Packing CV: "+mei.packingCV+" pkt | expected 62");
console.log("TOTAL HPP+Packing: "+fmt(mei.totalHppPacking)+" | expected 4.787.900");
const meiProfit = mei.settlementCair + mei.penggantian - mei.refundValid - mei.totalHppPacking - mayTopUp - mei.iklanGMV;
console.log("Profit: "+fmt(meiProfit)+" | expected 879.734");

// =====================
console.log("\n========================================");
console.log("=== GOLDEN TEST JUNI 2026 - ACCRUAL ===");
console.log("========================================");
const juneOrders = loadOrders("custombase_semuapesanan_juni.xlsx");
const juneAds = loadAds("custombase_iklan_juni.xlsx");
const juni = compute(juneOrders, "2026-06", "accrual");
const juneTopUp = juneAds.filter(a=>a.type==="General"&&a.subtype==="Add balance"&&a.status==="Success"&&a.fundType==="Cash").reduce((s,a)=>s+a.amount,0);
const juneGMVfromAds = juneAds.filter(a=>{const d=a.description.toLowerCase();return (d.includes("gmv pay")||d.includes("gmv payment"))&&a.status==="Success"&&(a.subtype==="Bill payment"||a.subtype==="Add balance");}).reduce((s,a)=>s+Math.abs(a.amount),0);

allOk &= chk("Omzet Kotor", 54043700, juni.omzetKotor);
allOk &= chk("Diskon Seller", 21310753, juni.diskonSeller);
allOk &= chk("Omzet Net", 32732947, juni.omzetNet);
allOk &= chk("Refund Valid", 109094, juni.refundValid);
allOk &= chk("Potongan Platform Accrual", 8665750, juni.potonganPlatform);
console.log("  Real (settled): "+fmt(juni.realSettled)+" | expected 5.026.837");
console.log("  Estimated (piutang): "+fmt(juni.estimatedPiutang)+" | expected 3.638.913");
allOk &= chk("Penggantian", 56100, juni.penggantian);
allOk &= chk("HPP", 7546100, juni.hppTotal);
allOk &= chk("Packing", 3572000, juni.packingTotal);
allOk &= chk("Iklan GMV (settlement)", 6625056, juni.iklanGMV);
console.log("Iklan Top Up: expected 222.000 | actual "+fmt(juneTopUp)+" | diff "+fmt(juneTopUp-222000));
console.log("Iklan GMV from ads: "+fmt(juneGMVfromAds)+" (validasi)");
console.log("");

const juneTotalBiaya = juni.totalHppPacking + juneTopUp + juni.iklanGMV;
const juneNetTransaksi = juni.omzetNet - juni.potonganPlatform - juni.refundValid + juni.penggantian;
const juneProfit = juneNetTransaksi - juni.totalHppPacking - juneTopUp - juni.iklanGMV;
chk("Total Biaya", 17965156, juneTotalBiaya);
chk("Net Transaksi", 24014203, juneNetTransaksi);
chk("Profit Bersih", 6049047, juneProfit);

console.log("\n=== BREAKDOWN ===");
console.log("Order: Selesai="+juni.selesai+" Dikirim="+juni.shipped+" CancelValid="+juni.cancelValid);
console.log("HPP: Selesai="+fmt(juni.hppS)+" Dikirim="+fmt(juni.hppSh)+" CV="+fmt(juni.hppCV)+" Total="+fmt(juni.hppTotal));
console.log("Packing: Selesai="+juni.packingS+" Dikirim="+juni.packingSh+" CV="+juni.packingCV+" Total="+(juni.packingS+juni.packingSh+juni.packingCV)+" pkt x2000="+fmt(juni.packingTotal));

// Spillover
console.log("\n=== SPILLOVER IKLAN ===");
const afterJune = juneAds.filter(a=>a.time>"2026/06/30");
const spillMatched = afterJune.filter(a=>{const d=a.description.toLowerCase();return (d.includes("gmv pay")||d.includes("gmv payment"))&&a.status==="Success";});
const spillUnmatched = afterJune.filter(a=>!spillMatched.includes(a));
console.log("Ads after June 30: "+afterJune.length);
console.log("Spillover matched (GMV Pay): "+spillMatched.length+" rows, Rp"+fmt(spillMatched.reduce((s,a)=>s+Math.abs(a.amount),0)));
console.log("Spillover unmatched: "+spillUnmatched.length+" rows, Rp"+fmt(spillUnmatched.reduce((s,a)=>s+Math.abs(a.amount),0)));
console.log("(Spillover unmatched TIDAK masuk profit)");

console.log("\n=== FINAL: "+(allOk?"SEMUA MATCH ✅":"ADA SELISIH ❌")+" ===");
