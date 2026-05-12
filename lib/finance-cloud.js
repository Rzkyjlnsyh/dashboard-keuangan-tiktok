const DEFAULT_STORES = ["ventura", "giftyours", "custombase"];
const DEFAULT_STORE = "ventura";
let generatedIdCounter = 0;

const SECRET_TOTAL_KEYS = [
  "profit",
  "profitBeforeAds",
  "adSpend",
  "sellerDiscount",
  "cancelledAmount",
  "platformFee",
  "platformDiscount",
  "hpp",
  "packing",
  "refund",
  "settlement",
  "finalProfit",
  "estimatedProfit",
  "finalProfitBeforeAds",
  "estimatedProfitBeforeAds",
  "finalAdSpend",
  "estimatedAdSpend",
  "finalMargin",
  "estimatedMargin",
  "bookPlatformFee",
  "bookHpp",
  "bookPacking",
  "bookSettlement",
  "bookHeld",
  "bookProfit",
  "bookProfitBeforeAds",
  "bookAdSpend",
  "bookMargin",
  "bookCancelledAmount",
];

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function nowIso() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" });
}

function generatedBigIntId() {
  generatedIdCounter = (generatedIdCounter + 1) % 1_000_000;
  return `${Date.now()}${String(generatedIdCounter).padStart(6, "0")}`;
}

function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function cleanCol(value) {
  return String(value || "").replace(/\n/g, " ").trim();
}

function columnToken(value) {
  return cleanCol(value)
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isCancelledStatus(status) {
  const token = columnToken(status);
  return ["dibatalkan", "cancellations", "cancelled", "canceled", "cancel", "returned", "returnrefund"].includes(token);
}

function isUnpaidStatus(status) {
  return ["unpaid", "belumbayar", "pendingpayment"].includes(columnToken(status));
}

function hasIncomeSettlement(row) {
  const source = columnToken(row.source);
  const file = columnToken(row.last_seen_file);
  return source === "incomestatement" || file.includes("income") || file.includes("settlementstatement");
}

function isBookSource(row) {
  const source = columnToken(row.source);
  return ["settlement", "incomestatement"].includes(source) || hasIncomeSettlement(row);
}

function actualSettlementAmount(row) {
  return hasIncomeSettlement(row) ? Math.abs(Number(row.settlement_received || 0)) : 0;
}

function rupiah(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const text = String(value || "").trim();
  if (!text) return 0;
  const negative = /^-/.test(text) || /^\(.*\)$/.test(text);
  let normalized = text.replace(/[^\d,.-]/g, "");
  const commaCount = (normalized.match(/,/g) || []).length;
  const dotCount = (normalized.match(/\./g) || []).length;
  if (commaCount > 1 && dotCount === 0) {
    normalized = normalized.replace(/,/g, "");
  } else if (dotCount > 1 && commaCount === 0) {
    normalized = normalized.replace(/\./g, "");
  } else if (commaCount && dotCount) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    normalized = lastComma > lastDot
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (commaCount === 1) {
    const [head, tail] = normalized.split(",");
    normalized = tail.length === 3 ? `${head}${tail}` : `${head}.${tail}`;
  } else if (dotCount === 1) {
    const [head, tail] = normalized.split(".");
    normalized = tail.length === 3 ? `${head}${tail}` : normalized;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.abs(parsed) * (negative ? -1 : 1));
}

function parseDate(value) {
  if (!value) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const base = Date.UTC(1899, 11, 30);
    const parsed = new Date(base + value * 86400000);
    return parsed.toISOString().slice(0, 19).replace("T", " ");
  }
  const raw = String(value).replace(/\t/g, " ").trim();
  if (!raw) return "";
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (slash) {
    const day = slash[1].padStart(2, "0");
    const month = slash[2].padStart(2, "0");
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    const hour = (slash[4] || "00").padStart(2, "0");
    const minute = (slash[5] || "00").padStart(2, "0");
    const second = (slash[6] || "00").padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const year = iso[1];
    const month = iso[2].padStart(2, "0");
    const day = iso[3].padStart(2, "0");
    const hour = (iso[4] || "00").padStart(2, "0");
    const minute = (iso[5] || "00").padStart(2, "0");
    const second = (iso[6] || "00").padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeStore(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || ["nan", "none", "tiktok", "pare custom", "pare digital custom", "tiktok - pare custom"].includes(raw)) return DEFAULT_STORE;
  if (raw.includes("ventura")) return "ventura";
  if (raw.includes("giftyours") || raw.includes("gift yours")) return "giftyours";
  if (raw.includes("custombase") || raw.includes("custom base")) return "custombase";
  const matched = DEFAULT_STORES.find(store => raw === store);
  return matched || raw.replace(/\s+/g, "-");
}

function lineKey(storeName, orderId, sku, variation) {
  return `${normalizeStore(storeName)}|${orderId || ""}|${sku || ""}|${variation || ""}`.trim().toLowerCase();
}

function supabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "";
  return { url: url.replace(/\/$/, ""), key };
}

function supabaseConfigured() {
  const env = supabaseEnv();
  return Boolean(env.url && env.key);
}

function supabaseSetupMessage() {
  return "Supabase belum tersambung. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di Vercel, lalu jalankan SQL di supabase/schema.sql. Untuk testing cepat bisa pakai SUPABASE_ANON_KEY, tetapi produksi sebaiknya memakai service_role/sb_secret di backend.";
}

async function supabaseRequest(path, options = {}) {
  const env = supabaseEnv();
  if (!env.url || !env.key) throw new Error(supabaseSetupMessage());
  const headers = {
    apikey: env.key,
    Authorization: `Bearer ${env.key}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const response = await fetch(`${env.url}/rest/v1/${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message = data && typeof data === "object" ? (data.message || data.details || data.hint) : data;
    throw new Error(message || `Supabase error ${response.status}`);
  }
  return data;
}

async function fetchAll(table, query = "") {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const path = `${table}${query ? `?${query}` : ""}`;
    const chunk = await supabaseRequest(path, {
      method: "GET",
      headers: { Range: `${from}-${from + pageSize - 1}` },
    });
    const list = Array.isArray(chunk) ? chunk : [];
    rows.push(...list);
    if (list.length < pageSize) break;
  }
  return rows;
}

