const { json, buildFilters, computeSummary, sendTelegram } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { ok: false, error: "Unauthorized" });
  }
  try {
    const summary = await computeSummary(buildFilters({ preset: "all", store: "all" }));
    await sendTelegram(summary);
    return json(res, 200, { ok: true, message: "Ringkasan harian dikirim." });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
};
