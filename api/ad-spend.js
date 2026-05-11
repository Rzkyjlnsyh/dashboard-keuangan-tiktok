const { json, readJson, saveAdSpend } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const body = await readJson(req);
    const saved = await saveAdSpend(body);
    return json(res, 200, { ok: true, ...saved });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
};