async function upsertRows(table, rows, conflictKey) {
  if (!rows.length) return [];
  const saved = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const result = await supabaseRequest(`${table}?on_conflict=${encodeURIComponent(conflictKey)}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(chunk),
    });
    if (Array.isArray(result)) saved.push(...result);
  }
  return saved;
}

async function insertRows(table, rows) {
  if (!rows.length) return [];
  const saved = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const result = await supabaseRequest(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(chunk),
    });
    if (Array.isArray(result)) saved.push(...result);
  }
  return saved;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function emptySummary(message = supabaseSetupMessage()) {
  return {
    generatedAt: nowIso(),
    totals: {
      orders: 0,
      lines: 0,
      qty: 0,
      gross: 0,
      omzet: 0,
      platformFee: 0,
      platformDiscount: 0,
      hpp: 0,
      packing: 0,
      refund: 0,
      settlement: 0,
      held: 0,
      profit: 0,
      profitBeforeAds: 0,
      adSpend: 0,
      todayOrders: 0,
      margin: 0,
      finalProfit: 0,
      estimatedProfit: 0,
      finalProfitBeforeAds: 0,
      estimatedProfitBeforeAds: 0,
      finalAdSpend: 0,
      estimatedAdSpend: 0,
      finalOmzet: 0,
      estimatedOmzet: 0,
      finalOrders: 0,
      estimatedOrders: 0,
      heldOrders: 0,
      bookOrders: 0,
      bookCancelledOrders: 0,
      bookGross: 0,
      bookSellerDiscount: 0,
      bookOmzet: 0,
      bookPlatformFee: 0,
      bookSettlement: 0,
      bookHpp: 0,
      bookPacking: 0,
      bookRefund: 0,
      bookCancelledAmount: 0,
      bookHeld: 0,
      bookProfit: 0,
      bookProfitBeforeAds: 0,
      bookAdSpend: 0,
      finalMargin: 0,
      estimatedMargin: 0,
      bookMargin: 0,
    },
    daily: [],
    topSku: [],
    weakSku: [],
    skuDetails: [],
    skuSummary: { total: 0, profitable: 0, watch: 0, bad: 0, missingCost: 0, best: null, weakest: null },
    stores: DEFAULT_STORES.map(store => ({ store, orders: 0, omzet: 0, profit: 0 })),
    status: [],
    missingCost: [],
    alerts: [{ level: "warn", title: "Supabase belum siap", body: message }],
    assistant: {
      score: 0,
      health: "Menunggu Supabase",
      forecast30Omzet: 0,
      forecast30Profit: 0,
      accounting: {
        pendapatan: 0,
        omzetKotor: 0,
        diskonSeller: 0,
        omzetNet: 0,
        settlementCair: 0,
        hppPacking: 0,
        hpp: 0,
        packing: 0,
        potonganPlatform: 0,
        biayaIklan: 0,
        totalBiaya: 0,
        danaTertahan: 0,
        refund: 0,
        returCancel: 0,
        profitBersih: 0,
        profitEstimasi: 0,
        profitFinal: 0,
        profitBelumFinal: 0,
        omsetFinal: 0,
        omsetBelumFinal: 0,
      },
      insights: [message],
      actions: ["Sambungkan environment Supabase di Vercel agar dashboard online bisa membaca dan menyimpan data real."],
    },
    filters: { preset: "all", month: "", store: "all", startDate: "", endDate: "" },
    availableMonths: Array.from({ length: 12 }, (_, index) => `${new Date().getFullYear()}-${String(12 - index).padStart(2, "0")}`),
    availableStores: DEFAULT_STORES,
    adSpendRows: [],
    runs: [],
    auditEvents: [],
  };
}

function dateRangeFromFilters(filters) {
  const today = todayIso();
  const todayDate = new Date(`${today}T00:00:00Z`);
  if (filters.preset === "last7") {
    const start = new Date(todayDate);
    start.setUTCDate(start.getUTCDate() - 6);
    return [start.toISOString().slice(0, 10), today];
  }
  if (filters.preset === "last14") {
    const start = new Date(todayDate);
    start.setUTCDate(start.getUTCDate() - 13);
    return [start.toISOString().slice(0, 10), today];
  }
  if (filters.preset === "thisMonth") return [today.slice(0, 8) + "01", today];
  if (filters.preset === "month" && filters.month) {
    const [year, month] = filters.month.split("-").map(Number);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(Date.UTC(year, month, 0));
    return [start, endDate.toISOString().slice(0, 10)];
  }
  return ["", ""];
}

function buildFilters(query = {}) {
  const preset = ["all", "last7", "last14", "thisMonth", "month"].includes(query.preset) ? query.preset : "all";
  const store = query.store && query.store !== "all" ? normalizeStore(query.store) : "all";
  return { preset, month: query.month || "", store };
}

function field(row, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  }
  const lowered = {};
  const tokened = {};
  for (const [key, value] of Object.entries(row)) lowered[cleanCol(key).toLowerCase()] = value;
  for (const [key, value] of Object.entries(row)) tokened[columnToken(key)] = value;
  for (const name of names) {
    const value = lowered[cleanCol(name).toLowerCase()];
    if (value !== undefined) return value;
  }
  for (const name of names) {
    const value = tokened[columnToken(name)];
    if (value !== undefined) return value;
  }
  return "";
}

function detectKind(rows, requestedKind) {
  const normalized = String(requestedKind || "auto").toLowerCase();
  const first = rows[0] || {};
  const keys = Object.keys(first);
  const cols = new Set(keys.map(columnToken));
  const joined = keys.map(columnToken).join("|");
  const has = (...names) => names.some(name => {
    const token = columnToken(name);
    return cols.has(token) || joined.includes(token);
  });
  const looksIncome = has("Order/adjustment ID", "Order adjustment ID") &&
    has("Total settlement amount") &&
    has("Total Revenue", "Subtotal after seller discounts", "Total Fees");
  if (["sku", "orders", "order", "settlement", "pencairan", "income"].includes(normalized) && normalized !== "auto") {
    if (["settlement", "pencairan", "income"].includes(normalized) && looksIncome) return "income";
    return normalized === "order" ? "orders" : normalized === "pencairan" ? "settlement" : normalized;
  }
  if (
    has("sku", "seller sku", "sku marketplace") &&
    has("hppPerUnit", "hpp_per_unit", "hpp", "packingPerUnit", "packing_per_unit", "packing")
  ) return "sku";
  if (
    has("Order ID", "order id") &&
    has("Seller SKU", "seller sku") &&
    has("SKU Subtotal Before Discount", "Order Status", "Order Amount")
  ) return "settlement";
  if (looksIncome) return "income";
  if (
    has("Nomor Pesanan (di Marketplace)", "Nomor Pesanan (di Desty)", "nomor pesanan di marketplace") &&
    has("SKU Marketplace", "sku marketplace")
  ) return "orders";
  return "unknown";
}

function mapSkuRows(rows, storeName) {
  const store = ["", "all", "semua", "global"].includes(String(storeName || "").toLowerCase()) ? "global" : normalizeStore(storeName);
  return rows.map(row => {
    const sku = String(field(row, "sku")).trim();
    if (!sku) return null;
    return {
      sku_key: `${store}|${sku.toLowerCase()}`,
      store_name: store,
      sku,
      product_name: String(field(row, "productName", "product_name", "Nama Produk")).trim(),
      hpp_per_unit: Math.abs(rupiah(field(row, "hppPerUnit", "hpp_per_unit", "HPP"))),
      packing_per_unit: Math.abs(rupiah(field(row, "packingPerUnit", "packing_per_unit", "Packing"))),
      updated_at: nowIso(),
    };
  }).filter(Boolean);
}

function mapOrderRows(rows, storeName, filename) {
  const selectedStore = storeName ? normalizeStore(storeName) : "";
  return rows.map(row => {
    const orderId = String(field(row, "Nomor Pesanan (di Marketplace)")).replace(".0", "").trim();
    const sku = String(field(row, "SKU Marketplace")).trim();
    if (!orderId || !sku) return null;
    const qty = Math.abs(rupiah(field(row, "Jumlah")));
    const unitPrice = Math.abs(rupiah(field(row, "Harga Satuan")));
    const rowStore = selectedStore || normalizeStore(field(row, "Channel - Nama Toko") || DEFAULT_STORE);
    const variation = String(field(row, "Varian Produk")).trim();
    return {
      line_key: lineKey(rowStore, orderId, sku, variation),
      order_id: orderId,
      store_name: rowStore,
      source: "desty_order",
      created_at: parseDate(field(row, "Tanggal Pesanan Dibuat")),
      updated_at: parseDate(field(row, "Waktu Pesanan (Update)")),
      status: String(field(row, "Status Pesanan")).trim(),
      sku,
      product_name: String(field(row, "Nama Produk")).trim(),
      variation,
      quantity: qty,
      unit_price: unitPrice,
      gross_product: Math.abs(rupiah(field(row, "Subtotal Produk"))) || unitPrice * qty,
      seller_discount: Math.abs(rupiah(field(row, "Diskon Penjual"))),
      platform_discount: 0,
      platform_fee: Math.abs(rupiah(field(row, "Biaya Layanan"))) + Math.abs(rupiah(field(row, "Pajak"))),
      refund_amount: Math.abs(rupiah(field(row, "Refund"))),
      order_amount: Math.abs(rupiah(field(row, "Total Faktur"))) || Math.abs(rupiah(field(row, "Total Penjualan"))),
      settlement_received: 0,
      payment_method: String(field(row, "Metode Pembayaran")).trim(),
      tracking_id: String(field(row, "Nomor AWB/Resi")).trim(),
      last_seen_file: filename,
      last_seen_at: nowIso(),
    };
  }).filter(Boolean);
}

function mapSettlementRows(rows, storeName, filename) {
  const selectedStore = storeName ? normalizeStore(storeName) : DEFAULT_STORE;
  return rows.map(row => {
    const orderId = String(field(row, "Order ID")).replace(".0", "").trim();
    const sku = String(field(row, "Seller SKU")).trim();
    if (!orderId || !sku) return null;
    const status = String(field(row, "Order Status")).trim();
    const beforeDiscount = Math.abs(rupiah(field(row, "SKU Subtotal Before Discount")));
    const sellerDiscount = Math.abs(rupiah(field(row, "SKU Seller Discount")));
    const rowStore = selectedStore || normalizeStore(field(row, "Warehouse Name") || DEFAULT_STORE);
    const variation = String(field(row, "Variation")).trim();
    const platformFee =
      Math.abs(rupiah(field(row, "Buyer Service Fee"))) +
      Math.abs(rupiah(field(row, "Handling Fee"))) +
      Math.abs(rupiah(field(row, "Shipping Insurance"))) +
      Math.abs(rupiah(field(row, "Item Insurance")));
    return {
      line_key: lineKey(rowStore, orderId, sku, variation),
      order_id: orderId,
      store_name: rowStore,
      source: "settlement",
      created_at: parseDate(field(row, "Created Time")),
      updated_at: parseDate(field(row, "Delivered Time") || field(row, "Paid Time")),
      status,
      sku,
      product_name: String(field(row, "Product Name")).trim(),
      variation,
      quantity: Math.abs(rupiah(field(row, "Quantity"))),
      unit_price: Math.abs(rupiah(field(row, "SKU Unit Original Price"))),
      gross_product: beforeDiscount,
      seller_discount: sellerDiscount,
      platform_discount: Math.abs(rupiah(field(row, "SKU Platform Discount"))) + Math.abs(rupiah(field(row, "Payment platform discount"))),
      platform_fee: platformFee,
      refund_amount: Math.abs(rupiah(field(row, "Order Refund Amount"))),
      order_amount: beforeDiscount - sellerDiscount,
      settlement_received: 0,
      payment_method: String(field(row, "Payment Method")).trim(),
      tracking_id: String(field(row, "Tracking ID")).trim(),
      last_seen_file: filename,
      last_seen_at: nowIso(),
    };
  }).filter(Boolean);
}

function mapIncomeRows(rows, storeName, filename) {
  const selectedStore = normalizeStore(storeName || DEFAULT_STORE);
  return rows.map(row => {
    const transactionId = String(field(row, "Order/adjustment ID", "Order adjustment ID")).replace(".0", "").trim();
    const relatedOrderId = String(field(row, "Related order ID")).replace(".0", "").trim();
    const type = String(field(row, "Type")).trim();
    const orderId = (relatedOrderId && relatedOrderId !== "/" ? relatedOrderId : transactionId).trim();
    if (!orderId) return null;
    const settlement = rupiah(field(row, "Total settlement amount"));
    const totalRevenue = rupiah(field(row, "Total Revenue"));
    const afterDiscount = rupiah(field(row, "Subtotal after seller discounts"));
    const beforeDiscount = rupiah(field(row, "Subtotal before discounts"));
    const sellerDiscount = Math.abs(rupiah(field(row, "Seller discounts")));
    const refund = Math.abs(rupiah(field(row, "Refund subtotal after seller discounts")));
    const totalFees = Math.abs(rupiah(field(row, "Total Fees")));
    const adjustment = rupiah(field(row, "Ajustment amount", "Adjustment amount"));
    return {
      orderId,
      transactionId,
      type,
      storeName: selectedStore,
      createdAt: parseDate(field(row, "Order created time")),
      settledAt: parseDate(field(row, "Order settled time")),
      settlement,
      totalRevenue,
      afterDiscount,
      beforeDiscount,
      sellerDiscount,
      refund,
      totalFees,
      adjustment,
      filename,
    };
  }).filter(Boolean);
}

function auditChanges(existing, next) {
  if (!existing) return [["inserted", "order", "", next.order_amount || ""]];
  const fields = ["status", "order_amount", "settlement_received", "platform_fee", "refund_amount", "tracking_id", "quantity"];
  const changes = [];
  for (const name of fields) {
    const oldValue = existing[name] ?? "";
    const newValue = next[name] ?? "";
    if (String(oldValue) !== String(newValue)) changes.push(["updated", name, oldValue, newValue]);
  }
  return changes;
}

async function createImportRun(filename, kind, storeName) {
  const runId = generatedBigIntId();
  const rows = await insertRows("finance_import_runs", [{
    id: runId,
    filename,
    kind,
    store_name: storeName || "",
    rows_seen: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    audit_count: 0,
    message: "Import berjalan",
    created_at: nowIso(),
  }]);
  return { ...(rows[0] || {}), id: runId };
}

async function finishImportRun(runId, patch) {
  if (!runId) return null;
  const rows = await supabaseRequest(`finance_import_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function importIncomeRows({ storeName, filename, rows, run }) {
  const storeFilter = normalizeStore(storeName || DEFAULT_STORE);
  const incomeRows = mapIncomeRows(rows, storeFilter, filename || "upload");
  if (!incomeRows.length) throw new Error(`File ${filename || "income"} terbaca sebagai income, tetapi tidak ada baris settlement valid.`);
  const existingRows = await fetchAll("finance_order_lines", `select=*&store_name=eq.${encodeURIComponent(storeFilter)}`);
  const byOrder = new Map();
  for (const row of existingRows) {
    const key = String(row.order_id || "").trim();
    if (!key) continue;
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(row);
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  const prepared = [];
  const auditEvents = [];
  for (const income of incomeRows) {
    const existingGroup = byOrder.get(income.orderId) || [];
    if (!existingGroup.length) {
      skipped += 1;
      continue;
    }
    const targetRows = existingGroup;
    const grossBase = targetRows.reduce((sum, row) => sum + Math.abs(Number(row.gross_product || 0)), 0) ||
      Math.abs(income.beforeDiscount || income.afterDiscount || income.totalRevenue || 0) ||
      targetRows.length ||
      1;
    const incomeSettlement = Math.max(0, Number(income.settlement || 0));
    const orderAmount = Math.abs(income.afterDiscount || income.totalRevenue || income.beforeDiscount || 0);
    const incomeFee =
      income.totalFees ||
      (incomeSettlement ? Math.max(orderAmount - incomeSettlement, 0) : 0) ||
      (income.settlement < 0 ? Math.abs(income.settlement) : 0) ||
      (income.adjustment < 0 ? Math.abs(income.adjustment) : 0);
    const refundOnly = income.refund && !incomeSettlement && !income.totalRevenue;

    for (const current of targetRows) {
      const currentGross = Math.abs(Number(current.gross_product || 0));
      const currentDiscount = Math.abs(Number(current.seller_discount || 0));
      const share = existingGroup.length ? (currentGross ? currentGross / grossBase : 1 / targetRows.length) : 1;
      const status = isCancelledStatus(current.status) || refundOnly
        ? (current.status || "Dibatalkan")
        : (columnToken(income.type) === "order" && income.settledAt ? "Selesai" : income.type || current.status || "Income");
      const next = {
        ...current,
        source: current.source || "income_statement",
        created_at: current.created_at || income.createdAt,
        updated_at: income.settledAt || current.updated_at,
        status,
        gross_product: currentGross || Math.abs(income.beforeDiscount || income.afterDiscount || income.totalRevenue || 0) * share,
        seller_discount: currentDiscount,
        platform_fee: incomeFee ? incomeFee * share : Number(current.platform_fee || 0),
        refund_amount: income.refund || Number(current.refund_amount || 0),
        order_amount: currentGross
          ? Math.max(currentGross - currentDiscount, 0)
          : (orderAmount ? orderAmount * share : Number(current.order_amount || 0)),
        settlement_received: incomeSettlement || Number(current.settlement_received || 0),
        last_seen_file: filename || "upload",
        last_seen_at: nowIso(),
      };
      const changes = auditChanges(existingGroup.length ? current : null, next);
      if (changes.length) updated += 1;
      else unchanged += 1;
      for (const [changeType, fieldName, oldValue, newValue] of changes) {
        auditEvents.push({
          id: generatedBigIntId(),
          run_id: run && run.id,
          filename: filename || "upload",
          kind: "income",
          store_name: next.store_name,
          order_id: next.order_id,
          sku: next.sku,
          field_name: fieldName,
          old_value: String(oldValue ?? ""),
          new_value: String(newValue ?? ""),
          change_type: changeType,
          created_at: nowIso(),
        });
      }
      prepared.push(next);
    }
  }
  await upsertRows("finance_order_lines", prepared, "line_key");
  await insertRows("finance_audit_events", auditEvents);
  await finishImportRun(run && run.id, {
    rows_seen: rows.length,
    inserted,
    updated,
    unchanged: unchanged + skipped,
    audit_count: auditEvents.length,
    message: skipped ? `Income statement TikTok diperbarui; ${skipped} baris tanpa order lama dilewati` : "Income statement TikTok diperbarui",
  });
  return { ok: true, kind: "income", rows: rows.length, inserted, updated, unchanged: unchanged + skipped, skipped, auditCount: auditEvents.length };
}

async function importRows({ storeName, kind, filename, rows }) {
  const cleanRows = (rows || []).map(row => {
    const clean = {};
    for (const [key, value] of Object.entries(row || {})) clean[cleanCol(key)] = value;
    return clean;
  });
  const detected = detectKind(cleanRows, kind);
  if (detected === "unknown") {
    const cols = Object.keys(cleanRows[0] || {}).slice(0, 12).join(", ") || "tidak ada kolom terbaca";
    throw new Error(`Format file ${filename || "upload"} belum dikenal. Kolom terbaca: ${cols}. Pilih jenis file yang sesuai atau upload order Desty, pencairan TikTok, atau template SKU.`);
  }
  const run = await createImportRun(filename || "upload", detected, storeName || DEFAULT_STORE);
  if (detected === "sku") {
    const skuRows = mapSkuRows(cleanRows, storeName || "global");
    if (!skuRows.length) throw new Error(`File ${filename || "SKU"} terbaca sebagai SKU, tetapi tidak ada baris SKU valid.`);
    await upsertRows("finance_sku_costs", skuRows, "sku_key");
    await finishImportRun(run && run.id, {
      rows_seen: cleanRows.length,
      inserted: skuRows.length,
      updated: 0,
      unchanged: 0,
      audit_count: 0,
      message: "HPP dan packing diperbarui",
    });
    return { ok: true, kind: "sku", rows: cleanRows.length, inserted: skuRows.length, updated: 0, unchanged: 0, auditCount: 0 };
  }
  if (detected === "income") {
    return importIncomeRows({ storeName, filename, rows: cleanRows, run });
  }

  const mapped = detected === "orders"
    ? mapOrderRows(cleanRows, storeName, filename || "upload")
    : mapSettlementRows(cleanRows, storeName, filename || "upload");
  if (!mapped.length) throw new Error(`File ${filename || "upload"} terbaca sebagai ${detected}, tetapi tidak ada order/SKU valid yang bisa diimport.`);
  const storeFilter = normalizeStore(storeName || DEFAULT_STORE);
  const existingRows = await fetchAll("finance_order_lines", `select=*&store_name=eq.${encodeURIComponent(storeFilter)}`);
  const existingByKey = new Map(existingRows.map(row => [row.line_key, row]));
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const auditEvents = [];
  const prepared = mapped.map(row => {
    const existing = existingByKey.get(row.line_key);
    if (existing && Number(existing.settlement_received || 0) > Number(row.settlement_received || 0)) {
      row.settlement_received = Number(existing.settlement_received || 0);
    }
    const changes = auditChanges(existing, row);
    if (!existing) inserted += 1;
    else if (changes.length) updated += 1;
    else unchanged += 1;
    for (const [changeType, fieldName, oldValue, newValue] of changes) {
        auditEvents.push({
          id: generatedBigIntId(),
          run_id: run && run.id,
        filename: filename || "upload",
        kind: detected,
        store_name: row.store_name,
        order_id: row.order_id,
        sku: row.sku,
        field_name: fieldName,
        old_value: String(oldValue ?? ""),
        new_value: String(newValue ?? ""),
        change_type: changeType,
        created_at: nowIso(),
      });
    }
    return row;
  });
  await upsertRows("finance_order_lines", prepared, "line_key");
  await insertRows("finance_audit_events", auditEvents);
  await finishImportRun(run && run.id, {
    rows_seen: cleanRows.length,
    inserted,
    updated,
    unchanged,
    audit_count: auditEvents.length,
    message: detected === "orders" ? "Order Desty diperbarui" : "Pencairan/status marketplace diperbarui",
  });
  return { ok: true, kind: detected, rows: cleanRows.length, inserted, updated, unchanged, auditCount: auditEvents.length };
}

async function readConfig() {
  const defaults = {
    telegramBotToken: "",
    telegramChatId: "",
    morningTime: "07:30",
    alertNegativeProfit: true,
    alertMarginBelow: 12,
    lastMorningSent: "",
    ownerPinEnabled: false,
    ownerPin: "",
    stores: DEFAULT_STORES,
    defaultStore: DEFAULT_STORE,
    folderMonitors: Object.fromEntries(DEFAULT_STORES.map(store => [store, {
      enabled: false,
      path: "",
      intervalMinutes: 10,
      storeName: store,
      kind: "auto",
      lastRun: "",
      lastMessage: "Auto update folder online butuh worker lokal yang mengirim data ke Supabase.",
      fileState: {},
    }])),
  };
  if (!supabaseConfigured()) return defaults;
  const rows = await fetchAll("finance_config", "select=value&key=eq.app&limit=1");
  return { ...defaults, ...((rows[0] && rows[0].value) || {}) };
}

async function saveConfig(data) {
  const current = await readConfig();
  const next = {
    ...current,
    telegramBotToken: data.telegramBotToken && data.telegramBotToken !== "tersimpan" ? String(data.telegramBotToken).trim() : current.telegramBotToken,
    telegramChatId: data.telegramChatId ? String(data.telegramChatId).trim() : current.telegramChatId,
    morningTime: data.morningTime || current.morningTime || "07:30",
    ownerPin: data.ownerPin ? String(data.ownerPin) : current.ownerPin,
    ownerPinEnabled: Boolean(data.ownerPin || current.ownerPin),
  };
  await upsertRows("finance_config", [{ key: "app", value: next, updated_at: nowIso() }], "key");
  return safeConfig(next);
}

function safeConfig(config) {
  return {
    ...config,
    telegramBotToken: config.telegramBotToken ? "tersimpan" : "",
    ownerPin: "",
    supabaseConnected: supabaseConfigured(),
  };
}

async function saveAdSpend(data) {
  const amount = Math.abs(rupiah(data.amount));
  if (!amount) throw new Error("Nominal biaya iklan harus lebih dari 0.");
  const row = {
    store_name: normalizeStore(data.storeName || DEFAULT_STORE),
    spend_date: String(data.spendDate || todayIso()).slice(0, 10),
    amount,
    channel: String(data.channel || "TikTok Ads").trim() || "TikTok Ads",
    campaign: String(data.campaign || "").trim(),
    note: String(data.note || "").trim(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const saved = await insertRows("finance_ad_spend", [row]);
  return saved[0] || row;
}

async function computeSummary(filters = { preset: "all", month: "", store: "all" }) {
  if (!supabaseConfigured()) return emptySummary();
  const [orderLines, skuCosts, adRowsAll] = await Promise.all([
    fetchAll("finance_order_lines", filters.store !== "all" ? `select=*&store_name=eq.${encodeURIComponent(filters.store)}` : "select=*"),
    fetchAll("finance_sku_costs", "select=*"),
    fetchAll("finance_ad_spend", filters.store !== "all" ? `select=*&store_name=eq.${encodeURIComponent(filters.store)}` : "select=*"),
  ]);
  const [startDate, endDate] = dateRangeFromFilters(filters);
  const costs = new Map(skuCosts.map(row => [`${String(row.store_name || "").toLowerCase()}|${String(row.sku || "").toLowerCase()}`, row]));
  const rows = orderLines.map(row => {
    const storeKey = `${String(row.store_name || "").toLowerCase()}|${String(row.sku || "").toLowerCase()}`;
    const globalKey = `global|${String(row.sku || "").toLowerCase()}`;
    const cost = costs.get(storeKey) || costs.get(globalKey) || {};
    return {
      ...row,
      hpp_per_unit: Number(cost.hpp_per_unit || 0),
      packing_per_unit: Number(cost.packing_per_unit || 0),
    };
  });

  const groups = new Map();
  for (const row of rows) {
    const groupKey = `${row.store_name || DEFAULT_STORE}|${row.order_id || row.line_key}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }

  const sku = new Map();
  const daily = new Map();
  const stores = new Map();
  const status = new Map();
  const missingCost = new Set();
  const totals = {
    orders: new Set(),
    lines: 0,
    qty: 0,
    gross: 0,
    sellerDiscount: 0,
    omzet: 0,
    platformFee: 0,
    platformDiscount: 0,
    hpp: 0,
    packing: 0,
    refund: 0,
    settlement: 0,
    held: 0,
    cancelledAmount: 0,
    profit: 0,
    profitBeforeAds: 0,
    adSpend: 0,
    todayOrders: 0,
    finalProfit: 0,
    estimatedProfit: 0,
    finalProfitBeforeAds: 0,
    estimatedProfitBeforeAds: 0,
    finalAdSpend: 0,
    estimatedAdSpend: 0,
    finalOmzet: 0,
    estimatedOmzet: 0,
    finalOrders: new Set(),
    estimatedOrders: new Set(),
    heldOrders: new Set(),
    cancelledOrders: new Set(),
    bookGross: 0,
    bookSellerDiscount: 0,
    bookOmzet: 0,
    bookPlatformFee: 0,
    bookSettlement: 0,
    bookHpp: 0,
    bookPacking: 0,
    bookRefund: 0,
    bookCancelledAmount: 0,
    bookHeld: 0,
    bookProfitBeforeAds: 0,
    bookProfit: 0,
    bookAdSpend: 0,
    bookOrders: new Set(),
    bookCancelledOrders: new Set(),
  };
  const bookMissingCost = new Set();
  const today = todayIso();

  for (const [groupKey, orderRows] of groups.entries()) {
    const basisRows = orderRows.filter(row => isBookSource(row));
    const financialRows = basisRows.length ? basisRows : orderRows;
    const first = financialRows[0] || {};
    const createdDay = String(first.created_at || "").slice(0, 10) || "Tanpa tanggal";
    if (startDate) {
      if (createdDay === "Tanpa tanggal" || createdDay < startDate || createdDay > endDate) continue;
    }
    const grossSum = financialRows.reduce((sum, row) => sum + Math.abs(Number(row.gross_product || 0)), 0);
    const sellerDiscountTotal = financialRows.reduce((sum, row) => sum + Math.abs(Number(row.seller_discount || 0)), 0);
    const productNetTotal = Math.max(grossSum - sellerDiscountTotal, 0);
    const lineOrderTotal = financialRows.reduce((sum, row) => sum + Math.abs(Number(row.order_amount || 0)), 0);
    const maxOrderAmount = Math.max(...financialRows.map(row => Math.abs(Number(row.order_amount || 0))), 0);
    const orderTotal = grossSum ? productNetTotal : (maxOrderAmount || lineOrderTotal || grossSum);
    const settlementTotal = Math.max(...financialRows.map(row => actualSettlementAmount(row)), 0);
    const refundTotal = Math.max(...financialRows.map(row => Math.abs(Number(row.refund_amount || 0))), 0);
    const rawPlatformFeeTotal = financialRows.reduce((sum, row) => sum + Math.abs(Number(row.platform_fee || 0)), 0);
    const derivedPlatformFee = settlementTotal ? Math.max(orderTotal - settlementTotal, 0) : 0;
    const platformFeeTotal = Math.max(rawPlatformFeeTotal, derivedPlatformFee);
    const platformDiscountTotal = financialRows.reduce((sum, row) => sum + Math.abs(Number(row.platform_discount || 0)), 0);
    const packingTotal = Math.max(...financialRows.filter(row => Number(row.quantity || 0) > 0).map(row => Number(row.packing_per_unit || 0)), 0);
    const cancelled = financialRows.some(row => isCancelledStatus(row.status));
    const unpaid = financialRows.some(row => isUnpaidStatus(row.status));
    const excluded = cancelled || unpaid;
    const isFinal = !excluded && Boolean(settlementTotal);
    const isEstimated = !excluded && !settlementTotal;
    const orderId = groupKey;
    totals.orders.add(orderId);
    totals.lines += financialRows.length;
    if (createdDay === today) totals.todayOrders += 1;
    if (!daily.has(createdDay)) daily.set(createdDay, { date: createdDay, orders: new Set(), omzet: 0, profit: 0 });
    daily.get(createdDay).orders.add(orderId);
    const store = first.store_name || DEFAULT_STORE;
    if (!stores.has(store)) stores.set(store, { store, orders: new Set(), omzet: 0, profit: 0 });
    stores.get(store).orders.add(orderId);
    for (const row of financialRows) {
      const statusKey = row.status || "Tanpa status";
      status.set(statusKey, (status.get(statusKey) || 0) + 1);
    }
    if (excluded) {
      const cancelledValue = refundTotal || orderTotal;
      totals.refund += cancelledValue;
      totals.cancelledAmount += cancelledValue;
      totals.cancelledOrders.add(orderId);
      if (basisRows.length) {
        totals.bookRefund += cancelledValue;
        totals.bookCancelledAmount += cancelledValue;
        totals.bookCancelledOrders.add(orderId);
      }
      continue;
    }
    totals.omzet += orderTotal;
    totals.gross += grossSum;
    totals.sellerDiscount += sellerDiscountTotal;
    totals.platformFee += platformFeeTotal;
    totals.platformDiscount += platformDiscountTotal;
    totals.refund += refundTotal;
    totals.settlement += settlementTotal;
    if (isFinal) {
      totals.finalOrders.add(orderId);
      totals.finalOmzet += orderTotal;
    } else if (isEstimated) {
      totals.estimatedOrders.add(orderId);
      totals.estimatedOmzet += orderTotal;
    }
    if (!settlementTotal) {
      totals.held += orderTotal;
      totals.heldOrders.add(orderId);
    }
    const bookOrder = basisRows.length > 0;
    if (bookOrder) {
      totals.bookOrders.add(orderId);
      totals.bookGross += grossSum;
      totals.bookSellerDiscount += sellerDiscountTotal;
      totals.bookOmzet += orderTotal;
      totals.bookPlatformFee += platformFeeTotal;
      totals.bookSettlement += settlementTotal;
    }
    daily.get(createdDay).omzet += orderTotal;
    stores.get(store).omzet += orderTotal;

    for (const row of financialRows) {
      const qty = Number(row.quantity || 0);
      const lineGross = Math.abs(Number(row.gross_product || 0));
      const share = grossSum ? lineGross / grossSum : 1 / Math.max(financialRows.length, 1);
      const omzet = orderTotal * share;
      const platformFee = platformFeeTotal * share;
      const refund = refundTotal * share;
      const hpp = qty * Number(row.hpp_per_unit || 0);
      const packing = packingTotal * share;
      const profit = omzet - platformFee - refund - hpp - packing;
      totals.qty += qty;
      totals.hpp += hpp;
      totals.packing += packing;
      totals.profit += profit;
      if (bookOrder) {
        totals.bookHpp += hpp;
        totals.bookPacking += packing;
        totals.bookProfitBeforeAds += profit;
      }
      if (isFinal) totals.finalProfitBeforeAds += profit;
      else if (isEstimated) totals.estimatedProfitBeforeAds += profit;
      daily.get(createdDay).profit += profit;
      stores.get(store).profit += profit;
      if (qty && !(Number(row.hpp_per_unit || 0) || Number(row.packing_per_unit || 0))) missingCost.add(row.sku);
      if (bookOrder && qty && !(Number(row.hpp_per_unit || 0) || Number(row.packing_per_unit || 0))) bookMissingCost.add(row.sku);
      const skuKey = row.sku || "Tanpa SKU";
      if (!sku.has(skuKey)) {
        sku.set(skuKey, {
          sku: skuKey,
          product: row.product_name || "",
          qty: 0,
          orders: new Set(),
          stores: new Set(),
          omzet: 0,
          profit: 0,
          profitBeforeAds: 0,
          hpp: 0,
          packing: 0,
          platformFee: 0,
          refund: 0,
          adSpend: 0,
          missingCost: false,
        });
      }
      const item = sku.get(skuKey);
      item.qty += qty;
      item.orders.add(orderId);
      item.stores.add(store);
      item.omzet += omzet;
      item.profit += profit;
      item.hpp += hpp;
      item.packing += packing;
      item.platformFee += platformFee;
      item.refund += refund;
      if (qty && !(Number(row.hpp_per_unit || 0) || Number(row.packing_per_unit || 0))) item.missingCost = true;
    }
  }

  const adRows = adRowsAll
    .filter(row => !startDate || (String(row.spend_date || "") >= startDate && String(row.spend_date || "") <= endDate))
    .sort((a, b) => String(b.spend_date || "").localeCompare(String(a.spend_date || "")) || Number(b.id || 0) - Number(a.id || 0));
  for (const expense of adRows) {
    const amount = Number(expense.amount || 0);
    totals.adSpend += amount;
    const spendDay = expense.spend_date || "Tanpa tanggal";
    if (!daily.has(spendDay)) daily.set(spendDay, { date: spendDay, orders: new Set(), omzet: 0, profit: 0 });
    daily.get(spendDay).profit -= amount;
    const store = expense.store_name || DEFAULT_STORE;
    if (!stores.has(store)) stores.set(store, { store, orders: new Set(), omzet: 0, profit: 0 });
    stores.get(store).profit -= amount;
  }

  totals.profitBeforeAds = totals.profit;
  totals.bookAdSpend = totals.adSpend;
  totals.bookHeld = Math.max(totals.bookOmzet - totals.bookPlatformFee - totals.bookSettlement, 0);
  totals.bookProfit = totals.bookProfitBeforeAds - totals.bookAdSpend;
  if (totals.omzet) {
    totals.finalAdSpend = totals.adSpend * (totals.finalOmzet / totals.omzet);
    totals.estimatedAdSpend = totals.adSpend - totals.finalAdSpend;
  }
  totals.finalProfit = totals.finalProfitBeforeAds - totals.finalAdSpend;
  totals.estimatedProfit = totals.estimatedProfitBeforeAds - totals.estimatedAdSpend;
  totals.profit -= totals.adSpend;

  const dailyList = Array.from(daily.values()).map(item => ({ ...item, orders: item.orders.size })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const storeList = Array.from(stores.values()).map(item => ({ ...item, orders: item.orders.size }));
  for (const store of DEFAULT_STORES) {
    if (!storeList.some(item => item.store === store)) storeList.push({ store, orders: 0, omzet: 0, profit: 0 });
  }

  const skuDetails = Array.from(sku.values()).map(item => {
    const orders = item.orders.size;
    const storesList = Array.from(item.stores).sort();
    const adSpend = totals.omzet ? totals.adSpend * item.omzet / totals.omzet : 0;
    const profitBeforeAds = item.profit;
    const profit = profitBeforeAds - adSpend;
    const margin = item.omzet ? profit / item.omzet * 100 : 0;
    let statusText = "Penghasil";
    let statusLevel = "good";
    if (item.missingCost) {
      statusText = "HPP belum lengkap";
      statusLevel = "warn";
    } else if (profit < 0) {
      statusText = "Rugi";
      statusLevel = "bad";
    } else if (margin < 10) {
      statusText = "Kurang bagus";
      statusLevel = "bad";
    } else if (margin < 20) {
      statusText = "Perlu dipantau";
      statusLevel = "watch";
    }
    return {
      ...item,
      orders,
      stores: storesList,
      profitBeforeAds,
      adSpend,
      profit,
      costTotal: item.hpp + item.packing + item.platformFee + item.refund + adSpend,
      margin,
      aov: orders ? item.omzet / orders : 0,
      status: statusText,
      statusLevel,
    };
  });
  const reliableSku = skuDetails.filter(item => !item.missingCost);
  const topSku = [...(reliableSku.length ? reliableSku : skuDetails)].sort((a, b) => b.profit - a.profit).slice(0, 12);
  const weakPriority = { bad: 0, warn: 1, watch: 2, good: 3 };
  const weakSku = [...skuDetails].sort((a, b) => (weakPriority[a.statusLevel] ?? 4) - (weakPriority[b.statusLevel] ?? 4) || a.profit - b.profit).slice(0, 8);
  const margin = totals.omzet ? totals.profit / totals.omzet * 100 : 0;
  const finalMargin = totals.finalOmzet ? totals.finalProfit / totals.finalOmzet * 100 : 0;
  const estimatedMargin = totals.estimatedOmzet ? totals.estimatedProfit / totals.estimatedOmzet * 100 : 0;
  const bookMargin = totals.bookOmzet ? totals.bookProfit / totals.bookOmzet * 100 : 0;
  const primaryMargin = totals.bookOrders.size ? bookMargin : margin;
  const primaryOmzet = totals.bookOrders.size ? totals.bookOmzet : totals.omzet;
  const primaryProfit = totals.bookOrders.size ? totals.bookProfit : totals.profit;
  const alerts = [];
  if (primaryProfit < 0) alerts.push({ level: "danger", title: "Profit total negatif", body: "Perlu cek HPP, potongan, dan SKU rugi." });
  const marginText = Math.abs(primaryMargin) > 0 && Math.abs(primaryMargin) < 1 ? primaryMargin.toFixed(2) : primaryMargin.toFixed(1);
  if (primaryOmzet && primaryMargin < 12) alerts.push({ level: "warn", title: "Margin tipis", body: `Margin bersih sementara ${marginText}%.` });
  if (totals.adSpend && primaryOmzet && totals.adSpend / primaryOmzet > 0.2) alerts.push({ level: "warn", title: "Biaya iklan tinggi", body: "Biaya iklan lebih dari 20% omset periode ini." });
  const missingForAlert = totals.bookOrders.size ? bookMissingCost : missingCost;
  if (missingForAlert.size) alerts.push({ level: "warn", title: "Ada SKU tanpa HPP", body: `${missingForAlert.size} SKU belum punya HPP/packing.` });

  const rawMonths = Array.from(new Set([
    ...rows.map(row => String(row.created_at || "").slice(0, 7)).filter(Boolean),
    ...adRowsAll.map(row => String(row.spend_date || "").slice(0, 7)).filter(Boolean),
  ]));
  const years = Array.from(new Set(rawMonths.map(month => month.slice(0, 4)).filter(Boolean))).sort().reverse();
  if (!years.length) years.push(String(new Date().getFullYear()));
  const availableMonths = years.flatMap(year => Array.from({ length: 12 }, (_, index) => `${year}-${String(12 - index).padStart(2, "0")}`));
  const runs = await fetchAll("finance_import_runs", "select=*&order=id.desc&limit=8");
  const auditQuery = filters.store !== "all"
    ? `select=*&store_name=eq.${encodeURIComponent(filters.store)}&order=id.desc&limit=40`
    : "select=*&order=id.desc&limit=40";
  const auditEvents = await fetchAll("finance_audit_events", auditQuery);
  const skuSummary = {
    total: skuDetails.length,
    profitable: skuDetails.filter(item => item.statusLevel === "good").length,
    watch: skuDetails.filter(item => item.statusLevel === "watch").length,
    bad: skuDetails.filter(item => item.statusLevel === "bad").length,
    missingCost: skuDetails.filter(item => item.missingCost).length,
    best: topSku[0] || null,
    weakest: weakSku[0] || null,
  };
  const counts = {
    orders: totals.orders.size,
    finalOrders: totals.finalOrders.size,
    estimatedOrders: totals.estimatedOrders.size,
    heldOrders: totals.heldOrders.size,
    cancelledOrders: totals.cancelledOrders.size,
    bookOrders: totals.bookOrders.size,
    bookCancelledOrders: totals.bookCancelledOrders.size,
  };
  const assistant = buildAssistant({ ...totals, ...counts }, primaryMargin, topSku, weakSku, missingForAlert, dailyList);
  return {
    generatedAt: nowIso(),
    totals: { ...totals, ...counts, margin, finalMargin, estimatedMargin, bookMargin },
    daily: dailyList.slice(-30),
    topSku,
    weakSku,
    skuDetails: skuDetails.sort((a, b) => b.profit - a.profit),
    skuSummary,
    stores: storeList.sort((a, b) => b.omzet - a.omzet),
    status: Array.from(status.entries()).map(([key, value]) => ({ status: key, count: value })).sort((a, b) => b.count - a.count),
    missingCost: Array.from(missingCost).slice(0, 30),
    alerts,
    assistant,
    filters: { ...filters, startDate, endDate },
    availableMonths,
    availableStores: DEFAULT_STORES,
    adSpendRows: adRows.slice(0, 12),
    runs,
    auditEvents,
  };
}

function buildAssistant(totals, margin, topSku, weakSku, missingCost, dailyList) {
  const adSpend = Number(totals.adSpend || 0);
  const hasBook = Number(totals.bookOrders || 0) > 0 || Number(totals.bookOmzet || 0) > 0;
  const omzet = hasBook ? Number(totals.bookOmzet || 0) : Number(totals.omzet || 0);
  const held = hasBook ? Number(totals.bookHeld || 0) : Number(totals.held || 0);
  const refund = hasBook ? Number(totals.bookCancelledAmount || 0) : Number(totals.refund || 0);
  const platformFee = hasBook ? Number(totals.bookPlatformFee || 0) : Number(totals.platformFee || 0);
  const accountingOmzet = hasBook ? Number(totals.bookOmzet || 0) : Number(totals.omzet || 0);
  const accountingProfit = hasBook ? Number(totals.bookProfit || 0) : Number(totals.profit || 0);
  const heldRatio = omzet ? held / omzet * 100 : 0;
  const refundRatio = omzet ? refund / omzet * 100 : 0;
  const feeRatio = omzet ? platformFee / omzet * 100 : 0;
  const adRatio = omzet ? adSpend / omzet * 100 : 0;
  let score = 70;
  if (margin >= 30) score += 15;
  else if (margin < 15) score -= 20;
  if (heldRatio > 40) score -= 12;
  if (refundRatio > 10) score -= 10;
  if (adRatio > 20) score -= 10;
  if (missingCost.size) score -= 12;
  score = Math.max(0, Math.min(100, score));
  const last14 = dailyList.slice(-14);
  const avgDaily = last14.reduce((sum, item) => sum + Number(item.omzet || 0), 0) / Math.max(last14.length, 1);
  const forecast30Omzet = avgDaily * 30;
  const forecast30Profit = omzet ? forecast30Omzet * (margin / 100) : 0;
  const insights = [];
  const actions = [];
  const marginText = Math.abs(margin) > 0 && Math.abs(margin) < 1 ? margin.toFixed(2) : margin.toFixed(1);
  if (margin >= 30) insights.push(`Margin bersih kuat di ${marginText}%. Bisnis terlihat sehat, selama HPP semua SKU sudah lengkap.`);
  else if (margin >= 15) insights.push(`Margin bersih sedang di ${marginText}%. Masih sehat, tapi ruang salah harga dan promo mulai sempit.`);
  else insights.push(`Margin bersih tipis di ${marginText}%. Ini perlu dipantau sebelum menaikkan budget iklan atau diskon.`);
  if (heldRatio > 30) {
    insights.push(`Dana tertahan sekitar ${heldRatio.toFixed(1)}% dari omset terdata.`);
    actions.push("Prioritaskan cek order belum selesai/cair supaya kas harian tidak terlihat semu.");
  }
  if (refundRatio > 8) {
    insights.push(`Refund cukup tinggi, sekitar ${refundRatio.toFixed(1)}% dari omset.`);
    actions.push("Audit SKU dengan refund tertinggi dan cek penyebab retur/cancel.");
  }
  if (feeRatio > 8) actions.push("Cek potongan platform dan promo, terutama jika biaya platform naik tanpa kenaikan order.");
  if (adSpend) {
    insights.push(`Biaya iklan tercatat ${adRatio.toFixed(1)}% dari omset periode ini.`);
    if (adRatio > 20) actions.push("Turunkan atau evaluasi campaign iklan yang ROAS/profit SKU-nya belum jelas.");
  }
  if (missingCost.size) actions.push(`Lengkapi HPP untuk ${missingCost.size} SKU agar profit tidak terlalu optimistis.`);
  if (!hasBook && Number(totals.estimatedOmzet || 0) > Number(totals.finalOmzet || 0)) {
    insights.push("Porsi profit estimasi masih lebih besar dari profit final, jadi keputusan cashflow sebaiknya menunggu pencairan berikutnya.");
    actions.push("Pantau daftar order belum cair dan bandingkan dengan pencairan upload berikutnya.");
  }
  if (topSku[0]) actions.push(`SKU ${topSku[0].sku} paling produktif. Pastikan stok, bahan, dan kapasitas produksi aman.`);
  if (weakSku[0]) actions.push(`SKU ${weakSku[0].sku} perlu dicek harga, HPP, promo, atau kualitas traffic.`);
  return {
    score,
    health: score >= 75 ? "Sehat" : score >= 55 ? "Perlu Dipantau" : "Butuh Tindakan",
    forecast30Omzet,
    forecast30Profit,
    accounting: {
      pendapatan: accountingOmzet,
      omzetKotor: Number(totals[hasBook ? "bookGross" : "gross"] || 0),
      diskonSeller: Number(totals[hasBook ? "bookSellerDiscount" : "sellerDiscount"] || 0),
      omzetNet: accountingOmzet,
      settlementCair: Number(totals[hasBook ? "bookSettlement" : "settlement"] || 0),
      hppPacking: hasBook ? Number(totals.bookHpp || 0) + Number(totals.bookPacking || 0) : Number(totals.hpp || 0) + Number(totals.packing || 0),
      hpp: Number(totals[hasBook ? "bookHpp" : "hpp"] || 0),
      packing: Number(totals[hasBook ? "bookPacking" : "packing"] || 0),
      potonganPlatform: Number(totals[hasBook ? "bookPlatformFee" : "platformFee"] || 0),
      biayaIklan: adSpend,
      totalBiaya: (hasBook ? Number(totals.bookHpp || 0) + Number(totals.bookPacking || 0) : Number(totals.hpp || 0) + Number(totals.packing || 0)) + adSpend,
      danaTertahan: Number(totals[hasBook ? "bookHeld" : "held"] || 0),
      refund: hasBook ? Number(totals.bookCancelledAmount || 0) : refund,
      returCancel: Number(totals[hasBook ? "bookCancelledAmount" : "cancelledAmount"] || 0),
      profitBersih: accountingProfit,
      profitEstimasi: accountingProfit,
      profitFinal: hasBook ? accountingProfit : Number(totals.finalProfit || 0),
      profitBelumFinal: Number(totals.estimatedProfit || 0),
      omsetFinal: hasBook ? accountingOmzet : Number(totals.finalOmzet || 0),
      omsetBelumFinal: Number(totals.estimatedOmzet || 0),
    },
    insights,
    actions: actions.slice(0, 6),
  };
}

function redactSummary(summary, role = "team") {
  const safe = JSON.parse(JSON.stringify(summary));
  safe.accessRole = role;
  for (const key of SECRET_TOTAL_KEYS) {
    if (safe.totals && key in safe.totals) safe.totals[key] = 0;
  }
  for (const row of safe.daily || []) row.profit = 0;
  for (const row of safe.stores || []) delete row.profit;
  safe.topSku = (safe.topSku || []).map(row => ({
    sku: row.sku,
    product: row.product,
    qty: row.qty || 0,
    orders: row.orders || 0,
    omzet: row.omzet || 0,
  }));
  safe.weakSku = [];
  safe.skuDetails = [];
  safe.skuSummary = { total: safe.skuSummary?.total || 0, profitable: 0, watch: 0, bad: 0, missingCost: 0, best: safe.topSku[0] || null, weakest: null };
  safe.alerts = [{ level: "warn", title: "Mode tim aktif", body: "Profit, HPP, pencairan, refund, potongan, biaya iklan, dan audit sensitif disembunyikan." }];
  safe.assistant = {
    score: 0,
    health: "Mode Tim",
    forecast30Omzet: safe.assistant?.forecast30Omzet || 0,
    forecast30Profit: 0,
    accounting: {
      pendapatan: safe.totals?.omzet || 0,
      omzetKotor: 0,
      diskonSeller: 0,
      omzetNet: safe.totals?.omzet || 0,
      settlementCair: 0,
      hppPacking: 0,
      hpp: 0,
      packing: 0,
      potonganPlatform: 0,
      biayaIklan: 0,
      totalBiaya: 0,
      danaTertahan: 0,
      refund: 0,
      returCancel: 0,
      profitBersih: 0,
      profitEstimasi: 0,
      profitFinal: 0,
      profitBelumFinal: 0,
      omsetFinal: 0,
      omsetBelumFinal: 0,
    },
    insights: ["Mode tim hanya menampilkan data operasional yang aman untuk dibagikan."],
    actions: ["Gunakan akses owner untuk melihat profit, biaya, pencairan, dan rekomendasi finansial lengkap."],
  };
  safe.adSpendRows = [];
  safe.auditEvents = [];
  safe.runs = [];
  return safe;
}

function telegramMessage(summary) {
  const t = summary.totals || {};
  const top = summary.topSku?.[0] || { sku: "-", profit: 0 };
  const weak = summary.weakSku?.[0] || { sku: "-", profit: 0 };
  const alerts = (summary.alerts || []).map(item => `- ${item.title}: ${item.body}`).join("\n") || "- Tidak ada alert besar";
  const money = value => `Rp${Math.round(Number(value || 0)).toLocaleString("id-ID")}`;
  const hasBook = Number(t.bookOrders || 0) > 0 || Number(t.bookOmzet || 0) > 0;
  const accountingOmzet = hasBook ? t.bookOmzet : t.omzet;
  const accountingProfit = hasBook ? t.bookProfit : t.finalProfit;
  const accountingMargin = hasBook ? t.bookMargin : t.finalMargin;
  return [
    "Ringkasan Keuangan TikTok",
    `Waktu: ${summary.generatedAt}`,
    "",
    `Order unik: ${t.orders || 0}`,
    `Omzet net: ${money(accountingOmzet)}`,
    `Settlement cair: ${money(hasBook ? t.bookSettlement : t.settlement)}`,
    `Dana tertahan: ${money(hasBook ? t.bookHeld : t.held)}`,
    `Profit bersih: ${money(accountingProfit)} (${Number(accountingMargin || 0).toFixed(1)}%)`,
    `Profit estimasi operasional: ${money(t.profit)} (${Number(t.margin || 0).toFixed(1)}%)`,
    `Biaya iklan: ${money(t.adSpend)}`,
    "",
    `SKU terbaik: ${top.sku} (${money(top.profit)})`,
    `SKU perhatian: ${weak.sku} (${money(weak.profit)})`,
    "",
    "Alert:",
    alerts,
  ].join("\n");
}

async function sendTelegram(summary) {
  const config = await readConfig();
  if (!config.telegramBotToken || !config.telegramChatId) throw new Error("Bot Token dan Chat ID Telegram belum diisi.");
  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.telegramChatId, text: telegramMessage(summary) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.description || "Telegram menolak pesan.");
  return data;
}

module.exports = {
  DEFAULT_STORES,
  DEFAULT_STORE,
  json,
  readJson,
  supabaseConfigured,
  supabaseSetupMessage,
  emptySummary,
  buildFilters,
  computeSummary,
  redactSummary,
  importRows,
  readConfig,
  saveConfig,
  safeConfig,
  saveAdSpend,
  sendTelegram,
};
