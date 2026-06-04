const { json, buildFilters, computeDataQuality, emptySummary, requireOwner } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const query = req.query || {};
    const filters = buildFilters({
      preset: query.preset,
      month: query.month,
      store: query.store,
    });
    const data = await computeDataQuality(filters);
    const role = query.role || "owner";
    if (role === "owner" && !(await requireOwner(req, res))) return;
    return json(res, 200, data);
  } catch (error) {
    return json(res, 200, {
      generatedAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }),
      statusKeseluruhan: "error",
      skorKualitas: 0,
      ringkasan: "Gagal memuat data quality: " + error.message,
      skuTanpaHpp: [], orderTanpaPencairan: [], pencairanTanpaOrder: [], cancelRefundBesar: [], dataDuplikat: [],
      saran: ["Cek Vercel Function Logs untuk detail error."],
      diagnostics: { error: error.message },
    });
  }
};
