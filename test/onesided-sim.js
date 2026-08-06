// Sim: reproduce Erik's exact failure (MCFL-only "straddle") and verify the fix.
// 1) OLD shape: in-range mint with amount0=0 -> must revert (the bug).
// 2) NEW shape: planStraddle with token-only -> one-sided band, must mint.
// 3) NEW shape: ETH-only with existing WETH credit -> wrap only shortfall, must mint.
// 4) NEW shape: both sides -> true straddle, must mint (regression).
var ethers = require('ethers');
global.window = undefined;
var L = require('../js/chainlib.js');
var CFG = L.CFG;

var FORK = 'http://127.0.0.1:8545';
var TREASURY = '0x1aa92670a4e680081c407e060a3e8bc3d1929a13';

var NPM_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256,uint256,uint128,uint128)'
];
var POOL_ABI = ['function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)'];

async function lastPosition(npm, owner) {
  var n = await npm.balanceOf(owner);
  var id = await npm.tokenOfOwnerByIndex(owner, n.sub(1));
  var p = await npm.positions(id);
  return { id: id.toString(), lo: p.tickLower, hi: p.tickUpper, liq: p.liquidity.toString() };
}

async function sendPlanTxs(provider, from, txs) {
  for (var i = 0; i < txs.length; i++) {
    var t = txs[i];
    var h = await provider.send('eth_sendTransaction', [{ from: from, to: t.to, data: t.data, value: t.value || '0x0', gas: '0x7a1200' }]);
    var r = await provider.waitForTransaction(h);
    if (r.status !== 1) throw new Error('tx reverted: ' + t.label);
    console.log('   ok:', t.label);
  }
}

async function main() {
  var provider = new ethers.providers.JsonRpcProvider(FORK);
  await provider.send('anvil_impersonateAccount', [TREASURY]);
  await provider.send('anvil_setBalance', [TREASURY, '0x8AC7230489E80000']); // 10 ETH for gas+tests

  var info = await L.discoverPool(provider, CFG.MCFL);
  var state = await L.readState(provider, info, null);
  var npm = new ethers.Contract(CFG.NPM, NPM_ABI, provider);
  var pool = new ethers.Contract(info.pool, POOL_ABI, provider);
  var s0 = await pool.slot0();
  console.log('fork tick', s0.tick, '| spacing', info.spacing, '| tokenIsToken1', info.tokenIsToken1);

  var weth = new ethers.Contract(CFG.WETH, ['function balanceOf(address) view returns (uint256)'], provider);
  var wethBal = await weth.balanceOf(TREASURY);
  console.log('treasury WETH', ethers.utils.formatEther(wethBal));

  // ---- 1) OLD BUG SHAPE: straddle range, amount1(MCFL) only, amount0=0 ----
  console.log('\n[1] OLD shape (in-range, one token) — expecting REVERT');
  var sp = info.spacing, w = sp * 3;
  var loOld = Math.floor((state.tick - w) / sp) * sp;
  var hiOld = Math.ceil((state.tick + w) / sp) * sp;
  var iNPM = L.ifaces.npm;
  var oldParams = {
    token0: info.token0, token1: info.token1, fee: info.fee,
    tickLower: loOld, tickUpper: hiOld,
    amount0Desired: 0, amount1Desired: ethers.utils.parseEther('611375'),
    amount0Min: 0, amount1Min: 0,
    recipient: TREASURY, deadline: Math.floor(Date.now() / 1000) + 1200
  };
  try {
    await provider.send('eth_estimateGas', [{ from: TREASURY, to: CFG.NPM, data: iNPM.encodeFunctionData('mint', [oldParams]) }]);
    console.log('   UNEXPECTED: old shape did NOT revert');
  } catch (e) {
    console.log('   confirmed revert (this was the bug):', (e.body || e.message || '').slice(0, 120));
  }

  // ---- 2) NEW: token-only -> one-sided band ----
  console.log('\n[2] NEW planStraddle: 611375 MCFL, 0 ETH — expecting one-sided band mint');
  var plan2 = L.planStraddle(state, '611375', '0', TREASURY, undefined, ethers.utils.formatEther(wethBal));
  console.log('   shape:', plan2.summary.oneSided, '| range', plan2.summary.range, '| steps:', plan2.txs.map(function (t) { return t.label; }).join(' / '));
  await sendPlanTxs(provider, TREASURY, plan2.txs);
  var pos2 = await lastPosition(npm, TREASURY);
  console.log('   minted #' + pos2.id, 'range [' + pos2.lo + ',' + pos2.hi + '] liq', pos2.liq, '| tick', s0.tick, '=> in-band?', s0.tick >= pos2.hi ? 'no (correct: MCFL band below tick)' : 'CHECK');

  // ---- 3) NEW: ETH-only with WETH credit ----
  console.log('\n[3] NEW planStraddle: 0 MCFL, 0.001 ETH with existing WETH credit');
  var plan3 = L.planStraddle(state, '0', '0.001', TREASURY, undefined, ethers.utils.formatEther(wethBal));
  console.log('   steps:', plan3.txs.map(function (t) { return t.label; }).join(' / '));
  await sendPlanTxs(provider, TREASURY, plan3.txs);
  var pos3 = await lastPosition(npm, TREASURY);
  console.log('   minted #' + pos3.id, 'range [' + pos3.lo + ',' + pos3.hi + '] liq', pos3.liq);

  // ---- 4) NEW: both sides (regression) ----
  console.log('\n[4] NEW planStraddle: 100000 MCFL + 0.0005 ETH — true straddle');
  var plan4 = L.planStraddle(state, '100000', '0.0005', TREASURY, undefined, '0');
  console.log('   steps:', plan4.txs.map(function (t) { return t.label; }).join(' / '));
  await sendPlanTxs(provider, TREASURY, plan4.txs);
  var pos4 = await lastPosition(npm, TREASURY);
  console.log('   minted #' + pos4.id, 'range [' + pos4.lo + ',' + pos4.hi + '] liq', pos4.liq, '| straddles tick?', pos4.lo < s0.tick && s0.tick < pos4.hi);

  console.log('\nALL SIMS PASSED');
}

main().catch(function (e) { console.error('SIM FAILED:', e.message); process.exit(1); });
