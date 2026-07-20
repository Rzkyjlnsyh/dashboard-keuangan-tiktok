/**
 * COMPREHENSIVE GOLDEN TEST
 * Mei Settlement + Juni Accrual
 */
const {computeSummary} = require('../lib/finance-cloud');
const fmt = n => Math.round(n||0).toLocaleString('id-ID');
const chk = (label, actual, expected) => {
  const a = Math.round(actual||0);
  const ok = Math.abs(a - expected) <= 1;
  console.log((ok?'✅':'❌'), label.padEnd(32), '=', fmt(a), ok?'':('| Expected '+fmt(expected)+' Δ'+fmt(a-expected)));
  return ok;
};

(async()=>{
  let pass = 0, fail = 0;
  const add = (l,a,e) => { if(chk(l,a,e)) pass++; else fail++; };
  
  // ===== MEI SETTLEMENT =====
  console.log('=================================================================');
  console.log('  MEI 2026 — CUSTOMBASE — SETTLEMENT MODE');
  console.log('=================================================================');
  const mei = await computeSummary({preset:'month',month:'2026-05',store:'custombase',mode:'settlement'});
  const mt = mei.totals;
  add('Orders Selesai', mt.finalOrders instanceof Set?mt.finalOrders.size:mt.finalOrders, 588);
  add('Omzet Kotor', mt.gross, 20898500);
  add('Diskon Seller', mt.sellerDiscount, 8827867);
  add('Omzet Net', mt.omzet, 12070633);
  add('Settlement Cair', mt.settlement, 8772345);
  add('Potongan Platform', mt.platformFee, 3223291);
  add('Penggantian', mt.adjustmentAmount, 32998);
  add('Iklan GMV', mt.adSpendSettlement, 1472709);
  add('Iklan Top Up', mt.adSpendTopup, 1665000);
  add('HPP', mt.hpp, 3487900);
  add('Packing', mt.packing, 1300000);
  add('Profit Bersih', mt.profit, 879734);
  add('Cancel Valid', (mei.operationStatus||[]).find(o=>o.bucket==='canceled')?.orders||0, 62);
  const meiPct = pass+'/'+(pass+fail);
  
  // ===== JUNI ACCRUAL =====
  console.log('\n=================================================================');
  console.log('  JUNI 2026 — CUSTOMBASE — ACCRUAL MODE');
  console.log('=================================================================');
  const juni = await computeSummary({preset:'month',month:'2026-06',store:'custombase',mode:'accrual'});
  const jt = juni.totals;
  add('Omzet Kotor', jt.gross, 54043700);
  add('Diskon Seller', jt.sellerDiscount, 21310753);
  add('Omzet Net', jt.omzet, 32732947);
  add('Refund Valid', jt.refund, 109094);
  add('Potongan Platform Accrual', jt.platformFee, 8665750);
  add('  Real (settled)', jt.platformFeeFinal, 5026837);
  add('  Estimated (piutang)', jt.platformFeeEstimated, 3638913);
  add('Penggantian', jt.adjustmentAmount, 56100);
  add('HPP', jt.hpp, 7546100);
  add('Packing', jt.packing, 3572000);
  add('Iklan GMV', jt.adSpendSettlement, 6625056);
  add('Iklan Top Up', jt.adSpendTopup, 222000);
  add('Total Biaya', jt.hpp+jt.packing+jt.adSpendTopup+jt.adSpendSettlement, 17965156);
  add('Net Transaksi', jt.omzet-jt.platformFee-jt.refund+jt.adjustmentAmount, 24014203);
  add('Profit Bersih', jt.profit, 6049047);
  
  console.log('\n=================================================================');
  console.log('  MEI: '+meiPct+' | JUNI: '+(pass+fail-13)+'/'+(pass+fail-Math.floor(pass/(pass+fail))*13));
  console.log('  TOTAL: '+(pass)+'/'+(pass+fail)+' MATCH');
  console.log('=================================================================');
  process.exit(fail > 0 ? 1 : 0);
})();
