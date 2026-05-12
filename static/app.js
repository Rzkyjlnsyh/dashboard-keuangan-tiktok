const routeRole = location.pathname.includes("tv") ? "tv" : location.pathname.includes("team") ? "team" : "owner";
const isCloudPreview = !["127.0.0.1", "localhost", ""].includes(location.hostname) && location.protocol !== "file:";
const state = {
  view: routeRole === "tv" ? "tv" : routeRole === "team" ? "team" : "owner",
  accessRole: routeRole,
  summary: null,
  config: null,
  filters: { preset: "all", month: "", store: "all" },
  skuSort: "profit",
  skuStatus: "all",
  folderStore: "ventura",
};

const el = (id) => document.getElementById(id);
const fmt = (n) => "Rp" + Math.round(Number(n || 0)).toLocaleString("id-ID");
const fmtCompact = (n) => {
  const value = Math.round(Number(n || 0));
  if (Math.abs(value) >= 1_000_000_000) return "Rp" + (value / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " M";
  if (Math.abs(value) >= 1_000_000) return "Rp" + (value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt";
  if (Math.abs(value) >= 1_000) return "Rp" + (value / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 }) + " rb";
  return fmt(value);
};
const num = (n) => Math.round(Number(n || 0)).toLocaleString("id-ID");
const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const monthLabel = (value) => {
  if (!value || !value.includes("-")) return "Pilih bulan";
  const [year, month] = value.split("-");
  return `${monthNames[Number(month) - 1]} ${year}`;
};
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));

function showNotice(message, level = "warn", popup = false) {
  const text = message || "Terjadi kesalahan.";
  if (el("alerts")) {
    el("alerts").innerHTML = `
      <div class="alert ${level}">
        <strong>Perhatian</strong>
        <div>${escapeHtml(text)}</div>
      </div>
    ` + el("alerts").innerHTML;
  }
  if (popup) window.alert(text);
}

function cloudBlocked(action) {
  if (!isCloudPreview) return false;
  showNotice(`${action} belum bisa membaca folder laptop dari Vercel. Untuk online, upload file langsung di dashboard Vercel; untuk auto-folder 5-10 menit kita butuh worker lokal yang mengirim file Desty ke Supabase.`);
  return true;
}

function setView(view) {
  state.view = view;
  state.accessRole = routeRole !== "owner" ? routeRole : view === "tv" ? "tv" : view === "team" ? "team" : "owner";
  document.body.classList.toggle("tv", view === "tv");
  document.body.classList.toggle("team", view === "team");
  document.body.classList.toggle("restricted", state.accessRole !== "owner");
  document.body.classList.toggle("cloud-preview", isCloudPreview);
  document.querySelectorAll("[data-owner-only]").forEach(btn => btn.hidden = routeRole !== "owner");
  document.querySelectorAll("nav button").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  document.querySelectorAll("[data-show]").forEach(section => {
    const allowed = section.dataset.show.split(",").map(x => x.trim());
    section.hidden = !allowed.includes(view);
  });
  el("pageTitle").textContent =
    view === "tv" ? "Monitor Operasional" :
    view === "team" ? "Dashboard Tim" :
    view === "ops" ? "Upload & Otomatis" :
    view === "sku" ? "Detail SKU" :
    view === "stores" ? "Dashboard Per Toko" :
    "Owner Dashboard";
  el("pageSub").textContent =
    view === "tv" ? "Tampilan aman untuk tim: order, omset, status, dan SKU bergerak cepat." :
    view === "team" ? "Mode aman untuk tim: data operasional terlihat, profit dan biaya rahasia disembunyikan." :
    view === "ops" ? "Upload data terbaru, jalankan auto update folder, dan aktifkan laporan Telegram." :
    view === "sku" ? "Cari SKU yang benar-benar menghasilkan profit dan SKU yang perlu diperbaiki." :
    view === "stores" ? "Bandingkan performa ventura, giftyours, dan custombase dalam satu layar." :
    "Profit, dana tertahan, potongan, HPP, forecast, dan rekomendasi asisten.";
  el("trendTitle").textContent = state.accessRole !== "owner" ? "Omset 30 Hari" : "Omset & Profit 30 Hari";
  refresh().catch(err => alert(err.message));
}

