const { json, buildFilters, computeSummary, sendTelegram } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const summary = await computeSummary(buildFilters({ preset: "all", store: "all" }));
    await sendTelegram(summary);
    return json(res, 200, { ok: true, message: "Ringkasan tes dikirim ke Telegram." });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
};
