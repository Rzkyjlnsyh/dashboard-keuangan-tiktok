const pg = require("../lib/pg-connector");
const { json, buildFilters, requireOwner, nowIso, normalizeStore, safeLog } = require("../lib/finance-cloud");

async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const q = req.query || {};
    const type = q.type || "mini";
    const filters = buildFilters({ preset: q.preset || "thisMonth", month: q.month, store: q.store });
    const role = q.role || "owner";
    if (role === "owner" && !(await requireOwner(req, res))) return;

    if (type === "mini") return json(res, 200, await computeMini(filters));
    if (type === "sku") return json(res, 200, await computeSku(filters));
    if (type === "daily") return json(res, 200, await computeDaily(filters));
    return json(res, 400, { error: 'type harus mini, sku, atau daily' });
  } catch (error) {
    return json(res, 200, { generatedAt: nowIso(), error: error.message });
  }
}

async function computeMini(filters) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return emptyMini();
  const [startDate, endDate] = dateRangeFromFilters(filters);
  if (!startDate || !endDate) return emptyMini();
  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;
  try {
    let sql = "SELECT COUNT(DISTINCT order_id) AS total_orders,COUNT(*) AS total_lines,COALESCE(SUM(ABS(gross_product)),0) AS total_gross,COALESCE(SUM(ABS(seller_discount)),0) AS total_sd,COALESCE(SUM(ABS(order_amount)),0) AS total_oa,COALESCE(SUM(ABS(platform_fee)),0) AS total_fee,COALESCE(SUM(ABS(settlement_received)),0) AS total_settlement,COALESCE(SUM(ABS(refund_amount)),0) AS total_refund FROM finance_order_lines WHERE created_at>=$1 AND created_at<($2::date+interval'1 day')::text";
    const p = [startDate, endDate];
    if (storeFilter) { sql += " AND store_name=$3"; p.push(storeFilter); }
    const r = await pg.pgQuery(sql, p);
    const row = r.rows[0] || {};
    let cs = "SELECT COUNT(DISTINCT order_id) AS cnt FROM finance_order_lines WHERE created_at>=$1 AND created_at<($2::date+interval'1 day')::text AND (LOWER(TRIM(status)) IN ('dibatalkan','cancellations','cancelled','canceled','cancel','returned','return','returnrefund','refundreturn') OR LOWER(TRIM(status)) LIKE '%retur%')";
    const cp = [startDate, endDate];
    if (storeFilter) { cs += " AND store_name=$3"; cp.push(storeFilter); }
    const cr = await pg.pgQuery(cs, cp);
    let ads = "SELECT COALESCE(SUM(amount),0) AS t FROM finance_ad_spend WHERE spend_date>=$1 AND spend_date<=$2";
    const ap = [startDate, endDate];
    if (storeFilter) { ads += " AND store_name=$3"; ap.push(storeFilter); }
    const ar = await pg.pgQuery(ads, ap);
    let hs = "SELECT COALESCE(SUM(ABS(ol.quantity)*COALESCE(sk.hpp_per_unit,0)),0) AS hpp,COALESCE(SUM(ABS(ol.quantity)*COALESCE(sk.packing_per_unit,0)),0) AS packing FROM finance_order_lines ol LEFT JOIN finance_sku_costs sk ON LOWER(sk.store_name||'|'||sk.sku)=LOWER(ol.store_name||'|'||ol.sku) OR LOWER('global|'||sk.sku)=LOWER(ol.store_name||'|'||ol.sku) WHERE ol.created_at>=$1 AND ol.created_at<($2::date+interval'1 day')::text";
    const hp = [startDate, endDate];
    if (storeFilter) { hs += " AND ol.store_name=$3"; hp.push(storeFilter); }
    const hr = await pg.pgQuery(hs, hp);
    const gross = Number(row.total_gross||0), sd = Number(row.total_sd||0);
    const omzet = Math.round(gross - sd);
    const pf = Math.round(Number(row.total_fee||0));
    const adSpend = Math.round(Number(ar.rows[0]?.t||0));
    const hpp = Math.round(Number(hr.rows[0]?.hpp||0));
    const packing = Math.round(Number(hr.rows[0]?.packing||0));
    const profit = omzet - pf - hpp - packing - adSpend;
    safeLog("split_mini",{ms:Date.now()-startedAt,orders:Number(row.total_orders||0)});
    return { generatedAt:nowIso(), totals:{ orders:Number(row.total_orders||0), lines:Number(row.total_lines||0), gross:Math.round(gross), sellerDiscount:Math.round(sd), omzet, platformFee:pf, settlement:Math.round(Number(row.total_settlement||0)), refund:Math.round(Number(row.total_refund||0)), adSpend, hpp, packing, profit, margin:omzet>0?Math.round((profit/omzet)*1000)/10:0, cancelledOrders:Number(cr.rows[0]?.cnt||0) }};
  } catch(e) { safeLog("split_mini_error",{error:e.message}); return emptyMini(e.message); }
}