function withOwnerPin(options = {}) {
  const headers = new Headers(options.headers || {});
  const pin = localStorage.getItem("pareOwnerPin") || "";
  if (pin) headers.set("X-Owner-Pin", pin);
  return { ...options, headers };
}

async function api(path, options, retryOwnerPin = true) {
  const res = await fetch(path, withOwnerPin(options || {}));
  let data;
  try {
    data = await res.json();
  } catch (error) {
    throw new Error("Server belum mengirim jawaban yang bisa dibaca. Coba refresh halaman atau gunakan dashboard lokal.");
  }
  if (res.status === 401 && data.ownerLocked && retryOwnerPin && state.accessRole === "owner") {
    const pin = window.prompt("Masukkan PIN Owner");
    if (pin) {
      localStorage.setItem("pareOwnerPin", pin);
      return api(path, options, false);
    }
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || "Terjadi kesalahan");
  return data;
}

function summaryUrl() {
  const params = new URLSearchParams();
  params.set("preset", state.filters.preset);
  if (state.filters.month) params.set("month", state.filters.month);
  params.set("store", state.filters.store);
  params.set("role", state.accessRole);
  return "/api/summary?" + params.toString();
}

async function refresh() {
  const summary = await api(summaryUrl());
  state.summary = summary;
  render(summary);
}

function populateStores(stores) {
  const options = [`<option value="all">Semua Toko</option>`].concat(
    stores.map(s => `<option value="${s}">${s}</option>`)
  ).join("");
  const storeValue = el("storeFilter").value || state.filters.store;
  el("storeFilter").innerHTML = options;
  el("storeFilter").value = [...el("storeFilter").options].some(opt => opt.value === storeValue) ? storeValue : state.filters.store;
  const uploadOptions = stores.map(s => `<option value="${s}">${s}</option>`).join("");
  const uploadValue = el("uploadStore").value;
  const folderValue = el("folderStore").value || state.folderStore;
  const adValue = el("adStore").value;
  el("uploadStore").innerHTML = uploadOptions;
  el("folderStore").innerHTML = uploadOptions;
  el("adStore").innerHTML = uploadOptions;
  if (uploadValue) el("uploadStore").value = uploadValue;
  if (folderValue) el("folderStore").value = folderValue;
  if (adValue) el("adStore").value = adValue;
}

function populateMonths(months) {
  const monthSelect = el("monthFilter");
  const previous = state.filters.month || monthSelect.value;
  monthSelect.innerHTML = months.length
    ? months.map(month => `<option value="${month}">${monthLabel(month)}</option>`).join("")
    : `<option value="">Belum ada data bulan</option>`;
  if (previous && months.includes(previous)) {
    monthSelect.value = previous;
  } else if (months.length) {
    monthSelect.value = months[0];
    if (!state.filters.month) state.filters.month = months[0];
  }
}

