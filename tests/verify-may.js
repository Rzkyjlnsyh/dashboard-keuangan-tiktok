const {computeSummary} = require('../lib/finance-cloud');
(async()=>{
  const s = await computeSummary({preset:'month',month:'2026-05',store:'custombase',mode:'settlement'});
  const t = s.totals;
  const fmt = n => Math.round(n||0).toLocaleString('id-ID');
  const chk = (label, actual, expected) => {
    const a = Math.round(actual||0);
    const ok = Math.abs(a - expected) <= 1;
    console.log((ok?'✅':'❌'), label.padEnd(22), '=', fmt(a), ok?'':('| Expected '+fmt(expected)+' Δ'+fmt(a-expected)));
    return ok;
  };
  let pass = 0, fail = 0;
  const add = (l,a,e) => { if(chk(l,a,e)) pass++; else fail++; };
  console.log('=== MEI 2026 CUSTOMBASE SETTLEMENT MODE ===');
  add('Orders Selesai', t.finalOrders instanceof Set?t.finalOrders.size:t.finalOrders, 588);
  add('Omzet Kotor', t.gross, 20898500);
  add('Diskon Seller', t.sellerDiscount, 8827867);
  add('Omzet Net', t.omzet, 12070633);
  add('Settlement Cair', t.settlement, 8772345);
  add('Potongan Platform', t.platformFee, 3223291);
  add('Penggantian', t.adjustmentAmount, 32998);
  add('Iklan GMV', t.adSpendSettlement, 1472709);
  add('Iklan Top Up', t.adSpendTopup, 1665000);
  add('HPP', t.hpp, 3487900);
  add('Packing', t.packing, 1300000);
  add('Profit Bersih', t.profit, 879734);
  console.log(pass+'/'+(pass+fail)+' VALID');
  process.exit(fail > 0 ? 1 : 0);
})();
