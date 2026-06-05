const pg = require("../lib/pg-connector");
const { json, buildFilters, requireOwner, nowIso, safeLog, normalizeStore } = require("../lib/finance-cloud");

async function computeSku(filters) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return { generatedAt: nowIso(), topSku: [], weakSku: [] };
  const [startDate, endDate] = dateRangeFromFilters(filters);
  if (!startDate || !endDate) return { generatedAt: nowIso(), topSku: [], weakSku: [] };
  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;
  try {
    let sql = "SELECT ol.sku, ol.store_name, ol.product_name, COUNT(*) AS line_count, COUNT(DISTINCT ol.order_id) AS order_count, SUM(ABS(ol.quantity)) AS total_qty, SUM(ABS(ol.gross_product)) AS total_gross, SUM(ABS(ol.seller_discount)) AS total_sd, SUM(ABS(ol.order_amount)) AS total_oa, SUM(ABS(ol.platform_fee)) AS total_fee, COALESCE(AVG(sk.hpp_per_unit),0) AS hpp_unit, COALESCE(AVG(sk.packing_per_unit),0) AS packing_unit FROM finance_order_lines ol LEFT JOIN finance_sku_costs sk ON LOWER(sk.store_name||'|'||sk.sku)=LOWER(ol.store_name||'|'||ol.sku) OR LOWER('global|'||sk.sku)=LOWER(ol.store_name||'|'||ol.sku) WHERE ol.created_at>=$1 AND ol.created_at<($2::date+interval'1 day')::text";
    const p = [startDate, endDate];
    if (storeFilter) { sql += " AND ol.store_name=$3"; p.push(storeFilter); }
    sql += " GROUP BY ol.sku, ol.store_name, ol.product_name ORDER BY SUM(ABS(ol.quantity)) DESC LIMIT 50";
    const r = await pg.pgQuery(sql, p);
    const skus = r.rows.map(row => {
      const qty = Number(row.total_qty||0), gross = Number(row.total_gross||0), sd = Number(row.total_sd||0);
      const omzet = Math.round(Math.max(gross - sd, Number(row.total_oa||0)));
      const hpp = Math.round(qty * Number(row.hpp_unit||0)), packing = Math.round(qty * Number(row.packing_unit||0));
      const fee = Math.round(Number(row.total_fee||0)), profit = omzet - hpp - packing - fee;
      return { sku:row.sku, store:row.store_name, product:row.product_name||"", qty, omzet, hpp, packing, fee, profit, margin: omzet>0 ? Math.round((profit/omzet)*1000)/10 : 0 };
    });
    const sorted = [...skus].sort((a,b) => b.profit - a.profit);
    const topSku = sorted.filter(s => s.profit>0).slice(0,10);
    const weakSku = skus.filter(s => s.profit<=0).slice(0,10);
    safeLog("sku_summary",{ms:Date.now()-startedAt,skus:skus.length});
    return { generatedAt: nowIso(), topSku, weakSku };
  } catch(error) { return { generatedAt: nowIso(), topSku:[], weakSku:[], error:error.message }; }
}

function dateRangeFromFilters(f) {
  if(f.preset==="month"&&f.month){const[y,m]=f.month.split("-").map(Number);return[`${y}-${String(m).padStart(2,"0")}-01`,new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)];}
  const t=new Date().toISOString().slice(0,10);if(f.preset==="thisMonth")return[t.slice(0,8)+"01",t];
  if(f.startDate&&f.endDate)return[f.startDate,f.endDate];
  const d7=new Date(Date.now()-6*86400000).toISOString().slice(0,10);
  return f.preset==="last7"?[d7,t]:["",""];
}

module.exports = async function handler(req,res) {
  if(req.method!=="GET")return json(res,405,{ok:false,error:"Method tidak didukung."});
  try {
    const q=req.query||{},filters=buildFilters({preset:q.preset||"thisMonth",month:q.month,store:q.store});
    const role=q.role||"owner";if(role==="owner"&&!(await requireOwner(req,res)))return;
    return json(res,200,await computeSku(filters));
  } catch(error) { return json(res,200,{ generatedAt: nowIso(), topSku:[], weakSku:[], error:error.message }); }
};
