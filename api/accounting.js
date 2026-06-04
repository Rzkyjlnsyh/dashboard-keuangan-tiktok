const { Pool } = require("pg");

const { json, buildFilters, requireOwner, nowIso, normalizeStore } = require("../lib/finance-cloud");

const DEFAULT_STORES = ["ventura", "giftyours", "custombase"];

function pool() {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.SUPABASE_DB_URL ||
    "";
  if (!connectionString) return null;
  return new Pool({ connectionString, max: 3, idleTimeoutMillis: 5000 });
}

/**
 * Compute accounting report for a given month and store filter:
 * - Profit & Loss per store + total
 * - Mini Balance Sheet
 * - Cash Flow
 * - Tax calculation
 */
async function computeAccounting(filters) {
  const db = pool();
  if (!db) {
    return emptyAccounting("Database PostgreSQL belum terkonfigurasi. Isi DATABASE_URL atau SUPABASE_DB_URL.");
  }

  const [startDate, endDate] = dateRangeFromFilters(filters);
  if (!startDate || !endDate) {
    return emptyAccounting("Periode tidak valid.");
  }

  const storeFilter = filters.store !== "all" ? normalizeStore(filters.store) : null;

  try {
    // ── 1. Order lines for the period ──
    let orderSql = `
      SELECT
        store_name,
        order_id,
        status,
        quantity,
        gross_product,
        seller_discount,
        order_amount,
        platform_fee,
        settlement_received,
        refund_amount,
        created_at
      FROM finance_order_lines
      WHERE created_at >= $1 AND created_at < ($2::date + interval '1 day')::text
    `;
    const orderParams = [startDate, endDate];
    if (storeFilter) {
      orderSql += ` AND store_name = $3`;
      orderParams.push(storeFilter);
    }
    const orderResult = await db.query(orderSql, orderParams);
    const orderLines = orderResult.rows;

    // ── 2. SKU costs ──
    const skuResult = await db.query("SELECT store_name, sku, hpp_per_unit, packing_per_unit FROM finance_sku_costs");
    const costsByKey = new Map();
    for (const row of skuResult.rows) {
      costsByKey.set(`${String(row.store_name || "").toLowerCase()}|${String(row.sku || "").toLowerCase()}`, row);
      costsByKey.set(`global|${String(row.sku || "").toLowerCase()}`, row);
    }

    // ── 3. Ad spend for the period ──
    let adSql = `
      SELECT store_name, amount, channel, spend_date
      FROM finance_ad_spend
      WHERE spend_date >= $1 AND spend_date <= $2
    `;
    const adParams = [startDate, endDate];
    if (storeFilter) {
      adSql += ` AND store_name = $3`;
      adParams.push(storeFilter);
    }
    const adResult = await db.query(adSql, adParams);
    const adRows = adResult.rows;

    // ── Process by store ──
    const stores = storeFilter ? [storeFilter] : DEFAULT_STORES;
    const grouped = {};
    for (const store of stores) {
      grouped[store] = { lines: [], adSpendRows: [] };
    }
    for (const row of orderLines) {
      const store = row.store_name || "ventura";
      if (!grouped[store]) grouped[store] = { lines: [], adSpendRows: [] };
      grouped[store].lines.push(row);
    }
    for (const row of adRows) {
      const store = row.store_name || "ventura";
      if (!grouped[store]) grouped[store] = { lines: [], adSpendRows: [] };
      grouped[store].adSpendRows.push(row);
    }

    // ── Build per-store accounting data ──
    const profitLoss = {};
    let totalPL = null;
    let totalKas = 0;
    let totalPiutangDanaTertahan = 0;
    let totalPersediaan = 0;
    let totalUtangIklan = 0;
    let totalKasMasukPencairan = 0;
    let totalKasKeluarHpp = 0;
    let totalKasKeluarPacking = 0;
    let totalKasKeluarIklan = 0;
    let totalDanaTertahanAkhir = 0;

    for (const store of stores) {
      const data = grouped[store] || { lines: [], adSpendRows: [] };

      // Group lines by order_id for per-order calculations
      const orderGroups = new Map();
      for (const row of data.lines) {
        const key = row.order_id || row.line_key || `fallback-${Math.random()}`;
        if (!orderGroups.has(key)) orderGroups.set(key, []);
        orderGroups.get(key).push(row);
      }

      let omzet = 0;
      let hpp = 0;
      let packing = 0;
      let platformFee = 0;
      let adSpend = 0;
      let kasMasuk = 0;
      let danaTertahan = 0;

      for (const [orderId, rows] of orderGroups) {
        const isCancelled = rows.some(r => isCancelledStatus(r.status));
        if (isCancelled) continue;

        const grossSum = rows.reduce((s, r) => s + Math.abs(Number(r.gross_product || 0)), 0);
        const sellerDiscount = rows.reduce((s, r) => s + Math.abs(Number(r.seller_discount || 0)), 0);
        const orderTotal = Math.max(grossSum - sellerDiscount, rows.reduce((s, r) => s + Math.abs(Number(r.order_amount || 0)), 0));
        omzet += orderTotal;

        // Platform fee sum per order
        const feeSum = rows.reduce((s, r) => s + Math.abs(Number(r.platform_fee || 0)), 0);
        platformFee += feeSum;

        // Settlement received — only for completed orders
        const maxSettlement = Math.max(...rows.map(r => Math.abs(Number(r.settlement_received || 0))));
        if (maxSettlement > 0) {
          kasMasuk += maxSettlement;
        } else {
          // Dana tertahan — completed but not yet settled
          danaTertahan += orderTotal;
        }

        // HPP & Packing
        for (const row of rows) {
          const qty = Math.max(0, Number(row.quantity || 0));
          const storeKey = `${String(row.store_name || "").toLowerCase()}|${String(row.sku || "").toLowerCase()}`;
          const cost = costsByKey.get(storeKey) || {};
          const hppPerUnit = Number(cost.hpp_per_unit || 0);
          const packingPerUnit = Number(cost.packing_per_unit || 0);
          hpp += qty * hppPerUnit;
          packing += qty * packingPerUnit;
        }
      }

      // Ad spend for this store
      for (const row of data.adSpendRows) {
        adSpend += Math.abs(Number(row.amount || 0));
      }

      const labaKotor = omzet - hpp - packing;
      const labaBersih = labaKotor - platformFee - adSpend;

      profitLoss[store] = {
        omzet: Math.round(omzet),
        hpp: Math.round(hpp),
        packing: Math.round(packing),
        platformFee: Math.round(platformFee),
        adSpend: Math.round(adSpend),
        labaKotor: Math.round(labaKotor),
        labaBersih: Math.round(labaBersih),
      };
    }

    // Build totals
    totalPL = { omzet: 0, hpp: 0, packing: 0, platformFee: 0, adSpend: 0, labaKotor: 0, labaBersih: 0 };
    for (const store of stores) {
      const pl = profitLoss[store];
      for (const key of Object.keys(totalPL)) {
        totalPL[key] += pl[key];
      }
    }
    profitLoss["total"] = totalPL;

    // ── Balance Sheet ──
    // Query outstanding ad spend (unpaid)
    let utangIklanSql = `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM finance_ad_spend
      WHERE spend_date <= $2
    `;
    const utangIklanParams = [startDate, endDate];
    if (storeFilter) {
      utangIklanSql += ` AND store_name = $3`;
      utangIklanParams.push(storeFilter);
    }
    const utangResult = await db.query(utangIklanSql, [startDate, endDate, ...(storeFilter ? [storeFilter] : [])]);
    const utangIklanTotal = Math.round(Number(utangResult.rows[0]?.total || 0));

    // Kas: total settlement received for the period (simplified)
    let kasSql = `
      SELECT COALESCE(SUM(settlement_received), 0) AS total
      FROM finance_order_lines
      WHERE settlement_received > 0
        AND created_at >= $1 AND created_at < ($2::date + interval '1 day')::text
    `;
    const kasParams = [startDate, endDate];
    if (storeFilter) {
      kasSql += ` AND store_name = $3`;
      kasParams.push(storeFilter);
    }
    const kasResult = await db.query(kasSql, kasParams);
    const kasTotal = Math.round(Number(kasResult.rows[0]?.total || 0));

    // Dana tertahan: completed orders without settlement
    let heldSql = `
      SELECT
        COALESCE(SUM(
          GREATEST(
            COALESCE(ABS(gross_product), 0) - COALESCE(ABS(seller_discount), 0),
            COALESCE(ABS(order_amount), 0)
          )
        ), 0) AS dana_tertahan
      FROM finance_order_lines
      WHERE (settlement_received IS NULL OR settlement_received = 0)
        AND created_at >= $1 AND created_at < ($2::date + interval '1 day')::text
    `;
    const heldParams = [startDate, endDate];
    let heldFilter = "";
    if (storeFilter) {
      heldFilter = ` AND store_name = $3`;
      heldParams.push(storeFilter);
    }
    // Only count non-cancelled orders
    heldSql = heldSql.replace("WHERE", "WHERE NOT " + buildCancelledCondition() + " AND");
    const heldResult = await db.query(heldSql, heldParams);
    const piutangDanaTertahan = Math.round(Number(heldResult.rows[0]?.dana_tertahan || 0));

    // Persediaan: simplified — assume inventory value from HPP of goods sold (proxy)
    const persediaan = Math.round(totalPL.hpp * 0.3); // simplified estimate

    const totalAset = kasTotal + piutangDanaTertahan + persediaan;
    const ekuitas = totalAset - utangIklanTotal;

    // ── Cash Flow ──
    // Kas keluar HPP & Packing from payments made (simplified: from ad spend + HPP actual paid)
    let hppPaidSql = `
      SELECT
        COALESCE(SUM(qty * sk.hpp_per_unit), 0) AS hpp_paid,
        COALESCE(SUM(qty * sk.packing_per_unit), 0) AS packing_paid
      FROM (
        SELECT
          ol.store_name,
          ol.sku,
          SUM(ABS(ol.quantity)) AS qty
        FROM finance_order_lines ol
        WHERE ol.created_at >= $1 AND ol.created_at < ($2::date + interval '1 day')::text
          AND (ol.settlement_received IS NOT NULL AND ol.settlement_received > 0)
    `;
    const hppParams = [startDate, endDate];
    if (storeFilter) {
      hppPaidSql += ` AND ol.store_name = $3`;
      hppParams.push(storeFilter);
    }
    hppPaidSql += `
        GROUP BY ol.store_name, ol.sku
      ) q
      LEFT JOIN finance_sku_costs sk
        ON LOWER(sk.store_name || '|' || sk.sku) = LOWER(q.store_name || '|' || q.sku)
        OR LOWER('global|' || sk.sku) = LOWER(q.store_name || '|' || q.sku)
    `;
    const hppPaidResult = await db.query(hppPaidSql, hppParams);
    const kasKeluarHppTotal = Math.round(Number(hppPaidResult.rows[0]?.hpp_paid || 0));
    const kasKeluarPackingTotal = Math.round(Number(hppPaidResult.rows[0]?.packing_paid || 0));

    // Kas keluar iklan
    let adPaidSql = `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM finance_ad_spend
      WHERE spend_date >= $1 AND spend_date <= $2
    `;
    const adPaidParams = [startDate, endDate];
    if (storeFilter) {
      adPaidSql += ` AND store_name = $3`;
      adPaidParams.push(storeFilter);
    }
    const adPaidResult = await db.query(adPaidSql, adPaidParams);
    const kasKeluarIklanTotal = Math.round(Number(adPaidResult.rows[0]?.total || 0));

    const arusKasBersih = kasTotal - kasKeluarHppTotal - kasKeluarPackingTotal - kasKeluarIklanTotal;
    const danaTertahanAkhir = piutangDanaTertahan;

    // ── Tax ──
    const pphTerutang = Math.round(totalPL.omzet * 0.005);
    const ppnKeluaran = Math.round(totalPL.omzet * 0.11);

    return {
      profitLoss,
      balanceSheet: {
        kas: kasTotal,
        piutangDanaTertahan,
        persediaan,
        utangIklan: utangIklanTotal,
        totalAset,
        ekuitas,
      },
      cashFlow: {
        kasMasukPencairan: kasTotal,
        kasKeluarHpp: kasKeluarHppTotal,
        kasKeluarPacking: kasKeluarPackingTotal,
        kasKeluarIklan: kasKeluarIklanTotal,
        arusKasBersih,
        danaTertahanAkhir,
      },
      tax: {
        pphFinalPP23: {
          omzet: totalPL.omzet,
          tarif: 0.005,
          pphTerutang,
        },
        ppn: {
          omzet: totalPL.omzet,
          tarif: 0.11,
          ppnKeluaran,
        },
      },
      generatedAt: nowIso(),
      month: endDate.slice(0, 7),
    };
  } catch (error) {
    return emptyAccounting(error.message);
  } finally {
    await db.end().catch(() => {});
  }
}

