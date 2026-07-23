(function () {
  const CHUNK = 2000;

  async function uploadForm(form, api, notify) {
    const fileInput = form.querySelector('input[type="file"]');
    const files = Array.from(fileInput.files || []);
    if (!files.length) throw new Error("Pilih minimal satu file terlebih dahulu.");
    const storeName = form.elements.storeName.value || "ventura";
    const kind = form.elements.kind.value || "auto";
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Membaca..."; }
    const results = [];
    try {
      for (const file of files) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        
        // For small files (< 2MB), send directly as multipart (faster server-side)
        if (file.size < 2 * 1024 * 1024) {
          if (submitButton) submitButton.textContent = "Upload " + file.name + " (" + sizeMB + "MB)...";
          if (notify) notify("Mengirim " + file.name + "...", "info", false);
          const fd = new FormData();
          fd.append("storeName", storeName);
          fd.append("kind", kind);
          fd.append("files", file, file.name);
          const result = await api("/api/upload", { method: "POST", body: fd });
          results.push(result);
          continue;
        }
        
        // Large files: read in browser, send as JSON chunks
        if (submitButton) submitButton.textContent = "Membaca " + file.name + " (" + sizeMB + "MB)...";
        if (notify) notify("Membaca " + file.name + " di browser...", "info", false);
        
        if (!window.XLSX) throw new Error("Library Excel belum siap. Refresh halaman.");
        const buffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(buffer, { type: "array", cellDates: true, raw: false });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
        
        if (!rows.length) throw new Error("File " + file.name + " kosong.");
        
        const totalParts = Math.ceil(rows.length / CHUNK);
        if (notify) notify("Mengirim " + rows.length + " baris (" + totalParts + " bagian)...", "info", false);
        
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const part = Math.floor(i / CHUNK) + 1;
          if (submitButton) submitButton.textContent = "Upload " + file.name + " " + part + "/" + totalParts;
          if (notify && totalParts > 1) notify("Bagian " + part + "/" + totalParts + "...", "info", false);
          const result = await api("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeName, kind, filename: totalParts > 1 ? file.name + " (" + part + "/" + totalParts + ")" : file.name, rows: chunk }),
          });
          results.push(result);
        }
      }
      return results;
    } finally {
      if (submitButton) { submitButton.textContent = "Upload"; submitButton.disabled = false; }
    }
  }
  window.CloudFinance = { uploadForm };
})();
