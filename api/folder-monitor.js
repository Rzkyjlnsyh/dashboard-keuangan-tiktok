const { json } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  return json(res, 400, {
    ok: false,
    error: "Auto update folder tidak bisa membaca folder laptop dari Vercel. Solusinya: local worker membaca folder Desty lalu mengirim hasilnya ke Supabase.",
  });
};
