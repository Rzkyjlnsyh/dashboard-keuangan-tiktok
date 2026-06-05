const pg = require("../lib/pg-connector");
const { json, buildFilters, requireOwner, nowIso, safeLog, normalizeStore } = require("../lib/finance-cloud");

async function computeDaily(filters) {
  const startedAt = Date.now();
  if (!pg.pgConfigured()) return { generatedAt: nowIso(), daily: [] };
  const [startDate, endDate] = dateRangeFromFilters(filters);
  if (!startDate || !endDate) return { generatedAt: nowIso(), daily: [] };
  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;
  try {
    let sql = "SELECT created_at AS day, COUNT(DISTINCT order_id) AS orders, COALESCE(SUM(ABS(gross_product)),0) AS gross FROM finance_order_lines WHERE created_at >= $1 AND created_at < ($2::date + interval '1 day')::text";
    const p = [startDate, endDate];
    if (storeFilter) { sql += " AND store_name=$3"; p.push(storeFilter); }
    sql += " GROUP BY created_at ORDER BY created_at ASC";
    const r = await pg.pgQuery(sql, p);
    const daily = r.rows.map(row => ({ date:row.day, orders:Number(row.orders||0), gross:Math.round(Number(row.gross||0)) }));
    safeLog("daily_trend",{ms:Date.now()-startedAt,days:daily.length});
    return { generatedAt: nowIso(), daily };
  } catch(error) { return { generatedAt: nowIso(), daily: [], error:error.message }; }
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
    return json(res,200,await computeDaily(filters));
  } catch(error) { return json(res,200,{ generatedAt: nowIso(), daily: [], error:error.message }); }
};
