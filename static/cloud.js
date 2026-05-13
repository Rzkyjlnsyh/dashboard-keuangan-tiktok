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
        clean[String(key || "").replace(/^\uFEFF/, "").replace(/\n/g, " ").trim()] = formatCell(value);
      }
      return clean;
    });
  }

  async function readRows(file) {
    if (!window.XLSX) {
      throw new Error("Library pembaca Excel belum siap. Coba refresh halaman Vercel, lalu upload ulang.");
    }
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: "array", cellDates: true, raw: false, nodim: true, sheetRows: 0 });
    const sheetName = pickSheet(workbook);
    if (!sheetName) throw new Error(`File ${file.name} tidak memiliki sheet yang bisa dibaca.`);
    const sheet = workbook.Sheets[sheetName];
    const range = getSheetRange(sheet);
    const cellText = (row, col) => {
      const cell = sheet[window.XLSX.utils.encode_cell({ r: row, c: col })];
      if (!cell) return "";
      return cell.w != null ? cell.w : formatCell(cell.v);
    };
    const headers = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      headers.push(String(cellText(range.s.r, col) || "").replace(/^\uFEFF/, "").replace(/\n/g, " ").trim());
    }
    const rows = [];
    for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
      const row = {};
      let hasValue = false;
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const header = headers[col - range.s.c];
        if (!header) continue;
        const value = cellText(rowIndex, col);
        if (value !== "") hasValue = true;
        row[header] = value;
      }
      if (hasValue) rows.push(row);
    }
    return cleanRows(rows);
  }

  function getSheetRange(sheet) {
    const cells = Object.keys(sheet || {})
      .filter(key => key && key[0] !== "!")
      .map(key => window.XLSX.utils.decode_cell(key));
    if (!cells.length) return window.XLSX.utils.decode_range("A1:A1");
    return cells.reduce((range, cell) => ({
      s: { r: Math.min(range.s.r, cell.r), c: Math.min(range.s.c, cell.c) },
      e: { r: Math.max(range.e.r, cell.r), c: Math.max(range.e.c, cell.c) },
    }), { s: { ...cells[0] }, e: { ...cells[0] } });
  }

  function sheetHeaderTokens(sheet) {
    const range = getSheetRange(sheet);
    const tokens = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const cell = sheet[window.XLSX.utils.encode_cell({ r: range.s.r, c: col })];
      const value = cell && (cell.w != null ? cell.w : cell.v);
      tokens.push(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, ""));
    }
    return tokens.join("|");
  }

  function pickSheet(workbook) {
    if (workbook.SheetNames.includes("Daftar Pesanan")) return "Daftar Pesanan";
    const incomeSheet = workbook.SheetNames.find(name => {
      const tokens = sheetHeaderTokens(workbook.Sheets[name]);
      return tokens.includes("orderadjustmentid") && tokens.includes("totalsettlementamount");
    });
    return incomeSheet || workbook.SheetNames[0];
  }

  async function uploadForm(form, api, notify) {
    const fileInput = form.querySelector('input[type="file"]');
    const files = Array.from(fileInput.files || []);
    if (!files.length) throw new Error("Pilih minimal satu file terlebih dahulu.");
    const storeName = form.elements.storeName.value || "ventura";
    const kind = form.elements.kind.value || "auto";
    const submitButton = form.querySelector('button[type="submit"], button:not([type])');
    const originalText = submitButton ? submitButton.textContent : "";
    const results = [];
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Memproses file...";
    }
    try {
      for (const file of files) {
        let rows = await readRows(file);
        if (!rows.length) throw new Error(`File ${file.name} kosong atau header tidak terbaca.`);
        // Dedup by generating a rough hash of row content — remove exact duplicates
        const seen = new Set();
        const deduped = [];
        for (const row of rows) {
          const hash = JSON.stringify(Object.values(row).sort());
          // Build key from critical fields if possible
          const orderId = (row["Nomor Pesanan (di Marketplace)"] || row["Order ID"] || row["Order/adjustment ID"] || "").toString().trim();
          const sku = (row["SKU Marketplace"] || row["Seller SKU"] || "").toString().trim();
          const store = (row["Channel - Nama Toko"] || row["Warehouse Name"] || storeName || "").toString().trim();
          const variation = (row["VariaProduk"] || row["Variation"] || row["Varian Produk"] || "").toString().trim();
          const dedupKey = `${store}|${orderId}|${sku}|${variation}`.toLowerCase();
          if (dedupKey.replace(/[|]+/g, "").trim()) {
            // Use meaningful dedup key if we have order info
            if (!seen.has(dedupKey)) {
              seen.add(dedupKey);
              deduped.push(row);
            }
          } else if (!seen.has(hash)) {
            // Fallback to full content hash
            seen.add(hash);
            deduped.push(row);
          }
        }
        if (deduped.length < rows.length) {
          const removed = rows.length - deduped.length;
          if (notify) notify(`⚠️ ${removed} baris duplikat dalam ${file.name} dilewati`, "info", false);
        }
        rows = deduped;
        for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
          const chunk = rows.slice(start, start + CHUNK_SIZE);
          const part = Math.floor(start / CHUNK_SIZE) + 1;
          const totalParts = Math.ceil(rows.length / CHUNK_SIZE);
          if (submitButton) submitButton.textContent = `Upload ${file.name} ${part}/${totalParts}`;
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
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }
  }

  window.CloudFinance = { uploadForm };
}());