function render(summary) {
  const t = summary.totals;
  el("generatedAt").textContent = summary.generatedAt;
  el("orders").textContent = num(t.orders);
  el("todayOrders").textContent = "Hari ini " + num(t.todayOrders);
  el("omzet").textContent = fmtCompact(t.omzet);
  el("profit").textContent = fmtCompact(t.profit);
  el("margin").textContent = `${Number(t.margin || 0).toFixed(1)}% margin`;
  el("finalProfit").textContent = fmtCompact(t.finalProfit);
  el("finalProfitMeta").textContent = `${num(t.finalOrders || 0)} order final · ${Number(t.finalMargin || 0).toFixed(1)}%`;
  el("estimatedProfit").textContent = fmtCompact(t.estimatedProfit);
  el("estimatedProfitMeta").textContent = `${num(t.estimatedOrders || 0)} order belum final · ${Number(t.estimatedMargin || 0).toFixed(1)}%`;
  el("held").textContent = fmtCompact(t.held);
  el("heldMeta").textContent = `${num(t.heldOrders || 0)} order belum cair`;
  el("platformFee").textContent = fmtCompact(t.platformFee);
  el("adSpend").textContent = fmtCompact(t.adSpend);
  el("hpp").textContent = fmtCompact(Number(t.hpp || 0) + Number(t.packing || 0));
  renderAlerts(summary.alerts);
  renderStatus(summary.status);
  renderTable("topSku", summary.topSku);
  renderTable("weakSku", summary.weakSku);
  renderSkuDetail(summary);
  renderRuns(summary.runs);
  renderAuditEvents(summary.auditEvents || []);
  renderAdSpendRows(summary.adSpendRows || []);
  renderAssistant(summary.assistant);
  renderStores(summary.stores);
  drawTrend(summary.daily);
  if (summary.availableStores) populateStores(summary.availableStores);
  if (summary.availableMonths) populateMonths(summary.availableMonths);
}

function renderAlerts(alerts) {
  el("alerts").innerHTML = alerts.length ? alerts.map(a => `
    <div class="alert ${a.level}">
      <strong>${a.title}</strong>
      <div>${a.body}</div>
    </div>`).join("") : `<div class="alert"><strong>Kondisi normal</strong><div>Belum ada alert besar dari data terakhir.</div></div>`;
}

function renderAssistant(assistant) {
  el("healthScore").textContent = `${assistant.score}/100`;
  el("heroScore").textContent = Math.round(Number(assistant.score || 0));
  el("heroHealth").textContent = assistant.health || "Menunggu Data";
  el("heroForecast").textContent = `Forecast ${fmtCompact(assistant.forecast30Omzet || 0)}`;
  el("heroRing").style.setProperty("--score", Math.max(0, Math.min(100, Number(assistant.score || 0))) + "%");
  el("forecastOmzet").textContent = fmtCompact(assistant.forecast30Omzet);
  el("forecastProfit").textContent = fmtCompact(assistant.forecast30Profit);
  const insights = assistant.insights.map(x => `<li>${x}</li>`).join("");
  const actions = assistant.actions.map(x => `<li>${x}</li>`).join("");
  el("assistant").innerHTML = `
    <div class="health ${assistant.score >= 75 ? "good" : assistant.score >= 55 ? "watch" : "bad"}">
      <span>Status bisnis</span><strong>${assistant.health}</strong>
    </div>
    <h3>Yang saya baca dari data</h3>
    <ul>${insights}</ul>
    <h3>Langkah yang saya sarankan</h3>
    <ul>${actions}</ul>
  `;
  const a = assistant.accounting;
  el("accountingBox").innerHTML = `
    <div><span>Omzet Kotor</span><strong>${fmt(a.omzetKotor ?? a.pendapatan)}</strong></div>
    <div><span>Diskon Seller</span><strong>${fmt(a.diskonSeller || 0)}</strong></div>
    <div><span>Omzet Net</span><strong>${fmt(a.omzetNet ?? a.pendapatan)}</strong></div>
    <div class="secret"><span>Settlement Cair</span><strong>${fmt(a.settlementCair || 0)}</strong></div>
    <div class="secret"><span>Potongan Platform</span><strong>${fmt(a.potonganPlatform)}</strong></div>
    <div class="secret"><span>HPP</span><strong>${fmt(a.hpp || 0)}</strong></div>
    <div class="secret"><span>Packing</span><strong>${fmt(a.packing || 0)}</strong></div>
    <div class="secret"><span>Biaya Iklan</span><strong>${fmt(a.biayaIklan)}</strong></div>
    <div><span>Retur/Cancel</span><strong>${fmt(a.returCancel ?? a.refund)}</strong></div>
    <div class="secret"><span>Profit Final</span><strong>${fmt(a.profitFinal)}</strong></div>
    <div class="secret"><span>Profit Belum Final</span><strong>${fmt(a.profitBelumFinal)}</strong></div>
  `;
}

