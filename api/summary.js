const { json, buildFilters, computeSummary, redactSummary, emptySummary, requireOwner, safeLog } = require("../lib/finance-cloud");
const pg = require("../lib/pg-connector");

async function cachedOrCompute(cacheKey, computeFn, ttlSeconds) {
  try {
    const result = await pg.pgQuery(
      "SELECT result, generated_at FROM finance_summary_cache WHERE cache_key = $1 AND expires_at > NOW()",
      [cacheKey]
    );
    if (result.rows.length > 0) {
      const cached = result.rows[0];
      const data = typeof cached.result === 'string' ? JSON.parse(cached.result) : cached.result;
      data._cache = 'hit';
      data._cachedAt = cached.generated_at;
      return data;
    }
  } catch (e) { safeLog("cache_read_err", {key: cacheKey, err: e.message}); }

  const data = await computeFn();
  
  try {
    await pg.pgQuery(
      "INSERT INTO finance_summary_cache (cache_key, result, generated_at, expires_at) VALUES ($1, $2::jsonb, $3, NOW() + ($4 || ' seconds')::interval) ON CONFLICT (cache_key) DO UPDATE SET result = $2::jsonb, generated_at = $3, expires_at = NOW() + ($4 || ' seconds')::interval",
      [cacheKey, JSON.stringify(data), data.generatedAt || new Date().toISOString(), String(ttlSeconds || 300)]
    );
    safeLog("cache_write", {key: cacheKey, ttl: ttlSeconds || 300});
  } catch (e) { safeLog("cache_write_err", {key: cacheKey, err: e.message}); }
  
  data._cache = 'miss';
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const query = req.query || {};
    const role = query.role || "owner";
    if (role === "owner" && !(await requireOwner(req, res))) return;

    const filters = buildFilters({ preset: query.preset, month: query.month, store: query.store });
    const cacheKey = "summary_" + filters.preset + "_" + (filters.month || "") + "_" + (filters.store || "all");
    const ttl = filters.preset === "thisMonth" ? 120 : 300;
    const summary = await cachedOrCompute(cacheKey, () => computeSummary(filters), ttl);
    
    return json(res, 200, role === "owner" ? summary : redactSummary(summary, role));
  } catch (error) {
    return json(res, 200, emptySummary(error.message));
  }
};
