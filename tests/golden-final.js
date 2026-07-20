/**
 * GOLDEN TEST FINAL - CUSTOMBASE MEI 2026
 * Baca SEMUA row dari income statement (override !ref limit)
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data tiktok", "CUSTOMBASE");
const SKU_FILE = path.join(ROOT, "sku-template.xlsx");
const INCOME_FILE = path.join(ROOT, "income_20260718110824(UTC+7).xlsx");
const MONTH = "2026-05";

// ── Helpers ──
const columnToken = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function rupiah(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const text = String(value || "").trim();
  if (!text) return 0;
  const negative = /^-/.test(text);
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
    return (slash[3].length === 2 ? "20" + slash[3] : slash[3]) + "-" + slash[2].padStart(2, "0") + "-" + slash[1].padStart(2, "0");
  }
  const iso = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (iso) return iso[1] + "-" + iso[2].padStart(2, "0") + "-" + iso[3].padStart(2, "0");
  return "";
}

function field(row, ...names) {
  for (const name of names) if (row[name] !== undefined) return row[name];
  return "";
}

function readAllSheetRows(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  // Find actual max row
  const keys = Object.keys(sheet).filter(k => k[0] !== '!');
  let maxR = 0;
  for (const k of keys) {
    try { const c = XLSX.utils.decode_cell(k); if (c.r > maxR) maxR = c.r; } catch(e) {}
  }
  // Read headers from row 0
  const headers = [];
  for (let c = 0; c < 80; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    headers.push(cell ? String(cell.v || "").trim() : "");
  }
  // Read all data rows
  const rows = [];
  for (let r = 1; r <= maxR; r++) {
    const row = {};
    let hasData = false;
    for (let c = 0; c < headers.length; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined && cell.v !== "") {
        row[headers[c]] = cell.v;
        hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }
  return rows;
}

// ── LOAD SKU HPP ──
console.log("=== LOAD SKU HPP ===");
const skuWb = XLSX.readFile(SKU_FILE);
const skuRows = XLSX.utils.sheet_to_json(skuWb.Sheets["sku-template"], { defval: "" });

const skuHppMap = new Map();
const skuList = [];
for (const row of skuRows) {
  const token = columnToken(row.sku || "");
  const hpp = Math.abs(Number(row.hppPerUnit || 0));
  if (token && hpp > 0) { skuHppMap.set(token, hpp); skuList.push([token, hpp]); }
}
console.log(`SKU template: ${skuHppMap.size} entries`);

// Fuzzy index
const exact = new Map(), numeric = new Map();
for (const [token, hpp] of skuList) {
  exact.set(token, hpp);
  const nm = token.match(/^([a-z]+)(\d+)$/);
  if (nm) {
    if (!numeric.has(nm[1])) numeric.set(nm[1], []);
    numeric.get(nm[1]).push({ token, hpp, num: parseInt(nm[2]) });
  }
}

function getSkuHpp(skuName) {
  const token = columnToken(skuName);
  if (exact.has(token)) return exact.get(token);
  const nm = token.match(/^([a-z]+)(\d+)$/);
  if (nm && exact.has(nm[1])) return exact.get(nm[1]);
  if (nm && numeric.has(nm[1])) {
    const v = numeric.get(nm[1]);
    v.sort((a, b) => a.num - b.num);
    return v[0].hpp;
  }
  const v2 = numeric.get(token);
  if (v2) { v2.sort((a, b) => a.hpp - b.hpp); return v2[0].hpp; }
  return 0;
}

// ── LOAD ORDERS ──
console.log("\n=== LOAD ORDERS ===");
const orderWb = XLSX.readFile(path.join(DATA, "custombase_semuapesanan_mei.xlsx"), { cellDates: false, raw: true });
const orderRows = XLSX.utils.sheet_to_json(orderWb.Sheets["OrderSKUList"], { defval: "" });

const orders = [];
for (const row of orderRows) {
  const oid = String(field(row, "Order ID") || "").trim();
  const sku = String(field(row, "Seller SKU") || "").trim();
  if (!oid || !sku) continue;
  if (oid.toLowerCase().includes("platform unique order")) continue;
  const created = parseDate(field(row, "Created Time"));
  if (!created || !created.startsWith(MONTH)) continue;
  orders.push({
    orderId: oid, sku,
    status: String(field(row, "Order Status")).trim(),
    cancelReason: String(field(row, "Cancel Reason")).trim(),
    qty: Math.abs(parseInt(String(field(row, "Quantity")).trim()) || 0),
    grossProduct: rupiah(field(row, "SKU Subtotal Before Discount")),
    sellerDiscount: Math.abs(rupiah(field(row, "SKU Seller Discount"))),
    orderAmount: rupiah(field(row, "Order Amount")),
    trackingId: String(field(row, "Tracking ID")).trim(),
    packageId: String(field(row, "Package ID")).trim(),
    shippedTime: parseDate(field(row, "Shipped Time")),
  });
}

const orderGroups = new Map();
for (const o of orders) {
  if (!orderGroups.has(o.orderId)) orderGroups.set(o.orderId, []);
  orderGroups.get(o.orderId).push(o);
}
console.log(`Orders: ${orders.length} rows, ${orderGroups.size} unique`);

// ── LOAD INCOME STATEMENT (FULL) ──
console.log("\n=== LOAD INCOME STATEMENT ===");
const incomeWb = XLSX.readFile(INCOME_FILE, { cellFormula: false, cellStyles: false, cellDates: false, raw: true });
const incomeRows = readAllSheetRows(incomeWb, "Detail pesanan");
console.log(`Income rows: ${incomeRows.length}`);

const settlements = [];
for (const row of incomeRows) {
  const type = String(field(row, "Jenis transaksi")).trim();
  const oid = String(field(row, "ID Pesanan/Penyesuaian")).trim();
  if (!oid || !type) continue;
  settlements.push({
    type, orderId: oid,
    relatedId: String(field(row, "ID pesanan terkait")).trim(),
    waktuPemesanan: parseDate(field(row, "Waktu pemesanan")),
    settlement: rupiah(field(row, "Jumlah penyelesaian pembayaran")),
    afterDiscount: rupiah(field(row, "Subtotal setelah diskon penjual")),
    beforeDiscount: rupiah(field(row, "Subtotal sebelum diskon")),
    sellerDiscount: Math.abs(rupiah(field(row, "Diskon penjual"))),
    refund: Math.abs(rupiah(field(row, "Subtotal pengembalian dana setelah diskon penjual"))),
    totalFees: Math.abs(rupiah(field(row, "Total Biaya", "Jumlah biaya"))),
    gmvAdFee: Math.abs(rupiah(field(row, "Biaya iklan GMV Max"))),
    adjustment: rupiah(field(row, "Jumlah penyesuaian")),
  });
}
console.log(`Total settlements: ${settlements.length}`);

// Filter by Waktu pemesanan = May 2026
const maySettlements = settlements.filter(s => s.waktuPemesanan.startsWith(MONTH));
console.log(`Waktu pemesanan = Mei: ${maySettlements.length} rows`);

// Type breakdown
const typeBreakdown = {};
for (const s of maySettlements) {
  const t = s.type;
  if (!typeBreakdown[t]) typeBreakdown[t] = { count: 0, settlement: 0, fee: 0, refund: 0, adj: 0 };
  typeBreakdown[t].count++;
  typeBreakdown[t].settlement += s.settlement;
  typeBreakdown[t].fee += s.totalFees;
  typeBreakdown[t].refund += s.refund;
  typeBreakdown[t].adj += s.adjustment;
}
console.log("Type breakdown (May):");
for (const [t, v] of Object.entries(typeBreakdown)) {
  console.log(`  ${t}: ${v.count} rows, Settlement=Rp${v.settlement.toLocaleString("id-ID")}, Fee=Rp${v.fee.toLocaleString("id-ID")}, Refund=Rp${v.refund.toLocaleString("id-ID")}, Adj=Rp${v.adj.toLocaleString("id-ID")}`);
}

// ── LOAD IKLAN ──
console.log("\n=== LOAD IKLAN ===");
const adWb = XLSX.readFile(path.join(DATA, "custombase_iklan_mei.xlsx"), { cellDates: false, raw: true });
const adRows = XLSX.utils.sheet_to_json(adWb.Sheets["sheet1"], { defval: "" });
let iklanTopUp = 0;
for (const row of adRows) {
  const txnType = String(field(row, "Transaction type")).trim();
  const amount = rupiah(field(row, "Amount"));
  if (txnType === "Promotions" && amount > 0) iklanTopUp += amount;
}
console.log(`Iklan Top Up: Rp ${iklanTopUp.toLocaleString("id-ID")}`);

// ── GOLDEN TEST: SETTLEMENT MODE ──
console.log("\n========================================");
console.log("=== GOLDEN TEST MEI 2026 ===");
console.log("========================================");

const selesaiOrders = [], cancelValidOrders = [];
for (const [oid, rows] of orderGroups) {
  const status = rows[0].status;
  const cancelReason = columnToken(rows[0].cancelReason || "");
  const hasTracking = rows.some(r => (r.trackingId || "").trim().length > 0);
  const hasShipped = rows.some(r => (r.shippedTime || "").length > 0);
  if (status === "Selesai") selesaiOrders.push({ oid, rows });
  if (status === "Dibatalkan" && 
      (cancelReason.includes("pengirimanpaketgagal") || cancelReason.includes("pakethilang") || cancelReason.includes("gagalkirim")) &&
      (hasTracking || hasShipped)) {
    cancelValidOrders.push({ oid, rows });
  }
}

let omzetKotor = 0, diskonSeller = 0;
for (const { rows } of selesaiOrders)
  for (const r of rows) { omzetKotor += r.grossProduct; diskonSeller += r.sellerDiscount; }

const pesananSet = maySettlements.filter(s => s.type === "Pesanan");
const gmvSet = maySettlements.filter(s => {
  const t = columnToken(s.type);
  return (t.includes("gmv") || t.includes("pembayarangmv")) && t !== "pesanan";
});

const settlementCair = pesananSet.reduce((s, r) => s + r.settlement, 0);
const potonganPlatform = pesananSet.reduce((s, r) => s + r.totalFees, 0);
const refundValid = pesananSet.reduce((s, r) => s + r.refund, 0);
const penggantian = pesananSet.reduce((s, r) => s + Math.max(0, r.adjustment), 0);
const iklanGMV = gmvSet.reduce((s, r) => s + Math.abs(r.settlement), 0);

// HPP
let hppSelesai = 0, hppCV = 0;
const pkgSelesai = new Set(), pkgCV = new Set();
for (const { oid, rows } of selesaiOrders) {
  for (const r of rows) hppSelesai += r.qty * getSkuHpp(r.sku);
  pkgSelesai.add(rows.find(r => r.trackingId)?.trackingId || rows.find(r => r.packageId)?.packageId || oid);
}
for (const { oid, rows } of cancelValidOrders) {
  for (const r of rows) hppCV += r.qty * getSkuHpp(r.sku);
  pkgCV.add(rows.find(r => r.trackingId)?.trackingId || rows.find(r => r.packageId)?.packageId || oid);
}

const packingSelesai = pkgSelesai.size * 2000;
const packingCV = pkgCV.size * 2000;

// ── REPORT ──
const expected = {
  omzetKotor: 20898500, diskonSeller: 8827867, omzetNet: 12070633,
  refund: 74997, potonganPlatform: 3223291, settlementCair: 8772345,
  penggantian: 32998, iklanTopUp: 1665000, iklanGMV: 1472709,
};

const actual = {
  omzetKotor, diskonSeller, omzetNet: omzetKotor - diskonSeller,
  refund: refundValid, potonganPlatform, settlementCair,
  penggantian, iklanTopUp, iklanGMV,
  hppSelesai, hppCV, packingSelesai, packingCV,
  hppPacking: hppSelesai + hppCV + packingSelesai + packingCV,
  selesaiOrders: selesaiOrders.length, cancelValid: cancelValidOrders.length,
  pesananRows: pesananSet.length, gmvRows: gmvSet.length,
};

console.log("\n| Metric | Expected | Actual | Status |");
console.log("|--------|----------|--------|--------|");
for (const [key, exp] of Object.entries(expected)) {
  const act = actual[key] || 0;
  const diff = act - exp;
  const icon = diff === 0 ? "✅" : `❌ diff ${diff.toLocaleString("id-ID")}`;
  console.log(`| ${key} | ${exp.toLocaleString("id-ID")} | ${act.toLocaleString("id-ID")} | ${icon} |`);
}

console.log(`\nAdditional:`);
console.log(`  Selesai: ${selesaiOrders.length} orders, Cancel Valid: ${cancelValidOrders.length}`);
console.log(`  Pesanan rows (income): ${pesananSet.length}, GMV rows: ${gmvSet.length}`);
console.log(`  HPP Selesai: Rp${hppSelesai.toLocaleString("id-ID")}`);
console.log(`  HPP CV: Rp${hppCV.toLocaleString("id-ID")}`);
console.log(`  Packing Selesai: ${pkgSelesai.size} pkt = Rp${packingSelesai.toLocaleString("id-ID")}`);
console.log(`  Packing CV: ${pkgCV.size} pkt = Rp${packingCV.toLocaleString("id-ID")}`);
console.log(`  Total HPP+Packing: Rp${(hppSelesai+hppCV+packingSelesai+packingCV).toLocaleString("id-ID")}`);

// Settlement matching
const orderIdSet = new Set(orders.map(o => o.orderId));
let matched = 0, unmatched = 0;
const unmatchedSample = [];
for (const s of maySettlements) {
  if (s.type !== "Pesanan") continue;
  const oid = s.relatedId && s.relatedId !== "/" ? s.relatedId : s.orderId;
  if (orderIdSet.has(oid)) matched++;
  else { unmatched++; if (unmatchedSample.length < 5) unmatchedSample.push(oid); }
}
console.log(`\nSettlement match: ${matched} matched, ${unmatched} unmatched to order May`);
if (unmatchedSample.length) console.log(`  Sample unmatched: ${unmatchedSample.join(", ")}`);
