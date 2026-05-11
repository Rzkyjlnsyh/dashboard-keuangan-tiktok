const { json } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  return json(res, 400, {
    ok: false,
    error: "Data contoh tidak dipakai di Vercel. Upload file real toko langsung dari menu Upload agar masuk ke Supabase.",
  });
};
