const { json, buildFilters, computeSummary, redactSummary, emptySummary, requireOwner } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const query = req.query || {};
    const filters = buildFilters({
      preset: query.preset,
      month: query.month,
      store: query.store,
    });
    const summary = await computeSummary(filters);
    const role = query.role || "owner";
    if (role === "owner" && !(await requireOwner(req, res))) return;
    return json(res, 200, role === "owner" ? summary : redactSummary(summary, role));
  } catch (error) {
    return json(res, 200, emptySummary(error.message));
  }
};
