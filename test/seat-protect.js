'use strict';

/** Live smoke: seat plan is laddered below-spot + depth protections. */
const L = require('../js/chainlib');

async function main() {
  const p = L.getProvider();
  const ethUsd = await L.fetchEthUsd();
  const wallet = '0x1111111111111111111111111111111111111111';
  const plan = await L.planSeatDeposit(p, {
    usdAmount: 500,
    walletAddr: wallet,
    ethUsd: ethUsd,
    dual: false
  });

  let failed = 0;
  function check(name, cond) {
    if (!cond) {
      console.error('FAIL', name);
      failed += 1;
    } else console.log('ok', name);
  }

  check('mode ladder', plan.mode === 'buywall-ladder' || plan.mode === 'dual-ladder');
  check('3 bands', plan.ranges && plan.ranges.length === 3);
  check('has bundled txs', plan.txs && plan.txs.length >= 1);
  check('protections', plan.protections && plan.protections.ladderBands === 3);
  check('below spot', plan.protections.belowSpotBuyWall === true);
  check('never market buy seed', plan.protections.neverMarketBuyToSeed === true);
  check('pool depth reported', plan.protections.pool && isFinite(plan.protections.pool.wethUsd));
  check('eth > 0', plan.ethInF > 0);

  // Cap test: absurd deposit should shrink
  const fat = await L.planSeatDeposit(p, {
    usdAmount: 50000,
    walletAddr: wallet,
    ethUsd: ethUsd,
    dual: false
  });
  check('fat capped', fat.capped === true && fat.usd < 50000);
  check('fat still ladder', fat.ranges && fat.ranges.length === 3);

  if (failed) {
    console.error(failed + ' failure(s)');
    process.exit(1);
  }
  console.log('seat-protect: all ok', {
    usd: plan.usd,
    ethInF: plan.ethInF,
    pool: plan.protections.pool,
    warnings: plan.protections.warnings.length
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
