/**
 * Verifikasi Golden Test CUSTOMBASE Mei 2026
 * Membaca file Excel langsung, menghitung semua metrik, membandingkan dengan expected.
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data tiktok", "CUSTOMBASE");
const SKU_FILE = path.join(ROOT, "master_hpp_pare_custom_corrected.csv");

// ── Helpers ──
const columnToken = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const cleanCol = (v) => String(v || "").replace(/\n/g, " ").trim();

function rupiah(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const text = String(value || "").trim();
  if (!text) return 0;
  const negative = /^-/.test(text) || /^\(.*\)$/.test(text);
  let n = text.replace(/[^\d,.\-]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  const parsed = Number.parseFloat(n.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.abs(parsed) * (negative ? -1 : 1));
}

function parseDate(value) {
  if (!value) return "";
  if (typeof value === "number") {
    const base = Date.UTC(1899, 11, 30);
    return new Date(base + value * 86400000).toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slash) {
    const d = slash[1].padStart(2, "0"), m = slash[2].padStart(2, "0");
    const y = slash[3].length === 2 ? "20" + slash[3] : slash[3];
    return `${y}-${m}-${d}`;
  }
  const iso = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return "";
}

function field(row, ...names) {
  for (const name of names) if (row[name] !== undefined) return row[name];
  const lowered = {};
  for (const [k, v] of Object.entries(row)) lowered[cleanCol(k).toLowerCase()] = v;
  for (const name of names) {
    const v = lowered[cleanCol(name).toLowerCase()];
    if (v !== undefined) return v;
  }
  return "";
}

const SPECIAL_HPP = {
  pola25pcs: 3000, pola50pcs: 6000, pola100pcs: 12000,
  pola125pcs: 15000, pola150pcs: 18000, pola200pcs: 24000,
  gancifotonama: 2000, holologo9: 9000, polaroid100: 12000,
};

const MONTH = "2026-05";
const STORE = "custombase";

// ── Read SKU HPP ──
console.log("=== 1. LOAD SKU HPP ===");
const skuCsv = fs.readFileSync(SKU_FILE, "utf-8");
const skuLines = skuCsv.split("\n").map(l => l.trim()).filter(Boolean);
const skuHeaders = skuLines[0].split(",").map(cleanCol);
const skuMap = new Map();
for (let i = 1; i < skuLines.length; i++) {
  const parts = skuLines[i].split(",");
  if (parts.length < 3) continue;
  const sku = cleanCol(parts[0]);
  const hpp = Math.abs(Number(parts[2]) || 0);
  const packing = Math.abs(Number(parts[3]) || 0);
  if (sku && hpp > 0) skuMap.set(sku, { hpp, packing, source: "CSV" });
}
console.log(`SKU CSV loaded: ${skuMap.size} entries`);

// ── Read Order File ──
console.log("\n=== 2. LOAD ORDERS (semua pesanan) ===");
const orderWb = XLSX.readFile(path.join(DATA, "custombase_semuapesanan_mei.xlsx"), { cellDates: false, raw: true });
const orderSheet = orderWb.Sheets["OrderSKUList"];
const orderRows = XLSX.utils.sheet_to_json(orderSheet, { defval: "" });
console.log(`Total rows (incl header desc): ${orderRows.length}`);

// Filter: skip description rows, only May 2026
const orders = [];
for (const row of orderRows) {
  const oid = String(field(row, "Order ID") || "").trim();
  const sku = String(field(row, "Seller SKU") || "").trim();
  if (!oid || !sku) continue;
  // Skip description row
  if (oid.toLowerCase().includes("platform unique order")) continue;
  const created = parseDate(field(row, "Created Time"));
  if (!created || !created.startsWith(MONTH)) continue;
  
  orders.push({
    orderId: oid,
    status: String(field(row, "Order Status")).trim(),
    cancelReason: String(field(row, "Cancel Reason")).trim(),
    sku,
    productName: String(field(row, "Product Name")).trim(),
    variation: String(field(row, "Variation")).trim(),
    qty: Math.abs(parseInt(String(field(row, "Quantity")).trim()) || 0),
    unitPrice: rupiah(field(row, "SKU Unit Original Price")),
    grossProduct: rupiah(field(row, "SKU Subtotal Before Discount")),
    sellerDiscount: Math.abs(rupiah(field(row, "SKU Seller Discount"))),
    platformDiscount: Math.abs(rupiah(field(row, "SKU Platform Discount"))),
    orderAmount: rupiah(field(row, "Order Amount")),
    trackingId: String(field(row, "Tracking ID")).trim(),
    packageId: String(field(row, "Package ID")).trim(),
    shippedTime: parseDate(field(row, "Shipped Time")),
    createdTime: created,
  });
}
console.log(`Orders May 2026: ${orders.length} rows`);

// Group by Order ID
const orderGroups = new Map();
for (const o of orders) {
  if (!orderGroups.has(o.orderId)) orderGroups.set(o.orderId, []);
  orderGroups.get(o.orderId).push(o);
}
console.log(`Unique orders: ${orderGroups.size}`);

// Status breakdown
const statusCount = {};
for (const [oid, rows] of orderGroups) {
  const s = rows[0].status || "Unknown";
  statusCount[s] = (statusCount[s] || 0) + 1;
}
console.log("Status breakdown:", JSON.stringify(statusCount, null, 2));

// ── Read Settlement File ──
console.log("\n=== 3. LOAD SETTLEMENT (penarikan dana) ===");
const settleWb = XLSX.readFile(path.join(DATA, "custombase_penarikandana_mei.xlsx"), { cellDates: false, raw: true });
const settleSheet = settleWb.Sheets["Detail pesanan"];
const settleRows = XLSX.utils.sheet_to_json(settleSheet, { defval: "" });
console.log(`Settlement rows: ${settleRows.length}`);

const settlements = [];
for (const row of settleRows) {
  const type = String(field(row, "Jenis transaksi")).trim();
  const orderId = String(field(row, "ID Pesanan/Penyesuaian")).trim();
  const relatedId = String(field(row, "ID pesanan terkait")).trim();
  const waktuPemesanan = parseDate(field(row, "Waktu pemesanan"));
  if (!orderId || orderId === "ID Pesanan/Penyesuaian") continue;
  
  settlements.push({
    type,
    orderId,
    relatedId: (relatedId && relatedId !== "/") ? relatedId : orderId,
    waktuPemesanan,
    waktuPembayaran: parseDate(field(row, "Waktu pembayaran pesanan")),
    settlement: rupiah(field(row, "Jumlah penyelesaian pembayaran")),
    totalRevenue: rupiah(field(row, "Total Pendapatan")),
    afterDiscount: rupiah(field(row, "Subtotal setelah diskon penjual")),
    beforeDiscount: rupiah(field(row, "Subtotal sebelum diskon")),
    sellerDiscount: Math.abs(rupiah(field(row, "Diskon penjual"))),
    refund: Math.abs(rupiah(field(row, "Subtotal pengembalian dana setelah diskon penjual"))),
    totalFees: Math.abs(rupiah(field(row, "Total Biaya", "Jumlah biaya"))),
    gmvAdFee: Math.abs(rupiah(field(row, "Biaya iklan GMV Max"))),
    adjustment: rupiah(field(row, "Jumlah penyesuaian")),
  });
}
console.log(`Valid settlement rows: ${settlements.length}`);

// Filter by Waktu pemesanan = May 2026
const maySettlements = settlements.filter(s => s.waktuPemesanan.startsWith(MONTH));
console.log(`Settlements with Waktu pemesanan May 2026: ${maySettlements.length}`);

// Break down by type
const typeBreakdown = {};
for (const s of maySettlements) {
  const t = s.type || "Unknown";
  if (!typeBreakdown[t]) typeBreakdown[t] = { count: 0, settlementSum: 0, feeSum: 0, refundSum: 0, adjSum: 0 };
  typeBreakdown[t].count++;
  typeBreakdown[t].settlementSum += s.settlement;
  typeBreakdown[t].feeSum += s.totalFees;
  typeBreakdown[t].refundSum += s.refund;
  typeBreakdown[t].adjSum += s.adjustment;
}
console.log("Type breakdown (May):", JSON.stringify(typeBreakdown, null, 2));

// ── Read Iklan File ──
console.log("\n=== 4. LOAD IKLAN ===");
const adWb = XLSX.readFile(path.join(DATA, "custombase_iklan_mei.xlsx"), { cellDates: false, raw: true });
const adSheet = adWb.Sheets["sheet1"];
const adRows = XLSX.utils.sheet_to_json(adSheet, { defval: "" });

let iklanTopUp = 0;
const iklanDetails = [];
for (const row of adRows) {
  const txnType = String(field(row, "Transaction type")).trim();
  const amount = rupiah(field(row, "Amount"));
  if (txnType === "Promotions" && amount > 0) {
    iklanTopUp += amount;
    iklanDetails.push({ date: String(field(row, "Transaction time")).slice(0, 10), type: txnType, amount });
  }
}
console.log(`Iklan Top Up (Promotions): Rp ${iklanTopUp.toLocaleString("id-ID")} (${iklanDetails.length} transaksi)`);

// ── COMPUTE: Settlement Mode (hanya Selesai) ──
console.log("\n========================================");
console.log("=== GOLDEN TEST MEI - SETTLEMENT MODE ===");
console.log("========================================");

// 1. Order Selesai only
const selesaiOrders = [];
const cancelValidOrders = [];
for (const [oid, rows] of orderGroups) {
  const status = rows[0].status;
  const cancelReason = columnToken(rows[0].cancelReason || "");
  const hasTracking = rows.some(r => (r.trackingId || "").trim().length > 0);
  const hasShipped = rows.some(r => (r.shippedTime || "").length > 0);
  const isSelesai = status === "Selesai";
  const isCancelValid = status === "Dibatalkan" && 
    (cancelReason.includes("pengirimanpaketgagal") || cancelReason.includes("pakethilang") || cancelReason.includes("gagalkirim")) &&
    (hasTracking || hasShipped);
  
  if (isSelesai) selesaiOrders.push({ oid, rows });
  if (isCancelValid) cancelValidOrders.push({ oid, rows });
}

console.log(`Order Selesai: ${selesaiOrders.length}`);
console.log(`Cancel Valid: ${cancelValidOrders.length}`);

// 2. Omzet Kotor & Diskon Seller (Selesai only)
let omzetKotor = 0, diskonSeller = 0;
for (const { rows } of selesaiOrders) {
  for (const r of rows) {
    omzetKotor += r.grossProduct;
    diskonSeller += r.sellerDiscount;
  }
}
const omzetNet = omzetKotor - diskonSeller;
console.log(`Omzet Kotor: Rp ${omzetKotor.toLocaleString("id-ID")}`);
console.log(`Diskon Seller: Rp ${diskonSeller.toLocaleString("id-ID")}`);
console.log(`Omzet Net: Rp ${omzetNet.toLocaleString("id-ID")}`);

// 3. Settlement cair & Potongan Platform
const pesananSettlements = maySettlements.filter(s => s.type === "Pesanan");
const settlementCair = pesananSettlements.reduce((sum, s) => sum + s.settlement, 0);
const potonganPlatform = pesananSettlements.reduce((sum, s) => sum + s.totalFees, 0);
const refundValid = pesananSettlements.reduce((sum, s) => sum + s.refund, 0);
const penggantian = pesananSettlements.reduce((sum, s) => sum + Math.max(0, s.adjustment), 0);
console.log(`Settlement Cair (Pesanan): Rp ${settlementCair.toLocaleString("id-ID")}`);
console.log(`Potongan Platform: Rp ${potonganPlatform.toLocaleString("id-ID")}`);
console.log(`Refund Valid: Rp ${refundValid.toLocaleString("id-ID")}`);
console.log(`Penggantian: Rp ${penggantian.toLocaleString("id-ID")}`);

// 4. Iklan GMV from settlement
const gmvSettlements = maySettlements.filter(s => {
  const t = columnToken(s.type);
  return (t.includes("gmv") || t.includes("pembayarangmv")) && t !== "pesanan" && t !== "order";
});
const iklanGMV = gmvSettlements.reduce((sum, s) => sum + Math.abs(s.settlement), 0);
console.log(`Iklan GMV (dari settlement): Rp ${iklanGMV.toLocaleString("id-ID")}`);
console.log(`  (${gmvSettlements.length} transaksi GMV)`);
if (gmvSettlements.length > 0) {
  console.log(`  Detail:`, gmvSettlements.map(s => `${s.type}: ${Math.abs(s.settlement)}`));
}

// 5. HPP + Packing
let hppSelesai = 0, packingSelesai = 0;
const selesaiPackages = new Set();
const unmappedSku = new Set();

function getHpp(skuToken) {
  const db = skuMap.get(skuToken);
  if (db && db.hpp > 0) return db.hpp;
  const special = SPECIAL_HPP[skuToken] || 0;
  if (special > 0) return special;
  unmappedSku.add(skuToken);
  return 0;
}

for (const { oid, rows } of selesaiOrders) {
  for (const r of rows) {
    const skuToken = columnToken(r.sku);
    const hpp = getHpp(skuToken);
    hppSelesai += r.qty * hpp;
  }
  // Package key: Tracking ID > Package ID > Order ID
  const pkgKey = rows.find(r => r.trackingId)?.trackingId ||
    rows.find(r => r.packageId)?.packageId || oid;
  selesaiPackages.add(pkgKey);
}
packingSelesai = selesaiPackages.size * 2000;
console.log(`HPP Selesai: Rp ${hppSelesai.toLocaleString("id-ID")}`);
console.log(`Packing Selesai: ${selesaiPackages.size} paket x 2000 = Rp ${packingSelesai.toLocaleString("id-ID")}`);

// Cancel valid HPP + Packing
let hppCancelValid = 0;
const cancelPkgs = new Set();
for (const { oid, rows } of cancelValidOrders) {
  for (const r of rows) {
    const skuToken = columnToken(r.sku);
    const hpp = getHpp(skuToken);
    hppCancelValid += r.qty * hpp;
  }
  const pkgKey = rows.find(r => r.trackingId)?.trackingId ||
    rows.find(r => r.packageId)?.packageId || oid;
  cancelPkgs.add(pkgKey);
}
const packingCancelValid = cancelPkgs.size * 2000;
console.log(`HPP Cancel Valid: Rp ${hppCancelValid.toLocaleString("id-ID")}`);
console.log(`Packing Cancel Valid: ${cancelPkgs.size} paket x 2000 = Rp ${packingCancelValid.toLocaleString("id-ID")}`);

const totalHpp = hppSelesai + hppCancelValid;
const totalPacking = packingSelesai + packingCancelValid;
console.log(`Total HPP: Rp ${totalHpp.toLocaleString("id-ID")}`);
console.log(`Total Packing: Rp ${totalPacking.toLocaleString("id-ID")}`);
console.log(`HPP + Packing: Rp ${(totalHpp + totalPacking).toLocaleString("id-ID")}`);

// 6. Profit
const totalBiaya = totalHpp + totalPacking + iklanTopUp + iklanGMV;
const netTransaksi = settlementCair + penggantian - refundValid;
const profit = netTransaksi - totalHpp - totalPacking - iklanTopUp - iklanGMV;
console.log(`\nTotal Biaya: Rp ${totalBiaya.toLocaleString("id-ID")}`);
console.log(`Net Transaksi (settlement + penggantian): Rp ${netTransaksi.toLocaleString("id-ID")}`);
console.log(`Profit: Rp ${profit.toLocaleString("id-ID")}`);

// ── COMPARE WITH EXPECTED ──
console.log("\n========================================");
console.log("=== PERBANDINGAN DENGAN EXPECTED ===");
console.log("========================================");

const expected = {
  omzetKotor: 20898500,
  diskonSeller: 8827867,
  omzetNet: 12070633,
  refund: 74997,
  potonganPlatform: 3223291,
  settlementCair: 8772345,
  penggantian: 32998,
  iklanTopUp: 1665000,
  iklanGMV: 1472709,
};

const actual = {
  omzetKotor,
  diskonSeller,
  omzetNet: omzetKotor - diskonSeller,
  refund: refundValid,
  potonganPlatform,
  settlementCair,
  penggantian,
  iklanTopUp,
  iklanGMV,
};

console.log("\n| Metric | Expected | Actual | Match |");
console.log("|--------|----------|--------|-------|");
for (const [key, exp] of Object.entries(expected)) {
  const act = actual[key] || 0;
  const diff = act - exp;
  const match = diff === 0 ? "✅" : `❌ (diff: ${diff.toLocaleString("id-ID")})`;
  console.log(`| ${key} | ${exp.toLocaleString("id-ID")} | ${act.toLocaleString("id-ID")} | ${match} |`);
}

// ── SKU Analysis ──
console.log("\n========================================");
console.log("=== SKU ANALYSIS ===");
console.log("========================================");

// Count SKU usage
const skuUsage = new Map();
for (const o of orders) {
  const token = columnToken(o.sku);
  if (!skuUsage.has(token)) skuUsage.set(token, { sku: o.sku, qty: 0, orders: new Set() });
  const u = skuUsage.get(token);
  u.qty += o.qty;
  u.orders.add(o.orderId);
}

// Check mapped vs unmapped
let mappedCount = 0, unmappedCount = 0;
const unmappedList = [];
for (const [token, usage] of skuUsage) {
  const hasHpp = skuMap.has(token) || SPECIAL_HPP[token];
  if (hasHpp) mappedCount++;
  else {
    unmappedCount++;
    unmappedList.push({ sku: usage.sku, token, qty: usage.qty, orders: usage.orders.size });
  }
}
console.log(`Total unique SKU: ${skuUsage.size}`);
console.log(`SKU dengan HPP: ${mappedCount}`);
console.log(`SKU TANPA HPP: ${unmappedCount}`);
if (unmappedList.length > 0) {
  console.log("\nSKU TANPA HPP (perlu ditambahkan):");
  unmappedList.sort((a, b) => b.qty - a.qty);
  for (const u of unmappedList) {
    console.log(`  - ${u.sku} (token: ${u.token}) | Qty: ${u.qty} | Orders: ${u.orders}`);
  }
}

// Match settlement ke orders
console.log("\n========================================");
console.log("=== SETTLEMENT vs ORDER MATCHING ===");
console.log("========================================");
const orderIdSet = new Set(orders.map(o => o.orderId));
let matchedSettlement = 0, unmatchedSettlement = 0;
for (const s of maySettlements) {
  if (s.type !== "Pesanan") continue;
  const oid = s.relatedId || s.orderId;
  if (orderIdSet.has(oid)) matchedSettlement++;
  else {
    unmatchedSettlement++;
    if (unmatchedSettlement <= 5) console.log(`  UNMATCHED: ${oid} (settlement: ${s.settlement})`);
  }
}
console.log(`Pesanan settlement May: ${pesananSettlements.length}`);
console.log(`  Matched ke order May: ${matchedSettlement}`);
console.log(`  Unmatched: ${unmatchedSettlement}`);

console.log("\n=== DONE ===");
