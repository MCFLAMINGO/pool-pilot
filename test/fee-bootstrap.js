/* Unit: bootstrap ETH fee → 100% LP until buy-side depth clears threshold. */
const assert = require('assert');
const L = require('../js/chainlib.js');

function check(name, cond) {
  if (!cond) throw new Error('FAIL: ' + name);
  console.log('ok', name);
}

const threshold = L.CFG.SWAP_FEE_BOOTSTRAP_BUY_USD;
check('bootstrap threshold configured', threshold === 10000);

let thin = L.resolveEthFeeLpShareBps(200);
check('thin pool → 100% LP', thin.lpShareBps === 10000 && thin.bootstrap === true);

let unknown = L.resolveEthFeeLpShareBps(null);
check('unknown depth → bootstrap', unknown.bootstrap === true && unknown.lpShareBps === 10000);

let mature = L.resolveEthFeeLpShareBps(threshold);
check('at threshold → mature share', mature.bootstrap === false && mature.lpShareBps === L.CFG.SWAP_FEE_LP_SHARE_BPS);

let deep = L.resolveEthFeeLpShareBps(50000);
check('deep pool → mature share', deep.bootstrap === false && deep.lpShareBps === 7000);

console.log('FEE BOOTSTRAP OK');
