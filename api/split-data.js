const pg = require("../lib/pg-connector");
const { json, buildFilters, requireOwner, nowIso, normalizeStore, safeLog } = require("../lib/finance-cloud");

const CACHE_DEFAULTS = { thisMonth: 60, month: 300, last7: 120, custom: 120 };

async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const q = req.query || {};
    const type = q.type || "mini";
    const filters = buildFilters({ preset: q.preset || "thisMonth", month: q.month, store: q.store });
    const role = q.role || "owner";
    if (role === "owner" && !(await requireOwner(req, res))) return;

    if (type === "mini") return json(res, 200, await withCache("split:mini", filters, () => computeMini(filters), filters.preset));
    if (type === "daily") return json(res, 200, await withCache("split:daily", filters, () => computeDaily(filters), filters.preset));
    if (type === "sku") return json(res, 200, await withCache("split:sku", filters, () => computeSku(filters), filters.preset));
    if (type === "orders") return json(res, 200, await computeOrders(filters, q));
    if (type === "operation") return json(res, 200, await withCache("split:operation", filters, () => computeOperation(filters), filters.preset));
    if (type === "stores") return json(res, 200, await withCache("split:stores", filters, () => computeStores(filters), filters.preset));
    return json(res, 400, { error: 'type harus mini, daily, sku, orders, operation, atau stores' });
  } catch (error) {
    return json(res, 200, { generatedAt: nowIso(), error: error.message });
  }
}

// ── Cache helpers ──
async function withCache(prefix, filters, computeFn, preset) {
  const cacheKey = `${prefix}:${filters.preset || "thisMonth"}:${filters.month || ""}:${filters.store || "all"}`;
  const ttl = CACHE_DEFAULTS[preset] || CACHE_DEFAULTS.last7;

  const cached = await pg.cacheGet(cacheKey);
  if (cached) { safeLog("cache_hit", { key: cacheKey }); return cached; }

  const result = await computeFn();
  await pg.cacheSet(cacheKey, result, ttl);
  return result;
}

// ── Type: mini — KPI ringkas ──
async function computeMini(filters) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return emptyMini();
  const [startDate, endDate] = dateRangeFromFilters(filters);
  if (!startDate || !endDate) return emptyMini();
  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;
  try {
    const [r, cr, ar, hr] = await Promise.all([
      pg.pgQuery(`SELECT COUNT(DISTINCT order_id) AS total_orders,COUNT(*) AS total_lines,COALESCE(SUM(ABS(gross_product)),0) AS total_gross,COALESCE(SUM(ABS(seller_discount)),0) AS total_sd,COALESCE(SUM(ABS(order_amount)),0) AS total_oa,COALESCE(SUM(ABS(platform_fee)),0) AS total_fee,COALESCE(SUM(ABS(settlement_received)),0) AS total_settlement,COALESCE(SUM(ABS(refund_amount)),0) AS total_refund FROM finance_order_lines WHERE created_at>=$1 AND created_at<($2::date+interval'1 day')::text` + (storeFilter?" AND store_name=$3":""), [startDate,endDate,...(storeFilter?[storeFilter]:[])]),
      pg.pgQuery(`SELECT COUNT(DISTINCT order_id) AS cnt FROM finance_order_lines WHERE created_at>=$1 AND created_at<($2::date+interval'1 day')::text AND (LOWER(TRIM(status)) IN ('dibatalkan','cancellations','cancelled','canceled','cancel','returned','return','returnrefund','refundreturn') OR LOWER(TRIM(status)) LIKE '%retur%')` + (storeFilter?" AND store_name=$3":""), [startDate,endDate,...(storeFilter?[storeFilter]:[])]),
      pg.pgQuery(`SELECT COALESCE(SUM(amount),0) AS t FROM finance_ad_spend WHERE spend_date>=$1 AND spend_date<=$2` + (storeFilter?" AND store_name=$3":""), [startDate,endDate,...(storeFilter?[storeFilter]:[])]),
      pg.pgQuery(`SELECT COALESCE(SUM(ABS(ol.quantity)*COALESCE(sk.hpp_per_unit,0)),0) AS hpp,COALESCE(SUM(ABS(ol.quantity)*COALESCE(sk.packing_per_unit,0)),0) AS packing FROM finance_order_lines ol LEFT JOIN finance_sku_costs sk ON LOWER(sk.store_name||'|'||sk.sku)=LOWER(ol.store_name||'|'||ol.sku) OR LOWER('global|'||sk.sku)=LOWER(ol.store_name||'|'||ol.sku) WHERE ol.created_at>=$1 AND ol.created_at<($2::date+interval'1 day')::text` + (storeFilter?" AND ol.store_name=$3":""), [startDate,endDate,...(storeFilter?[storeFilter]:[])]),
    ]);
    const row = r.rows[0] || {};
    const gross = Number(row.total_gross||0), sd = Number(row.total_sd||0);
    const omzet = Math.round(gross - sd), pf = Math.round(Number(row.total_fee||0));
    const adSpend = Math.round(Number(ar.rows[0]?.t||0));
    const hpp = Math.round(Number(hr.rows[0]?.hpp||0)), packing = Math.round(Number(hr.rows[0]?.packing||0));
    const profit = omzet - pf - hpp - packing - adSpend;
    safeLog("split_mini",{ms:Date.now()-startedAt});
    return { generatedAt:nowIso(), totals:{ orders:Number(row.total_orders||0), lines:Number(row.total_lines||0), gross:Math.round(gross), sellerDiscount:Math.round(sd), omzet, platformFee:pf, settlement:Math.round(Number(row.total_settlement||0)), refund:Math.round(Number(row.total_refund||0)), adSpend, hpp, packing, profit, margin:omzet>0?Math.round((profit/omzet)*1000)/10:0, cancelledOrders:Number(cr.rows[0]?.cnt||0) }};
  } catch(e) { safeLog("split_mini_error",{error:e.message}); return emptyMini(e.message); }
}

