const { json, readJson, saveAdSpend, requireOwner, fetchAll } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const store = (req.query||{}).store || "all";
      const storeFilter = store !== "all" ? `store_name=eq.${encodeURIComponent(store)}` : "";
      const rows = await fetchAll("finance_ad_spend", "select=*&order=spend_date.desc&limit=50&"+storeFilter);
      return json(res, 200, { ok: true, rows });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method tidak didukung." });
    if (!(await requireOwner(req, res))) return;
    const body = await readJson(req);
    const saved = await saveAdSpend(body);
    return json(res, 200, { ok: true, ...saved });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
};
