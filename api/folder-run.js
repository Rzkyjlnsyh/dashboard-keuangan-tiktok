const { json } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  return json(res, 400, {
    ok: false,
    error: "Scan folder harus dijalankan dari laptop/server yang punya akses ke folder download. Dashboard Vercel membaca hasilnya dari Supabase.",
  });
};
