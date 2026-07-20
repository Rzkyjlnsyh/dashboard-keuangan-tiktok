/**
 * AUDIT KOMPREHENSIF - SEMUA BULAN, SEMUA TOKO, FUZZY SKU MATCHING
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data tiktok");
const SKU_FILE = path.join(ROOT, "sku-template.xlsx");

// ── Helpers ──
const columnToken = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const cleanCol = (v) => String(v || "").replace(/\n/g, " ").trim();

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

// ── FUZZY SKU MATCHING ──
function tokenizeForMatch(s) {
  return columnToken(s).replace(/[^a-z0-9]/g, "");
}

function buildFuzzyIndex(skuList) {
  // Build multiple indexes: exact, prefix, numeric pattern
  const exact = new Map();   // token -> hpp
  const prefix = new Map();  // prefix -> hpp (for POLA25pcs vs POLA)
  const numeric = new Map(); // pattern like "Polaroid25" -> base "Polaroid" + number
  
  for (const [token, hpp] of skuList) {
    exact.set(token, hpp);
    
    // Prefix indexing (first 3 chars)
    for (let i = 3; i <= token.length; i++) {
      const p = token.slice(0, i);
      if (!prefix.has(p)) prefix.set(p, []);
      prefix.get(p).push({ token, hpp });
    }
    
    // Numeric pattern: extract base name + number
    const numMatch = token.match(/^([a-z]+)(\d+)$/);
    if (numMatch) {
      const base = numMatch[1];
      const num = parseInt(numMatch[2]);
      if (!numeric.has(base)) numeric.set(base, []);
      numeric.get(base).push({ token, hpp, num });
    }
  }
  
  return { exact, prefix, numeric };
}

function fuzzyMatchSku(skuToken, index, skuList) {
  // 1. Exact match
  if (index.exact.has(skuToken)) return index.exact.get(skuToken);
  
  // 2. Check if it's a numeric variation (e.g., POLA = POLA1)
  const numMatch = skuToken.match(/^([a-z]+)(\d+)$/);
  if (numMatch) {
    const base = numMatch[1];
    const num = parseInt(numMatch[2]);
    
    // Check if base exists (e.g., "POLA" for "POLA25")
    if (index.exact.has(base)) return index.exact.get(base);
    
    // Check other numbers with same base (e.g., HOLO1 -> HOLO)
    const variants = index.numeric.get(base) || [];
    // Find closest number
    if (variants.length > 0) {
      variants.sort((a, b) => a.num - b.num);
      return variants[0].hpp; // Use first variant's HPP
    }
  }
  
  // 3. Check if it's just a base name without number (e.g., "POLA" should match "POLA25pcs")
  const baseVariants = index.numeric.get(skuToken) || [];
  if (baseVariants.length > 0) {
    // Return the lowest HPP (typically the smallest pack)
    baseVariants.sort((a, b) => a.hpp - b.hpp);
    return baseVariants[0].hpp;
  }
  
  // 4. Prefix matching (longest prefix match)
  const prefixes = index.prefix.get(skuToken.slice(0, Math.min(6, skuToken.length))) || [];
  if (prefixes.length === 1) return prefixes[0].hpp;
  
  return null; // No match
}

// ── LOAD SKU HPP ──
console.log("=== LOAD SKU HPP ===");
const skuWb = XLSX.readFile(SKU_FILE);
const skuSheet = skuWb.Sheets["sku-template"];
const skuRows = XLSX.utils.sheet_to_json(skuSheet, { defval: "" });

const skuHppMap = new Map();
const skuList = [];
for (const row of skuRows) {
  const sku = cleanCol(row.sku || "");
  const token = columnToken(sku);
  const hpp = Math.abs(Number(row.hppPerUnit || 0));
  const packing = Math.abs(Number(row.packingPerUnit || 0));
  if (token && hpp > 0) {
    skuHppMap.set(token, { sku, hpp, packing });
    skuList.push([token, hpp]);
  }
}
console.log(`SKU template: ${skuHppMap.size} entries`);
const fuzzyIndex = buildFuzzyIndex(skuList);

// ── PROCESS ALL CUSTOMBASE DATA ──
const STORE = "custombase";
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07"];
const storeDir = path.join(DATA, "CUSTOMBASE");

// Collect all orders
const allOrders = [];
const orderFileMonths = {};

for (const month of MONTHS) {
  const file = path.join(storeDir, `custombase_semuapesanan_${["april","mei","juni","juli"][MONTHS.indexOf(month)]}.xlsx`);
  if (!fs.existsSync(file)) continue;
  
  const wb = XLSX.readFile(file, { cellDates: false, raw: true });
  const sheet = wb.Sheets["OrderSKUList"];
  if (!sheet) continue;
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  
  let count = 0;
  for (const row of rows) {
    const oid = String(field(row, "Order ID") || "").trim();
    const sku = String(field(row, "Seller SKU") || "").trim();
    if (!oid || !sku) continue;
    if (oid.toLowerCase().includes("platform unique order")) continue;
    const created = parseDate(field(row, "Created Time"));
    if (!created || !created.startsWith(month)) continue;
    
    allOrders.push({
      orderId: oid, sku, month,
      status: String(field(row, "Order Status")).trim(),
      cancelReason: String(field(row, "Cancel Reason")).trim(),
      qty: Math.abs(parseInt(String(field(row, "Quantity")).trim()) || 0),
      grossProduct: rupiah(field(row, "SKU Subtotal Before Discount")),
      sellerDiscount: Math.abs(rupiah(field(row, "SKU Seller Discount"))),
      platformDiscount: Math.abs(rupiah(field(row, "SKU Platform Discount"))),
      orderAmount: rupiah(field(row, "Order Amount")),
      trackingId: String(field(row, "Tracking ID")).trim(),
      packageId: String(field(row, "Package ID")).trim(),
      shippedTime: parseDate(field(row, "Shipped Time")),
      createdTime: created,
    });
    count++;
  }
  orderFileMonths[month] = count;
}

console.log(`\nOrders collected:`);
for (const [m, c] of Object.entries(orderFileMonths)) console.log(`  ${m}: ${c} rows`);

// Collect all settlements
const allSettlements = [];
for (const month of MONTHS) {
  const file = path.join(storeDir, `custombase_penarikandana_${["april","mei","juni","juli"][MONTHS.indexOf(month)]}.xlsx`);
  if (!fs.existsSync(file)) continue;
  
  const wb = XLSX.readFile(file, { cellDates: false, raw: true });
  const sheet = wb.Sheets["Detail pesanan"];
  if (!sheet) continue;
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  
  for (const row of rows) {
    const type = String(field(row, "Jenis transaksi")).trim();
    const oid = String(field(row, "ID Pesanan/Penyesuaian")).trim();
    if (!oid || oid === "ID Pesanan/Penyesuaian") continue;
    
    allSettlements.push({
      type,
      orderId: oid,
      relatedId: String(field(row, "ID pesanan terkait")).trim(),
      waktuPemesanan: parseDate(field(row, "Waktu pemesanan")),
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
      sourceFile: month,
    });
  }
}
console.log(`\nSettlements: ${allSettlements.length} total`);

// ── FILTER BY TARGET MONTH (MEI 2026) ──
const TARGET = "2026-05";
const mayOrders = allOrders.filter(o => o.month === TARGET);
const mayOrderGroups = new Map();
for (const o of mayOrders) {
  if (!mayOrderGroups.has(o.orderId)) mayOrderGroups.set(o.orderId, []);
  mayOrderGroups.get(o.orderId).push(o);
}

// Orders with Waktu pemesanan = Mei from ALL settlement files
const maySettlements = allSettlements.filter(s => s.waktuPemesanan.startsWith(TARGET));

// ── FUZZY MATCH SKU HPP ──
const skuMatchCache = new Map();
const unmatchedSkus = new Set();
const suspiciousSkus = [];

function getSkuHpp(skuName) {
  const token = columnToken(skuName);
  if (skuMatchCache.has(token)) return skuMatchCache.get(token);
  
  const match = fuzzyMatchSku(token, fuzzyIndex, skuList);
  if (match !== null) {
    skuMatchCache.set(token, match);
    return match;
  }
  
  unmatchedSkus.add(skuName);
  skuMatchCache.set(token, 0);
  return 0;
}

// ── COMPUTE GOLDEN TEST ──
console.log("\n========================================");
console.log(`=== GOLDEN TEST MEI 2026 - ${STORE.toUpperCase()} ===`);
console.log("========================================");

// Selesai & Cancel Valid
const selesaiOrders = [], cancelValidOrders = [];
for (const [oid, rows] of mayOrderGroups) {
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

console.log(`Order Selesai: ${selesaiOrders.length}`);
console.log(`Cancel Valid: ${cancelValidOrders.length}`);

// Omzet Kotor & Diskon
let omzetKotor = 0, diskonSeller = 0;
for (const { rows } of selesaiOrders) {
  for (const r of rows) {
    omzetKotor += r.grossProduct;
    diskonSeller += r.sellerDiscount;
  }
}
console.log(`Omzet Kotor: Rp ${omzetKotor.toLocaleString("id-ID")}`);
console.log(`Diskon Seller: Rp ${diskonSeller.toLocaleString("id-ID")}`);
console.log(`Omzet Net: Rp ${(omzetKotor - diskonSeller).toLocaleString("id-ID")}`);

// Settlement (dari SEMUA file, filter Waktu pemesanan Mei)
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

console.log(`\nSettlement (Pesanan, Waktu pemesanan Mei): ${pesananSet.length} rows`);
console.log(`Settlement Cair: Rp ${settlementCair.toLocaleString("id-ID")}`);
console.log(`Potongan Platform: Rp ${potonganPlatform.toLocaleString("id-ID")}`);
console.log(`Refund: Rp ${refundValid.toLocaleString("id-ID")}`);
console.log(`Penggantian: Rp ${penggantian.toLocaleString("id-ID")}`);
console.log(`GMV Ads: ${gmvSet.length} rows, Rp ${iklanGMV.toLocaleString("id-ID")}`);

// Iklan Top Up
const adFile = path.join(storeDir, "custombase_iklan_mei.xlsx");
let iklanTopUp = 0;
if (fs.existsSync(adFile)) {
  const adWb = XLSX.readFile(adFile, { cellDates: false, raw: true });
  const adSheet = adWb.Sheets["sheet1"];
  const adRows = XLSX.utils.sheet_to_json(adSheet, { defval: "" });
  for (const row of adRows) {
    const txnType = String(field(row, "Transaction type")).trim();
    const amount = rupiah(field(row, "Amount"));
    if (txnType === "Promotions" && amount > 0) iklanTopUp += amount;
  }
}
console.log(`\nIklan Top Up: Rp ${iklanTopUp.toLocaleString("id-ID")}`);

// HPP + Packing
let hppSelesai = 0, hppCV = 0;
const pkgSelesai = new Set(), pkgCV = new Set();

for (const { oid, rows } of selesaiOrders) {
  for (const r of rows) {
    hppSelesai += r.qty * getSkuHpp(r.sku);
  }
  const pk = rows.find(r => r.trackingId)?.trackingId || rows.find(r => r.packageId)?.packageId || oid;
  pkgSelesai.add(pk);
}

for (const { oid, rows } of cancelValidOrders) {
  for (const r of rows) {
    hppCV += r.qty * getSkuHpp(r.sku);
  }
  const pk = rows.find(r => r.trackingId)?.trackingId || rows.find(r => r.packageId)?.packageId || oid;
  pkgCV.add(pk);
}

const packingSelesai = pkgSelesai.size * 2000;
const packingCV = pkgCV.size * 2000;
const totalHpp = hppSelesai + hppCV;
const totalPacking = packingSelesai + packingCV;

console.log(`\nHPP Selesai: Rp ${hppSelesai.toLocaleString("id-ID")}`);
console.log(`HPP Cancel Valid: Rp ${hppCV.toLocaleString("id-ID")}`);
console.log(`Packing Selesai: ${pkgSelesai.size} pkt x 2000 = Rp ${packingSelesai.toLocaleString("id-ID")}`);
console.log(`Packing CV: ${pkgCV.size} pkt x 2000 = Rp ${packingCV.toLocaleString("id-ID")}`);
console.log(`TOTAL HPP+Packing: Rp ${(totalHpp + totalPacking).toLocaleString("id-ID")}`);

// Profit
const totalBiaya = totalHpp + totalPacking + iklanTopUp + iklanGMV;
const netTransaksi = settlementCair + penggantian - refundValid;
const profit = netTransaksi - totalHpp - totalPacking - iklanTopUp - iklanGMV;
console.log(`\nNet Transaksi: Rp ${netTransaksi.toLocaleString("id-ID")}`);
console.log(`Total Biaya: Rp ${totalBiaya.toLocaleString("id-ID")}`);
console.log(`Profit: Rp ${profit.toLocaleString("id-ID")}`);

// ── EXPECTED vs ACTUAL ──
console.log("\n========================================");
console.log("=== PERBANDINGAN EXPECTED vs ACTUAL ===");
console.log("========================================");

const expected = {
  omzetKotor: 20898500, diskonSeller: 8827867, omzetNet: 12070633,
  refund: 74997, potonganPlatform: 3223291, settlementCair: 8772345,
  penggantian: 32998, iklanTopUp: 1665000, iklanGMV: 1472709,
};

const actual = {
  omzetKotor, diskonSeller, omzetNet: omzetKotor - diskonSeller,
  refund: refundValid, potonganPlatform, settlementCair,
  penggantian, iklanTopUp, iklanGMV,
};

for (const [key, exp] of Object.entries(expected)) {
  const act = actual[key] || 0;
  const diff = act - exp;
  const icon = diff === 0 ? "✅" : "❌";
  console.log(`${icon} ${key}: expected ${exp.toLocaleString("id-ID")} | actual ${act.toLocaleString("id-ID")} | diff ${diff.toLocaleString("id-ID")}`);
}

// ── SKU UNMATCHED ──
console.log("\n========================================");
console.log("=== SKU TANPA HPP (setelah fuzzy match) ===");
console.log("========================================");
console.log(`Total unique SKU in orders: ${new Set(mayOrders.map(o => columnToken(o.sku))).size}`);
console.log(`Matched (exact + fuzzy): ${skuMatchCache.size}`);
console.log(`Still unmatched: ${unmatchedSkus.size}`);

if (unmatchedSkus.size > 0) {
  console.log("\nUNMATCHED SKUs:");
  const sorted = Array.from(unmatchedSkus).sort();
  for (const sku of sorted) console.log(`  - ${sku}`);
}

// Suggest fuzzy matches for unmatched
console.log("\n=== FUZZY MATCH SUGGESTIONS ===");
for (const sku of unmatchedSkus) {
  const token = columnToken(sku);
  // Try to find closest match
  let best = null, bestScore = 0;
  for (const [t, info] of skuHppMap) {
    // Simple similarity: longest common prefix
    let i = 0;
    while (i < token.length && i < t.length && token[i] === t[i]) i++;
    const score = i / Math.max(token.length, t.length);
    if (score > bestScore && score > 0.4) {
      bestScore = score;
      best = { sku: info.sku, token: t, hpp: info.hpp, score };
    }
  }
  if (best) {
    console.log(`  ${sku} -> ${best.sku} (${(best.score*100).toFixed(0)}% match, HPP=${best.hpp})`);
  } else {
    console.log(`  ${sku} -> NO MATCH FOUND (perlu HPP manual)`);
  }
}

// ── SUMMARY ──
console.log("\n========================================");
console.log("=== SUMMARY ===");
console.log("========================================");
console.log(`File diproses: ${Object.keys(orderFileMonths).length} order + ${MONTHS.filter(m => fs.existsSync(path.join(storeDir, `custombase_penarikandana_${["april","mei","juni","juli"][MONTHS.indexOf(m)]}.xlsx`))).length} settlement`);
console.log(`Total orders: ${allOrders.length} rows, ${new Set(allOrders.map(o => o.orderId)).size} unique`);
console.log(`May orders: ${mayOrders.length} rows, ${mayOrderGroups.size} unique`);
console.log(`Total settlements: ${allSettlements.length} rows`);
console.log(`May settlements (by waktu pemesanan): ${maySettlements.length} rows`);
