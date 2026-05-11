const { json, readJson, importRows } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const body = await readJson(req);
    if (!Array.isArray(body.rows)) {
      return json(res, 400, { ok: false, error: "Upload Vercel memakai pembaca Excel/CSV di browser. Refresh halaman lalu pilih file lagi." });
    }
    const result = await importRows({
      storeName: body.storeName,
      kind: body.kind || "auto",
      filename: body.filename || "upload",
      rows: body.rows,
    });
    return json(res, 200, result);
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
};