// ── Type: daily — chart harian ──
async function computeDaily(filters) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return { generatedAt:nowIso(), daily:[] };
  const [startDate,endDate] = dateRangeFromFilters(filters);
  if (!startDate||!endDate) return { generatedAt:nowIso(), daily:[] };
  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;
  try {
    const r = await pg.pgQuery(`SELECT created_at AS day,COUNT(DISTINCT order_id) AS orders,COALESCE(SUM(ABS(gross_product)),0) AS gross FROM finance_order_lines WHERE created_at>=$1 AND created_at<($2::date+interval'1 day')::text` + (storeFilter?" AND store_name=$3":"") + ` GROUP BY created_at ORDER BY created_at ASC`, [startDate,endDate,...(storeFilter?[storeFilter]:[])]);
    return { generatedAt:nowIso(), daily:r.rows.map(row=>({ date:row.day, orders:Number(row.orders||0), gross:Math.round(Number(row.gross||0)) })) };
  } catch(e) { return { generatedAt:nowIso(), daily:[], error:e.message }; }
}

// ── Type: sku — SKU top+weak, paginated ──
async function computeSku(filters) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return { generatedAt:nowIso(), topSku:[], weakSku:[] };
  const [startDate,endDate] = dateRangeFromFilters(filters);
  if (!startDate||!endDate) return { generatedAt:nowIso(), topSku:[], weakSku:[] };
  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;
  try {
    const r = await pg.pgQuery(`SELECT ol.sku,ol.store_name,ol.product_name,COUNT(*) AS line_count,COUNT(DISTINCT ol.order_id) AS order_count,SUM(ABS(ol.quantity)) AS total_qty,SUM(ABS(ol.gross_product)) AS total_gross,SUM(ABS(ol.seller_discount)) AS total_sd,SUM(ABS(ol.order_amount)) AS total_oa,SUM(ABS(ol.platform_fee)) AS total_fee,COALESCE(AVG(sk.hpp_per_unit),0) AS hpp_unit,COALESCE(AVG(sk.packing_per_unit),0) AS packing_unit FROM finance_order_lines ol LEFT JOIN finance_sku_costs sk ON LOWER(sk.store_name||'|'||sk.sku)=LOWER(ol.store_name||'|'||ol.sku) OR LOWER('global|'||sk.sku)=LOWER(ol.store_name||'|'||ol.sku) WHERE ol.created_at>=$1 AND ol.created_at<($2::date+interval'1 day')::text` + (storeFilter?" AND ol.store_name=$3":"") + ` GROUP BY ol.sku,ol.store_name,ol.product_name ORDER BY SUM(ABS(ol.quantity)) DESC LIMIT 50`, [startDate,endDate,...(storeFilter?[storeFilter]:[])]);
    const skus = r.rows.map(row => {
      const qty=Number(row.total_qty||0),gross=Number(row.total_gross||0),sd=Number(row.total_sd||0);
      const omzet=Math.round(Math.max(gross-sd,Number(row.total_oa||0)));
      const hpp=Math.round(qty*Number(row.hpp_unit||0)),packing=Math.round(qty*Number(row.packing_unit||0));
      const fee=Math.round(Number(row.total_fee||0)),profit=omzet-hpp-packing-fee;
      return { sku:row.sku,store:row.store_name,product:row.product_name||"",qty,omzet,hpp,packing,fee,profit,margin:omzet>0?Math.round((profit/omzet)*1000)/10:0 };
    });
    const sorted=[...skus].sort((a,b)=>b.profit-a.profit);
    return { generatedAt:nowIso(), topSku:sorted.filter(s=>s.profit>0).slice(0,10), weakSku:skus.filter(s=>s.profit<=0).slice(0,10), total:skus.length };
  } catch(e) { return { generatedAt:nowIso(), topSku:[], weakSku:[], error:e.message }; }
}

