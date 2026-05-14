const { json, readJson, importRows } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      const payload = await readMultipart(req, contentType);
      const results = [];
      for (const file of payload.files) {
        if (!/\.xlsx$/i.test(file.filename)) {
          return json(res, 400, { ok: false, error: "Upload file mentah di Vercel hanya untuk Excel .xlsx. File CSV tetap diproses dari browser." });
        }
        const rows = readXlsxRows(file.buffer);
        if (!rows.length) throw new Error(`File ${file.filename} kosong atau header tidak terbaca.`);
        const result = await importRows({
          storeName: payload.fields.storeName,
          kind: payload.fields.kind || "auto",
          filename: file.filename || "upload.xlsx",
          rows,
        });
        results.push(result);
      }
      return json(res, 200, { ok: true, results });
    }
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

async function readBuffer(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "binary");
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function splitBuffer(buffer, separator) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

async function readMultipart(req, contentType) {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("Boundary upload tidak ditemukan.");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const raw = await readBuffer(req);
  const fields = {};
  const files = [];
  for (const rawPart of splitBuffer(raw, boundary)) {
    let part = rawPart;
    if (!part.length || part.equals(Buffer.from("--\r\n")) || part.equals(Buffer.from("--"))) continue;
    if (part.slice(0, 2).toString() === "\r\n") part = part.slice(2);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);
    if (part.slice(-2).toString() === "--") part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;
    const header = part.slice(0, headerEnd).toString("utf8");
    let body = part.slice(headerEnd + 4);
    if (body.slice(-2).toString() === "\r\n") body = body.slice(0, -2);
    const name = (header.match(/name="([^"]+)"/i) || [])[1] || "";
    const filename = (header.match(/filename="([^"]*)"/i) || [])[1];
    if (!name) continue;
    if (filename !== undefined) {
      if (filename) files.push({ name, filename, buffer: body });
    } else {
      fields[name] = body.toString("utf8");
    }
  }
  return { fields, files };
}

function formatCell(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  return value == null ? "" : value;
}

function getSheetRange(XLSX, sheet) {
  const cells = Object.keys(sheet || {})
    .filter(key => key && key[0] !== "!")
    .map(key => XLSX.utils.decode_cell(key));
  if (!cells.length) return XLSX.utils.decode_range("A1:A1");
  return cells.reduce((range, cell) => ({
    s: { r: Math.min(range.s.r, cell.r), c: Math.min(range.s.c, cell.c) },
    e: { r: Math.max(range.e.r, cell.r), c: Math.max(range.e.c, cell.c) },
  }), { s: { ...cells[0] }, e: { ...cells[0] } });
}

function sheetHeaderTokens(XLSX, sheet) {
  const range = getSheetRange(XLSX, sheet);
  const tokens = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
    const value = cell && (cell.w != null ? cell.w : cell.v);
    tokens.push(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, ""));
  }
  return tokens.join("|");
}

function pickSheet(XLSX, workbook) {
  if (workbook.SheetNames.includes("Daftar Pesanan")) return "Daftar Pesanan";
  const incomeSheet = workbook.SheetNames.find(name => {
    const tokens = sheetHeaderTokens(XLSX, workbook.Sheets[name]);
    const hasOrderId = tokens.includes("orderadjustmentid") || tokens.includes("idpesananpenyesuaian");
    const hasSettlement = tokens.includes("totalsettlementamount") || tokens.includes("jumlahpenyelesaianpembayaran");
    return hasOrderId && hasSettlement;
  });
  return incomeSheet || workbook.SheetNames[0];
}

function readXlsxRows(buffer) {
  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch (error) {
    throw new Error("Server belum punya dependency pembaca Excel. Tunggu deploy Vercel selesai lalu coba lagi.");
  }
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false, nodim: true, sheetRows: 0 });
  const sheetName = pickSheet(XLSX, workbook);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const range = getSheetRange(XLSX, sheet);
  const headers = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
    const value = cell && (cell.w != null ? cell.w : formatCell(cell.v));
    headers.push(String(value || "").replace(/^\uFEFF/, "").replace(/\n/g, " ").trim());
  }
  const rows = [];
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const row = {};
    let hasValue = false;
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const header = headers[col - range.s.c];
      if (!header) continue;
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: col })];
      const value = cell && (cell.w != null ? cell.w : formatCell(cell.v));
      if (value !== "" && value != null) hasValue = true;
      row[header] = value == null ? "" : value;
    }
    if (hasValue) rows.push(row);
  }
  return rows;
}
