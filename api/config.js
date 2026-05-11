const { json, readJson, readConfig, saveConfig, safeConfig, supabaseConfigured, supabaseSetupMessage } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const config = await readConfig();
      return json(res, 200, { ...safeConfig(config), supabaseConnected: supabaseConfigured(), supabaseMessage: supabaseConfigured() ? "" : supabaseSetupMessage() });
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const config = await saveConfig(body);
      return json(res, 200, { ok: true, ...config });
    }
    return json(res, 405, { ok: false, error: "Method tidak didukung." });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
};
