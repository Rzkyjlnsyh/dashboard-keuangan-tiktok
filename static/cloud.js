(function () {
  const CHUNK_SIZE = 450;

  function formatCell(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 19).replace("T", " ");
    }
    return value == null ? "" : value;
  }

  function cleanRows(rows) {
    return rows.map(row => {
      const clean = {};
      for (const [key, value] of Object.entries(row || {})) {
        clean[String(key || "").replace(/\n/g, " ").trim()] = formatCell(value);
      }
      return clean;
    });
  }

  async function readRows(file) {
    if (!window.XLSX) {
      throw new Error("Library pembaca Excel belum siap. Coba refresh halaman Vercel, lalu upload ulang.");
    }
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: "array", cellDates: true, raw: false });
    const sheetName = workbook.SheetNames.includes("Daftar Pesanan") ? "Daftar Pesanan" : workbook.SheetNames[0];
    if (!sheetName) throw new Error(`File ${file.name} tidak memiliki sheet yang bisa dibaca.`);
    const sheet = workbook.Sheets[sheetName];
    return cleanRows(window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }));
  }

  async function uploadForm(form, api, notify) {
    const fileInput = form.querySelector('input[type="file"]');
    const files = Array.from(fileInput.files || []);
    if (!files.length) throw new Error("Pilih minimal satu file terlebih dahulu.");
    const storeName = form.elements.storeName.value || "ventura";
    const kind = form.elements.kind.value || "auto";
    const results = [];
    for (const file of files) {
      const rows = await readRows(file);
      if (!rows.length) throw new Error(`File ${file.name} kosong atau header tidak terbaca.`);
      for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
        const chunk = rows.slice(start, start + CHUNK_SIZE);
        const part = Math.floor(start / CHUNK_SIZE) + 1;
        const totalParts = Math.ceil(rows.length / CHUNK_SIZE);
        if (notify && totalParts > 1) notify(`Memproses ${file.name} bagian ${part}/${totalParts}...`, "info", false);
        const result = await api("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeName,
            kind,
            filename: totalParts > 1 ? `${file.name} (${part}/${totalParts})` : file.name,
            rows: chunk,
          }),
        });
        results.push(result);
      }
    }
    return results;
  }

  window.CloudFinance = { uploadForm };
}());