function buildCancelledCondition() {
  return `(
    LOWER(TRIM(ol.status)) IN ('dibatalkan','cancellations','cancelled','canceled','cancel','returned','return','returnrefund','refundreturn')
    OR LOWER(TRIM(ol.status)) LIKE '%retur%'
  )`;
}

function isCancelledStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  return ["dibatalkan", "cancellations", "cancelled", "canceled", "cancel", "returned", "return", "returnrefund", "refundreturn"].includes(s)
    || s.includes("retur");
}

function dateRangeFromFilters(filters) {
  if (filters.preset === "month" && filters.month) {
    const [year, month] = filters.month.split("-").map(Number);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(Date.UTC(year, month, 0));
    return [start, endDate.toISOString().slice(0, 10)];
  }
  const today = new Date().toISOString().slice(0, 10);
  if (filters.preset === "thisMonth") {
    return [today.slice(0, 8) + "01", today];
  }
  if (filters.startDate && filters.endDate) {
    return [filters.startDate, filters.endDate];
  }
  return ["", ""];
}

function emptyAccounting(message = "") {
  const emptyStore = { omzet: 0, hpp: 0, packing: 0, platformFee: 0, adSpend: 0, labaKotor: 0, labaBersih: 0 };
  return {
    profitLoss: {
      ventura: { ...emptyStore },
      giftyours: { ...emptyStore },
      custombase: { ...emptyStore },
      total: { ...emptyStore },
    },
    balanceSheet: { kas: 0, piutangDanaTertahan: 0, persediaan: 0, utangIklan: 0, totalAset: 0, ekuitas: 0 },
    cashFlow: { kasMasukPencairan: 0, kasKeluarHpp: 0, kasKeluarPacking: 0, kasKeluarIklan: 0, arusKasBersih: 0, danaTertahanAkhir: 0 },
    tax: {
      pphFinalPP23: { omzet: 0, tarif: 0.005, pphTerutang: 0 },
      ppn: { omzet: 0, tarif: 0.11, ppnKeluaran: 0 },
    },
    generatedAt: nowIso(),
    month: "",
    error: message || undefined,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const query = req.query || {};
    const filters = buildFilters({
      preset: query.preset || "month",
      month: query.month,
      store: query.store,
    });
    const role = query.role || "owner";
    if (role === "owner" && !(await requireOwner(req, res))) return;
    const accounting = await computeAccounting(filters);
    return json(res, 200, accounting);
  } catch (error) {
    return json(res, 200, emptyAccounting(error.message));
  }
};