async function computeSku(filters) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return { generatedAt:nowIso(), topSku:[], weakSku:[] };
  const [startDate, endDate] = dateRangeFromFilters(filters);
  if (!startDate || !endDate) return { generatedAt:nowIso(), topSku:[], weakSku:[] };
  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;
  try {
    let sql = "SELECT ol.sku,ol.store_name,ol.product_name,COUNT(*) AS line_count,COUNT(DISTINCT ol.order_id) AS order_count,SUM(ABS(ol.quantity)) AS total_qty,SUM(ABS(ol.gross_product)) AS total_gross,SUM(ABS(ol.seller_discount)) AS total_sd,SUM(ABS(ol.order_amount)) AS total_oa,SUM(ABS(ol.platform_fee)) AS total_fee,COALESCE(AVG(sk.hpp_per_unit),0) AS hpp_unit,COALESCE(AVG(sk.packing_per_unit),0) AS packing_unit FROM finance_order_lines ol LEFT JOIN finance_sku_costs sk ON LOWER(sk.store_name||'|'||sk.sku)=LOWER(ol.store_name||'|'||ol.sku) OR LOWER('global|'||sk.sku)=LOWER(ol.store_name||'|'||ol.sku) WHERE ol.created_at>=$1 AND ol.created_at<($2::date+interval'1 day')::text";
    const p = [startDate, endDate];
    if (storeFilter) { sql += " AND ol.store_name=$3"; p.push(storeFilter); }
    sql += " GROUP BY ol.sku,ol.store_name,ol.product_name ORDER BY SUM(ABS(ol.quantity)) DESC LIMIT 50";
    const r = await pg.pgQuery(sql, p);
    const skus = r.rows.map(row => {
      const qty = Number(row.total_qty||0), gross = Number(row.total_gross||0), sd = Number(row.total_sd||0);
      const omzet = Math.round(Math.max(gross - sd, Number(row.total_oa||0)));
      const hpp = Math.round(qty*Number(row.hpp_unit||0)), packing = Math.round(qty*Number(row.packing_unit||0));
      const fee = Math.round(Number(row.total_fee||0)), profit = omzet - hpp - packing - fee;
      return { sku:row.sku, store:row.store_name, product:row.product_name||"", qty, omzet, hpp, packing, fee, profit, margin:omzet>0?Math.round((profit/omzet)*1000)/10:0 };
    });
    const sorted = [...skus].sort((a,b)=>b.profit-a.profit);
    safeLog("split_sku",{ms:Date.now()-startedAt,skus:skus.length});
    return { generatedAt:nowIso(), topSku:sorted.filter(s=>s.profit>0).slice(0,10), weakSku:skus.filter(s=>s.profit<=0).slice(0,10) };
  } catch(e) { return { generatedAt:nowIso(), topSku:[], weakSku:[], error:e.message }; }
}

async function computeDaily(filters) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return { generatedAt:nowIso(), daily:[] };
  const [startDate, endDate] = dateRangeFromFilters(filters);
  if (!startDate || !endDate) return { generatedAt:nowIso(), daily:[] };
  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;
  try {
    let sql = "SELECT created_at AS day,COUNT(DISTINCT order_id) AS orders,COALESCE(SUM(ABS(gross_product)),0) AS gross FROM finance_order_lines WHERE created_at>=$1 AND created_at<($2::date+interval'1 day')::text";
    const p = [startDate, endDate];
    if (storeFilter) { sql += " AND store_name=$3"; p.push(storeFilter); }
    sql += " GROUP BY created_at ORDER BY created_at ASC";
    const r = await pg.pgQuery(sql, p);
    const daily = r.rows.map(row => ({ date:row.day, orders:Number(row.orders||0), gross:Math.round(Number(row.gross||0)) }));
    safeLog("split_daily",{ms:Date.now()-startedAt,days:daily.length});
    return { generatedAt:nowIso(), daily };
  } catch(e) { return { generatedAt:nowIso(), daily:[], error:e.message }; }
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