function renderStatus(rows) {
  const max = Math.max(...rows.map(r => r.count), 1);
  el("statusList").innerHTML = rows.slice(0, 8).map(r => `
    <div class="status-row">
      <strong>${r.status}</strong><span>${num(r.count)}</span>
      <div class="bar"><span style="width:${r.count / max * 100}%"></span></div>
    </div>`).join("");
}

function renderStores(rows) {
  el("storeCards").innerHTML = rows.map(r => `
    <article>
      <span>${r.store}</span>
      <strong>${fmt(r.omzet)}</strong>
      <em>${num(r.orders)} order</em>
      <b class="secret">${fmt(r.profit)}</b>
    </article>
  `).join("") || `<p class="hint">Belum ada data untuk toko/periode ini.</p>`;
  const restricted = state.accessRole !== "owner";
  el("storeTable").innerHTML = `
    <tr>
      <th>Toko</th><th>Order</th><th>Omset</th>${restricted ? "" : "<th>Profit</th><th>Margin</th>"}<th>AOV</th>
    </tr>
    ${rows.map(r => {
      const margin = r.omzet ? Number(r.profit || 0) / Number(r.omzet || 1) * 100 : 0;
      const aov = r.orders ? Number(r.omzet || 0) / Number(r.orders || 1) : 0;
      return `<tr>
        <td><strong>${r.store}</strong></td>
        <td>${num(r.orders)}</td>
        <td>${fmt(r.omzet)}</td>
        ${restricted ? "" : `<td>${fmt(r.profit)}</td><td>${margin.toFixed(1)}%</td>`}
        <td>${fmt(aov)}</td>
      </tr>`;
    }).join("")}
  `;
}

function renderTable(id, rows) {
  const restricted = state.accessRole !== "owner";
  const head = restricted
    ? "<tr><th>SKU</th><th>Qty</th><th>Omset</th></tr>"
    : "<tr><th>SKU</th><th>Qty</th><th>Omset</th><th>Profit</th></tr>";
  const body = rows.map(r => restricted
    ? `<tr><td>${r.sku}</td><td>${num(r.qty)}</td><td>${fmt(r.omzet)}</td></tr>`
    : `<tr><td>${r.sku}<small>${r.product ? "<br>" + r.product.slice(0, 66) : ""}</small></td><td>${num(r.qty)}</td><td>${fmt(r.omzet)}</td><td>${fmt(r.profit)}</td></tr>`
  ).join("");
  el(id).innerHTML = head + body;
}