// ── Type: orders — detail order lines, paginated ──
async function computeOrders(filters, q) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return { generatedAt:nowIso(), items:[], total:0 };
  const [startDate,endDate] = dateRangeFromFilters(filters);
  if (!startDate||!endDate) return { generatedAt:nowIso(), items:[], total:0 };
  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;
  const limit = Math.min(parseInt(q.limit||"50",10),200);
  const offset = parseInt(q.offset||"0",10);
  const sortBy = q.sortBy||"created_at";
  const sortDir = q.sortDir||"desc";
  const status = q.status||"";
  const allowedSort = { created_at:"created_at", order_amount:"order_amount", quantity:"quantity", gross_product:"gross_product" };
  const orderCol = allowedSort[sortBy]||"created_at";
  const orderDir = sortDir==="asc"?"ASC":"DESC";
  try {
    let where = `WHERE created_at>=$1 AND created_at<($2::date+interval'1 day')::text`;
    const p = [startDate,endDate];
    if (storeFilter) { where += ` AND store_name=$${p.length+1}`; p.push(storeFilter); }
    if (status) {
      if (status==="cancelled") { where += ` AND (LOWER(TRIM(status)) IN ('dibatalkan','cancellations','cancelled','canceled','cancel','returned','return','returnrefund','refundreturn') OR LOWER(TRIM(status)) LIKE '%retur%')`; }
      else { where += ` AND LOWER(TRIM(status))=LOWER($${p.length+1})`; p.push(status); }
    }
    const countR = await pg.pgQuery(`SELECT COUNT(*) AS total FROM finance_order_lines ${where}`, p);
    const total = Number(countR.rows[0]?.total||0);
    const r = await pg.pgQuery(`SELECT store_name,order_id,status,sku,product_name,quantity,gross_product,seller_discount,order_amount,platform_fee,settlement_received,refund_amount,created_at,source FROM finance_order_lines ${where} ORDER BY "${orderCol}" ${orderDir} LIMIT ${limit} OFFSET ${offset}`, p);
    safeLog("split_orders",{ms:Date.now()-startedAt,rows:r.rows.length,total});
    return { generatedAt:nowIso(), items:r.rows, total, limit, offset, hasMore:(offset+limit)<total };
  } catch(e) { return { generatedAt:nowIso(), items:[], total:0, error:e.message }; }
}

// ── Type: operation — status order summary ──
async function computeOperation(filters) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return { generatedAt:nowIso(), status:[], operationStatus:[], operationDetails:[] };
  const [startDate,endDate] = dateRangeFromFilters(filters);
  if (!startDate||!endDate) return { generatedAt:nowIso(), status:[], operationStatus:[], operationDetails:[] };
  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;
  try {
    const r = await pg.pgQuery(`SELECT status,COUNT(*) AS cnt FROM finance_order_lines WHERE created_at>=$1 AND created_at<($2::date+interval'1 day')::text${storeFilter?" AND store_name=$3":""} GROUP BY status ORDER BY cnt DESC`, [startDate,endDate,...(storeFilter?[storeFilter]:[])]);
    const status = r.rows.map(row=>({ status:row.status, count:Number(row.cnt||0) }));
    return { generatedAt:nowIso(), status, operationStatus:status };
  } catch(e) { return { generatedAt:nowIso(), status:[], operationStatus:[], error:e.message }; }
}

// ── Type: stores — per-store summary ──
async function computeStores(filters) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return { generatedAt:nowIso(), stores:[] };
  const [startDate,endDate] = dateRangeFromFilters(filters);
  if (!startDate||!endDate) return { generatedAt:nowIso(), stores:[] };
  try {
    const r = await pg.pgQuery(`SELECT store_name,COUNT(DISTINCT order_id) AS orders,COALESCE(SUM(ABS(gross_product)),0) AS gross,COALESCE(SUM(ABS(seller_discount)),0) AS sd,COALESCE(SUM(ABS(order_amount)),0) AS oa FROM finance_order_lines WHERE created_at>=$1 AND created_at<($2::date+interval'1 day')::text GROUP BY store_name`, [startDate,endDate]);
    const stores = r.rows.map(row => ({ store:row.store_name, orders:Number(row.orders||0), omzet:Math.round(Number(row.gross||0)-Number(row.sd||0)) }));
    return { generatedAt:nowIso(), stores };
  } catch(e) { return { generatedAt:nowIso(), stores:[] }; }
}

function emptyMini(msg) { return { generatedAt:nowIso(), totals:{orders:0,lines:0,gross:0,sellerDiscount:0,omzet:0,platformFee:0,settlement:0,refund:0,adSpend:0,hpp:0,packing:0,profit:0,margin:0,cancelledOrders:0}, error:msg||undefined }; }

function dateRangeFromFilters(f) {
  if(f.preset==="month"&&f.month){const[y,m]=f.month.split("-").map(Number);return[`${y}-${String(m).padStart(2,"0")}-01`,new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)];}
  const t=new Date().toISOString().slice(0,10);if(f.preset==="thisMonth")return[t.slice(0,8)+"01",t];
  if(f.startDate&&f.endDate)return[f.startDate,f.endDate];
  const d7=new Date(Date.now()-6*86400000).toISOString().slice(0,10);
  return f.preset==="last7"?[d7,t]:["",""];
}

module.exports = handler;
