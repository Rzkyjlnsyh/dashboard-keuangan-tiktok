/**
 * GOLDEN TEST LENGKAP - MEI SETTLEMENT + JUNI ACCRUAL
 * Custombase - semua file, semua bulan
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DATA = path.join(ROOT, "..", "data tiktok", "CUSTOMBASE");
const SKU_FILE = path.join(ROOT, "..", "sku-template.xlsx");
const INCOME_FILE = path.join(ROOT, "..", "income_20260718110824(UTC+7).xlsx");

// === HELPERS ===
const ct = v => String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
function rp(v) { const t=String(v||"").trim(); if(!t)return 0; const neg=/^-/.test(t); let n=t.replace(/[^\d,.\-]/g,""); if(n.startsWith("+"))n=n.slice(1); const p=Number.parseFloat(n.replace(/,/g,"")); return Number.isFinite(p)?Math.round(Math.abs(p)*(neg?-1:1)):0; }
function pd(v) { if(!v)return ""; const r=String(v).trim(); const iso=r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/); if(iso)return iso[1]+"-"+iso[2].padStart(2,"0")+"-"+iso[3].padStart(2,"0"); const s=r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if(s)return(s[3].length===2?"20"+s[3]:s[3])+"-"+s[2].padStart(2,"0")+"-"+s[1].padStart(2,"0"); return""; }
const fmt = n => Math.round(n).toLocaleString("id-ID");
const check = (label, exp, act) => {
  const ok = exp === act;
  console.log((ok?"✅":"❌")+" "+label+": expected "+fmt(exp)+" | actual "+fmt(act)+(ok?"":" | diff "+fmt(act-exp)));
  return ok;
};

// === SKU HPP ===
const skuWb = XLSX.readFile(SKU_FILE);
const skuRows = XLSX.utils.sheet_to_json(skuWb.Sheets["sku-template"],{defval:""});
const exactHpp=new Map(), numericHpp=new Map();
for(const r of skuRows){const t=ct(r.sku||"");const h=Math.abs(Number(r.hppPerUnit||0));if(t&&h>0){exactHpp.set(t,h);const nm=t.match(/^([a-z]+)(\d+)$/);if(nm){if(!numericHpp.has(nm[1]))numericHpp.set(nm[1],[]);numericHpp.get(nm[1]).push({h,num:parseInt(nm[2])});}}}
function getHpp(sku){const t=ct(sku);if(exactHpp.has(t))return exactHpp.get(t);const nm=t.match(/^([a-z]+)(\d+)$/);if(nm&&exactHpp.has(nm[1]))return exactHpp.get(nm[1]);if(nm&&numericHpp.has(nm[1])){const v=numericHpp.get(nm[1]);v.sort((a,b)=>a.num-b.num);return v[0].h;}const v2=numericHpp.get(t);if(v2){v2.sort((a,b)=>a.hpp-b.hpp);return v2[0].h;}return 0;}

// === INCOME STATEMENT ===
console.log("=== LOAD INCOME STATEMENT ===");
const iwb = XLSX.readFile(INCOME_FILE, {cellFormula:false, cellStyles:false, cellDates:false});
const isheet = iwb.Sheets["Detail pesanan"];
// BUG FIX: override !ref
const ikeys = Object.keys(isheet).filter(k=>k&&k[0]!=="!");
let imaxR=0;
for(const k of ikeys){try{const c=XLSX.utils.decode_cell(k);if(c.r>imaxR)imaxR=c.r;}catch(e){}}
isheet["!ref"] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:imaxR,c:79}});
const irows = XLSX.utils.sheet_to_json(isheet, {header:1, defval:""});
console.log("Income rows:", irows.length-1);

// Parse all settlements
const settlements = [];
for(let i=1;i<irows.length;i++){
  const r=irows[i]; if(!r||!r[1]) continue;
  const type = String(r[1]).trim();
  const oid = String(r[0]).trim();
  const rid = String(r[63]||"").trim();
  settlements.push({
    type, orderId: oid, relatedId: (rid&&rid!=="/")?rid:oid,
    waktuPemesanan: pd(r[2]),
    waktuPembayaran: pd(r[3]),
    settlement: rp(r[5]),
    revenue: rp(r[6]),
    afterDiscount: rp(r[7]),
    beforeDiscount: rp(r[8]),
    sellerDiscount: rp(r[9]),
    refund: rp(r[11]),
    totalFees: rp(r[14]),
    adjustment: rp(r[62]),
    gmvAdFee: rp(r[54]),
  });
}
console.log("Total settlements:", settlements.length);

// === ORDERS (MEI + JUNI) ===
function loadOrders(month, file) {
  const fp = path.join(DATA, file);
  if(!fs.existsSync(fp)) return [];
  const wb = XLSX.readFile(fp, {cellDates:false, raw:true});
  const sheet = wb.Sheets["OrderSKUList"];
  if(!sheet) { console.log("  No OrderSKUList sheet in",file); return []; }
  const rows = XLSX.utils.sheet_to_json(sheet, {defval:""});
  const orders = [];
  for(const r of rows){
    const oid=String(r["Order ID"]||"").trim(), sku=String(r["Seller SKU"]||"").trim();
    if(!oid||!sku||oid.toLowerCase().includes("platform unique order")) continue;
    const c=pd(r["Created Time"]); if(!c||!c.startsWith(month)) continue;
    orders.push({
      orderId:oid, sku,
      status: String(r["Order Status"]).trim(),
      cancelReason: String(r["Cancel Reason"]).trim(),
      qty: Math.abs(parseInt(String(r["Quantity"]).trim())||0),
      grossProduct: rp(r["SKU Subtotal Before Discount"]),
      sellerDiscount: Math.abs(rp(r["SKU Seller Discount"])),
      platformDiscount: Math.abs(rp(r["SKU Platform Discount"])),
      orderAmount: rp(r["Order Amount"]),
      trackingId: String(r["Tracking ID"]).trim(),
      packageId: String(r["Package ID"]).trim(),
      shippedTime: pd(r["Shipped Time"]),
      createdTime: c,
    });
  }
  return orders;
}

console.log("\n=== LOAD ORDERS ===");
const mayOrders = loadOrders("2026-05", "custombase_semuapesanan_mei.xlsx");
const juneOrders = loadOrders("2026-06", "custombase_semuapesanan_juni.xlsx");
console.log("May orders:", mayOrders.length, "rows");
console.log("June orders:", juneOrders.length, "rows");

function groupOrders(orders) {
  const og = new Map();
  for(const o of orders){if(!og.has(o.orderId))og.set(o.orderId,[]);og.get(o.orderId).push(o);}
  return og;
}

// === IKLAN ===
console.log("\n=== LOAD IKLAN ===");
function loadAds(file) {
  const fp = path.join(DATA, file);
  if(!fs.existsSync(fp)) return [];
  const wb = XLSX.readFile(fp, {cellDates:false, raw:true});
  const sheet = wb.Sheets["sheet1"];
  if(!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, {defval:""});
  const ads = [];
  for(const r of rows){
    ads.push({
      time: String(r["Transaction time"]||"").trim(),
      type: String(r["Transaction type"]||"").trim(),
      subtype: String(r["Transaction subtype"]||"").trim(),
      status: String(r["Status"]||"").trim(),
      description: String(r["Description"]||"").trim(),
      fundType: String(r["Fund type"]||"").trim(),
      amount: rp(r["Amount"]),
    });
  }
  return ads;
}

const mayAds = loadAds("custombase_iklan_mei.xlsx");
const juneAds = loadAds("custombase_iklan_juni.xlsx");
console.log("May ads:", mayAds.length, "June ads:", juneAds.length);

// === IKLAN TOP UP ===
// Per prompt: iklan top up = Promotions, Success, amount > 0
function calcIklanTopUp(ads) {
  let total = 0;
  const details = [];
  for(const a of ads){
    if(a.type === "Promotions" && a.status === "Success" && a.amount > 0) {
      total += a.amount;
      details.push(a);
    }
  }
  return {total, details};
}

// === IKLAN GMV dari settlement ===
function calcIklanGMV(settlements, month) {
  const gmv = settlements.filter(s=>{
    if(!s.waktuPemesanan.startsWith(month)) return false;
    const t = ct(s.type);
    return t.includes("gmv") || t.includes("pembayarangmv");
  });
  const total = gmv.reduce((s,r)=>s+Math.abs(r.settlement),0);
  return {total, rows: gmv};
}

// === IKLAN GMV dari file iklan (fallback/validasi) ===
// Per prompt: Description contains "GMV Pay", Status=Success, subtype IN ("Bill payment","Add balance")
function calcIklanGMVfromAds(ads) {
  let total = 0;
  const details = [];
  for(const a of ads) {
    const desc = a.description.toLowerCase();
    const isGMV = desc.includes("gmv pay") || desc.includes("gmv payment");
    const validSubtype = a.subtype === "Bill payment" || a.subtype === "Add balance";
    if(isGMV && a.status === "Success" && validSubtype) {
      total += Math.abs(a.amount);
      details.push(a);
    }
  }
  return {total, details};
}

// === COMPUTE PER BULAN ===
function computeMonth(orders, month, mode) {
  const og = groupOrders(orders);
  const monthSettlements = settlements.filter(s=>s.waktuPemesanan.startsWith(month));
  
  // Pesanan settlements
  const pesananS = monthSettlements.filter(s=>s.type==="Pesanan");
  const gmvS = monthSettlements.filter(s=>{const t=ct(s.type);return t.includes("gmv")||t.includes("pembayarangmv");});
  const penggantianS = monthSettlements.filter(s=>s.type.includes("Penggantian"));

  // Orders
  const selesai=[], shipped=[], cancelValid=[];
  for(const[oid,rows]of og){
    const st=rows[0].status, cr=ct(rows[0].cancelReason||""), ht=rows.some(r=>(r.trackingId||"").length>0), hs=rows.some(r=>(r.shippedTime||"").length>0);
    if(st==="Selesai")selesai.push({oid,rows});
    if(st==="Dikirim")shipped.push({oid,rows});
    if(st==="Dibatalkan"&&(cr.includes("pengirimanpaketgagal")||cr.includes("pakethilang"))&&(ht||hs))cancelValid.push({oid,rows});
  }

  // Mode: settlement = only Selesai, accrual = Selesai + Dikirim + CancelValid
  const revenueOrders = mode==="settlement" ? selesai : [...selesai, ...shipped, ...cancelValid];

  // Omzet & Diskon (accrual: Selesai+Dikirim, settlement: only Selesai)
  let omzetKotor=0, diskonSeller=0;
  for(const{rows}of revenueOrders) for(const r of rows){omzetKotor+=r.grossProduct;diskonSeller+=r.sellerDiscount;}

  // Settlement dari income
  const settlementCair = pesananS.reduce((s,r)=>s+(Number.isFinite(r.settlement)?r.settlement:0),0);
  const potonganPlatform = Math.abs(pesananS.reduce((s,r)=>s+(Number.isFinite(r.fees)?r.fees:0),0));
  const refundValid = Math.abs(pesananS.reduce((s,r)=>s+(r.settlement===0&&r.revenue===0?0:(Number.isFinite(r.refund)?r.refund:0)),0));
  const penggantian = monthSettlements.filter(s=>s.type.includes("Penggantian")).reduce((s,r)=>s+r.settlement,0);
  const iklanGMV = gmvS.reduce((s,r)=>s+Math.abs(r.settlement),0);

  // HPP & Packing
  let hppS=0, hppSh=0, hppCV=0;
  const pkgS=new Set(), pkgSh=new Set(), pkgCV=new Set();

  for(const{oid,rows}of selesai){
    for(const r of rows) hppS += r.qty * getHpp(r.sku);
    pkgS.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);
  }
  for(const{oid,rows}of shipped){
    for(const r of rows) hppSh += r.qty * getHpp(r.sku);
    pkgSh.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);
  }
  for(const{oid,rows}of cancelValid){
    for(const r of rows) hppCV += r.qty * getHpp(r.sku);
    pkgCV.add(rows.find(r=>r.trackingId)?.trackingId||rows.find(r=>r.packageId)?.packageId||oid);
  }

  const hppTotal = hppS + (mode==="accrual"?hppSh:0) + hppCV;
  const packingTotal = (pkgS.size + (mode==="accrual"?pkgSh.size:0) + pkgCV.size) * 2000;
  const totalHppPacking = hppTotal + packingTotal;

  return {
    omzetKotor, diskonSeller, omzetNet: omzetKotor - diskonSeller,
    settlementCair, potonganPlatform, refundValid, penggantian, iklanGMV,
    hppS, hppSh, hppCV, packingS: pkgS.size, packingSh: pkgSh.size, packingCV: pkgCV.size,
    hppTotal, packingTotal, totalHppPacking,
    selesai: selesai.length, shipped: shipped.length, cancelValid: cancelValid.length,
    pesananRows: pesananS.length, gmvRows: gmvS.length,
    mode
  };
}

// ==========================================
console.log("\n========================================");
console.log("=== GOLDEN TEST MEI 2026 - SETTLEMENT ===");
console.log("========================================");

const mei = computeMonth(mayOrders, "2026-05", "settlement");
const mayTopUp = calcIklanTopUp(mayAds);
const mayGMVfromAds = calcIklanGMVfromAds(mayAds);

check("Omzet Kotor", 20898500, mei.omzetKotor);
check("Diskon Seller", 8827867, mei.diskonSeller);
check("Omzet Net", 12070633, mei.omzetNet);
check("Settlement Cair", 8772345, mei.settlementCair);
check("Potongan Platform", 3223291, mei.potonganPlatform);
check("Refund Valid", 74997, mei.refundValid);
check("Penggantian", 32998, mei.penggantian);
check("Iklan GMV (settlement)", 1472709, mei.iklanGMV);
console.log("Iklan Top Up: expected 1.665.000 | actual "+fmt(mayTopUp.total)+" | diff "+fmt(mayTopUp.total-1665000));
console.log("Iklan GMV from ads (validasi): "+fmt(mayGMVfromAds.total)+" ("+mayGMVfromAds.details.length+" rows)");
console.log("");
console.log("HPP Selesai: "+fmt(mei.hppS)+" | expected 3.099.300 | diff "+fmt(mei.hppS-3099300));
console.log("Packing Selesai: "+mei.packingS+" pkt x 2000 = "+fmt(mei.packingS*2000)+" | expected 588 pkt = 1.176.000");
console.log("HPP Cancel Valid: "+fmt(mei.hppCV)+" | expected 388.600 | diff "+fmt(mei.hppCV-388600));
console.log("Packing CV: "+mei.packingCV+" pkt x 2000 = "+fmt(mei.packingCV*2000)+" | expected 62 pkt = 124.000");
console.log("TOTAL HPP+Packing: "+fmt(mei.totalHppPacking)+" | expected 4.787.900 | diff "+fmt(mei.totalHppPacking-4787900));
console.log("");
const meiProfit = mei.settlementCair + mei.penggantian - mei.refundValid - mei.totalHppPacking - mayTopUp.total - mei.iklanGMV;
console.log("Profit: "+fmt(meiProfit)+" | expected 879.734 | diff "+fmt(meiProfit-879734));

// ==========================================
console.log("\n========================================");
console.log("=== GOLDEN TEST JUNI 2026 - ACCRUAL ===");
console.log("========================================");

const juni = computeMonth(juneOrders, "2026-06", "accrual");
const juneTopUp = calcIklanTopUp(juneAds);
const juneGMVfromAds = calcIklanGMVfromAds(juneAds);

// Juni settlements
const juneSettlements = settlements.filter(s=>s.waktuPemesanan.startsWith("2026-06"));
const junePesanan = juneSettlements.filter(s=>s.type==="Pesanan");
const juneGMV = juneSettlements.filter(s=>{const t=ct(s.type);return t.includes("gmv")||t.includes("pembayarangmv");});

// Potongan platform split
const junePlatformReal = Math.abs(junePesanan.filter(s=>s.settlement!==0).reduce((s,r)=>s+r.fees,0));
const junePlatformEstimated = Math.abs(junePesanan.filter(s=>s.settlement===0&&s.revenue!==0).reduce((s,r)=>s+r.fees,0));

check("Omzet Kotor", 54043700, juni.omzetKotor);
check("Diskon Seller", 21310753, juni.diskonSeller);
check("Omzet Net", 32732947, juni.omzetNet);
check("Refund Valid", 109094, juni.refundValid);
check("Potongan Platform Accrual", 8665750, juni.potonganPlatform);
console.log("  Real (settled): "+fmt(junePlatformReal));
console.log("  Estimated (piutang): "+fmt(junePlatformEstimated));
check("Penggantian", 56100, juni.penggantian);
check("HPP", 7546100, juni.hppTotal);
check("Packing", 3572000, juni.packingTotal);
check("Iklan GMV (settlement)", 6625056, juni.iklanGMV);
console.log("Iklan GMV from ads (validasi): "+fmt(juneGMVfromAds.total)+" ("+juneGMVfromAds.details.length+" rows)");
console.log("Iklan Top Up: expected 222.000 | actual "+fmt(juneTopUp.total)+" | diff "+fmt(juneTopUp.total-222000));
console.log("");

const juneTotalBiaya = juni.totalHppPacking + juneTopUp.total + juni.iklanGMV;
const juneNetTransaksi = juni.omzetNet - juni.potonganPlatform - juni.refundValid + juni.penggantian;
const juneProfit = juneNetTransaksi - juni.totalHppPacking - juneTopUp.total - juni.iklanGMV;
console.log("Total Biaya: "+fmt(juneTotalBiaya)+" | expected 17.965.156 | diff "+fmt(juneTotalBiaya-17965156));
console.log("Net Transaksi: "+fmt(juneNetTransaksi)+" | expected 24.014.203 | diff "+fmt(juneNetTransaksi-24014203));
console.log("Profit Bersih: "+fmt(juneProfit)+" | expected 6.049.047 | diff "+fmt(juneProfit-6049047));
console.log("");

// Spillover check
console.log("=== SPILLOVER CHECK ===");
const june30End = "2026-07-01";
const afterJuneAds = juneAds.filter(a=>a.time > "2026/06/30");
console.log("Ads after June 30:", afterJuneAds.length);
// Ads that match June orders (GMV Pay)
const juneOrderIds = new Set(juneOrders.map(o=>o.orderId));
const afterJuneMatched = juneGMVfromAds.details.filter(a=>{
  const time = a.time.slice(0,10);
  return time > "2026-06-30";
});
console.log("Spillover matched:", afterJuneMatched.length);
console.log("Spillover unmatched:", afterJuneAds.length - afterJuneMatched.length);
console.log("");

console.log("=== ORDER COUNTS ===");
console.log("Selesai: "+juni.selesai+", Dikirim: "+juni.shipped+", Cancel Valid: "+juni.cancelValid);
console.log("Pesanan settlement rows: "+juni.pesananRows+", GMV rows: "+juni.gmvRows);
console.log("");
console.log("=== HPP+PACKING BREAKDOWN ===");
console.log("HPP Selesai: "+fmt(juni.hppS));
console.log("HPP Dikirim: "+fmt(juni.hppSh));
console.log("HPP Cancel Valid: "+fmt(juni.hppCV));
console.log("Packing Selesai: "+juni.packingS+" pkt x 2000 = "+fmt(juni.packingS*2000));
console.log("Packing Dikirim: "+juni.packingSh+" pkt x 2000 = "+fmt(juni.packingSh*2000));
console.log("Packing CV: "+juni.packingCV+" pkt x 2000 = "+fmt(juni.packingCV*2000));