function renderSkuDetail(summary) {
  const s = summary.skuSummary || {};
  el("skuTotal").textContent = num(s.total || 0);
  el("skuGood").textContent = num(s.profitable || 0);
  el("skuBad").textContent = num(s.bad || 0);
  el("skuMissing").textContent = num(s.missingCost || 0);
  const best = s.best ? `${s.best.sku} menghasilkan ${fmt(s.best.profit)} dengan margin ${Number(s.best.margin || 0).toFixed(1)}%.` : "Belum ada SKU penghasil.";
  const weakest = s.weakest ? `${s.weakest.sku} perlu dicek: profit ${fmt(s.weakest.profit)}, margin ${Number(s.weakest.margin || 0).toFixed(1)}%.` : "Belum ada SKU lemah.";
  el("skuInsight").innerHTML = `
    <div><strong>SKU penghasil utama:</strong> ${best}</div>
    <div><strong>SKU kurang bagus:</strong> ${weakest}</div>
  `;
  const rows = [...(summary.skuDetails || [])].filter(row => {
    if (state.skuStatus === "all") return true;
    if (state.skuStatus === "missing") return row.missingCost;
    return row.statusLevel === state.skuStatus;
  });
  const sortKey = state.skuSort;
  rows.sort((a, b) => Number(b[sortKey] || 0) - Number(a[sortKey] || 0));
  if (sortKey === "margin") rows.sort((a, b) => Number(b.margin || 0) - Number(a.margin || 0));
  const body = rows.slice(0, 80).map(row => `
    <tr>
      <td>
        <strong>${row.sku}</strong>
        <small>${row.product ? "<br>" + row.product.slice(0, 84) : ""}</small>
      </td>
      <td><span class="badge ${row.statusLevel}">${row.status}</span></td>
      <td>${num(row.orders)}</td>
      <td>${num(row.qty)}</td>
      <td>${fmt(row.omzet)}</td>
      <td>${fmt(row.profit)}</td>
      <td>${Number(row.margin || 0).toFixed(1)}%</td>
      <td>${fmt(row.hpp + row.packing)}</td>
      <td>${fmt(row.refund)}</td>
      <td>${fmt(row.adSpend)}</td>
    </tr>
  `).join("");
  el("skuDetailTable").innerHTML = `
    <tr>
      <th>SKU</th><th>Status</th><th>Order</th><th>Qty</th><th>Omset</th><th>Profit</th><th>Margin</th><th>HPP+Packing</th><th>Refund</th><th>Iklan</th>
    </tr>
    ${body || `<tr><td colspan="10">Tidak ada SKU untuk filter ini.</td></tr>`}
  `;
}

function renderRuns(rows) {
  el("runs").innerHTML = rows.map(r => `
    <div class="run">
      <strong>${r.kind} · ${r.store_name || "-"} · ${r.filename}</strong><br>
      ${r.rows_seen} baris, ${r.inserted} baru, ${r.updated} berubah, ${r.unchanged || 0} sama<br>
      ${r.audit_count || 0} catatan audit<br>
      ${r.created_at}
    </div>`).join("") || "Belum ada upload.";
}

function renderAuditEvents(rows) {
  const labels = {
    order: "Order baru",
    status: "Status order",
    order_amount: "Total order",
    settlement_received: "Pencairan",
    platform_fee: "Potongan platform",
    refund_amount: "Refund",
    tracking_id: "Resi",
    quantity: "Qty",
  };
  const moneyFields = new Set(["order_amount", "settlement_received", "platform_fee", "refund_amount"]);
  el("auditEvents").innerHTML = rows.slice(0, 30).map(r => {
    const label = labels[r.field_name] || r.field_name;
    const oldValue = moneyFields.has(r.field_name) ? fmt(r.old_value) : (r.old_value || "-");
    const newValue = moneyFields.has(r.field_name) ? fmt(r.new_value) : (r.new_value || "-");
    const type = r.change_type === "inserted" ? "new" : r.field_name === "settlement_received" ? "cash" : "change";
    return `
      <div class="audit-change ${type}">
        <div>
          <strong>${label}</strong>
          <span>${r.store_name} · Order ${r.order_id || "-"} · ${r.sku || "-"}</span>
        </div>
        <p>${oldValue} <b>→</b> ${newValue}</p>
        <em>${r.filename || "-"} · ${r.created_at}</em>
      </div>`;
  }).join("") || `<p class="hint">Belum ada perubahan yang tercatat.</p>`;
}

function renderAdSpendRows(rows) {
  el("adSpendRows").innerHTML = rows.map(r => `
    <div class="run">
      <strong>${r.store_name} · ${r.spend_date} · ${fmt(r.amount)}</strong><br>
      ${r.channel || "Iklan"}${r.campaign ? " · " + r.campaign : ""}<br>
      ${r.note || "Tidak ada catatan"}
    </div>`).join("") || "Belum ada biaya iklan.";
}

function drawTrend(rows) {
  const canvas = el("trend");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "#172536");
  grd.addColorStop(1, "#0f141b");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  if (!rows.length) return;
  const pad = 42;
  const max = Math.max(...rows.map(r => Math.max(r.omzet, r.profit)), 1);
  const x = (i) => pad + (w - pad * 2) * (i / Math.max(rows.length - 1, 1));
  const y = (v) => h - pad - (h - pad * 2) * (v / max);
  ctx.strokeStyle = "rgba(255,255,255,.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const yy = pad + i * ((h - pad * 2) / 4);
    ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(w - pad, yy); ctx.stroke();
  }
  line("omzet", "#67d3ff");
  if (state.accessRole === "owner") line("profit", "#e7b96d");
  ctx.fillStyle = "#aeb7c6";
  ctx.font = "13px sans-serif";
  ctx.fillText("Omset", pad, 20);
  if (state.accessRole === "owner") ctx.fillText("Profit", pad + 62, 20);
  function line(key, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath();
    rows.forEach((r, i) => i ? ctx.lineTo(x(i), y(r[key])) : ctx.moveTo(x(i), y(r[key])));
    ctx.stroke();
  }
}

async function loadConfig() {
  const cfg = await api("/api/config");
  state.config = cfg;
  populateStores(cfg.stores || []);
  if (!state.folderStore || !(cfg.stores || []).includes(state.folderStore)) state.folderStore = (cfg.stores || ["ventura"])[0];
  el("adSpendDate").value = new Date().toISOString().slice(0, 10);
  const form = document.getElementById("configForm");
  for (const [k, v] of Object.entries(cfg)) {
    if (form.elements[k]) form.elements[k].value = v;
  }
  renderFolderMonitor();
}

function currentFolderMonitor() {
  const monitors = (state.config && state.config.folderMonitors) || {};
  return monitors[state.folderStore] || { storeName: state.folderStore, enabled: false, path: "", kind: "auto", intervalMinutes: 10, lastMessage: "Belum berjalan" };
}

function renderFolderMonitor() {
  const folder = currentFolderMonitor();
  const folderForm = document.getElementById("folderForm");
  el("folderStore").value = folder.storeName || state.folderStore;
  for (const [k, v] of Object.entries(folder)) {
    if (!folderForm.elements[k]) continue;
    if (folderForm.elements[k].type === "checkbox") folderForm.elements[k].checked = Boolean(v);
    else folderForm.elements[k].value = v;
  }
  el("folderStatus").textContent = `${folder.enabled ? "Aktif" : "Nonaktif"} · ${folder.lastMessage || "Belum berjalan"}`;
  renderFolderCards((state.config && state.config.folderMonitors) || {});
}

function renderFolderCards(monitors) {
  const rows = Object.values(monitors);
  el("folderCards").innerHTML = rows.map(m => `
    <div class="folder-card ${m.enabled ? "on" : ""}">
      <span>${m.storeName}</span>
      <strong>${m.enabled ? "Aktif" : "Nonaktif"}</strong>
      <p>${m.path || "Folder belum diisi"}</p>
      <em>${m.lastRun ? "Scan terakhir " + m.lastRun : "Belum pernah scan"} · ${m.lastMessage || "Belum berjalan"}</em>
    </div>
  `).join("") || `<p class="hint">Belum ada konfigurasi folder.</p>`;
}

document.querySelectorAll("nav button").forEach(btn => btn.addEventListener("click", () => {
  if (btn.dataset.view === "tv") {
    window.location.href = "/tv";
    return;
  }
  if (btn.dataset.view === "team") {
    window.location.href = "/team";
    return;
  }
  setView(btn.dataset.view);
}));
document.querySelectorAll("[data-preset]").forEach(btn => btn.addEventListener("click", async () => {
  document.querySelectorAll("[data-preset]").forEach(x => x.classList.remove("active"));
  btn.classList.add("active");
  state.filters.preset = btn.dataset.preset;
  if (btn.dataset.preset === "month" && el("monthFilter").value) state.filters.month = el("monthFilter").value;
  await refresh();
}));
el("monthFilter").addEventListener("change", async (event) => {
  state.filters.month = event.target.value;
  state.filters.preset = "month";
  document.querySelectorAll("[data-preset]").forEach(x => x.classList.toggle("active", x.dataset.preset === "month"));
  await refresh();
});
el("storeFilter").addEventListener("change", async (event) => {
  state.filters.store = event.target.value;
  await refresh();
});
el("skuSort").addEventListener("change", (event) => {
  state.skuSort = event.target.value;
  if (state.summary) renderSkuDetail(state.summary);
});
el("skuStatus").addEventListener("change", (event) => {
  state.skuStatus = event.target.value;
  if (state.summary) renderSkuDetail(state.summary);
});
el("folderStore").addEventListener("change", (event) => {
  state.folderStore = event.target.value;
  renderFolderMonitor();
});
el("refreshBtn").addEventListener("click", refresh);
el("jumpUploadBtn").addEventListener("click", () => { setView("ops"); el("uploadPanel").scrollIntoView({ behavior: "smooth" }); });
el("sampleBtn").addEventListener("click", async () => {
  if (isCloudPreview) {
    showNotice("Di Vercel kita pakai data real dari upload, bukan data contoh. Pilih Upload Data lalu masukkan file SKU, order, atau pencairan.");
    return;
  }
  const storeName = el("uploadStore").value || "ventura";
  try {
    await api("/api/import-samples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName }) });
    await refresh();
  } catch (err) {
    showNotice(err.message);
  }
});
document.getElementById("uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (isCloudPreview) {
      if (!window.CloudFinance) throw new Error("Mode upload online belum siap. Refresh halaman Vercel lalu coba lagi.");
      await window.CloudFinance.uploadForm(event.target, api, showNotice);
    } else {
      const fd = new FormData(event.target);
      await api("/api/upload", { method: "POST", body: fd });
    }
    el("fileInput").value = "";
    await refresh();
    setView("owner");
    showNotice(isCloudPreview ? "Upload selesai dan data tersimpan ke Supabase." : "Upload selesai dan dashboard diperbarui.", "info");
  } catch (err) {
    showNotice(err.message);
  }
});
document.getElementById("folderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (cloudBlocked("Auto update folder")) return;
  const data = Object.fromEntries(new FormData(event.target).entries());
  data.enabled = event.target.elements.enabled.checked;
  state.folderStore = data.storeName || state.folderStore;
  try {
    await api("/api/folder-monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    await loadConfig();
  } catch (err) {
    showNotice(err.message);
  }
});
document.getElementById("adSpendForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api("/api/ad-spend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    event.target.elements.amount.value = "";
    event.target.elements.campaign.value = "";
    event.target.elements.note.value = "";
    await refresh();
  } catch (err) {
    showNotice(err.message);
  }
});
el("folderRun").addEventListener("click", async () => {
  if (cloudBlocked("Scan folder")) return;
  try {
    const result = await api("/api/folder-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName: el("folderStore").value }) });
    el("folderStatus").textContent = result.message;
    await loadConfig();
    await refresh();
  } catch (err) {
    showNotice(err.message);
  }
});
el("folderRunAll").addEventListener("click", async () => {
  if (cloudBlocked("Scan semua toko")) return;
  try {
    const result = await api("/api/folder-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName: "all" }) });
    el("folderStatus").textContent = result.message;
    await loadConfig();
    await refresh();
  } catch (err) {
    showNotice(err.message);
  }
});
document.getElementById("configForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    alert("Pengaturan Telegram disimpan.");
  } catch (err) {
    showNotice(err.message);
  }
});
el("telegramTest").addEventListener("click", async () => {
  try {
    await api("/api/telegram-test", { method: "POST" });
    alert("Ringkasan tes dikirim ke Telegram.");
  } catch (err) {
    showNotice(err.message);
  }
});

setView(state.view);
loadConfig().then(refresh).catch(err => alert(err.message));
setInterval(async () => {
  await refresh();
  if (state.view === "ops") await loadConfig();
}, 60000);
