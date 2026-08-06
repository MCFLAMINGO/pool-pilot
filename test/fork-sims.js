/* Full transaction simulations on a live fork of Robinhood Chain.
   Runs every widget move end-to-end as a STRANGER wallet (hardhat acct0),
   exactly like a third-party creator would, plus Erik's collect flow. */
const lib = require('../js/chainlib.js');
const { ethers } = require('ethers');
const CFG = lib.CFG;
const ERIK = '0x1aa92670a4e680081c407e060a3e8bc3d1929a13';

const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');
const stranger = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider); // hardhat acct0, 10000 ETH

const erc20 = (a) => new ethers.Contract(a, ['function balanceOf(address) view returns (uint256)'], provider);
const npm = new ethers.Contract(CFG.NPM, [
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function positions(uint256) view returns (uint96,address,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256,uint256,uint128,uint128)'
], provider);

async function sendPlan(signer, txs) {
  for (const t of txs) {
    const tx = await signer.sendTransaction({ to: t.to, data: t.data, value: t.value || 0, gasLimit: 3000000 });
    const rc = await tx.wait();
    console.log('  ', rc.status === 1 ? 'OK ' : 'REVERT', t.label, '| gas', rc.gasUsed.toString());
    if (rc.status !== 1) throw new Error('tx reverted: ' + t.label);
  }
}

(async () => {
  const ethUsd = await lib.fetchEthUsd(global.fetch) || 1910;
  const ME = stranger.address;
  console.log('stranger wallet:', ME, '| ETH/USD', ethUsd);

  const info = await lib.discoverPool(provider, CFG.MCFL);
  let state = await lib.readState(provider, info, ethUsd, null);
  console.log('pool tick', state.tick, 'price $', state.priceUsd.toExponential(3));

  // ============ TEST A: $25 fee payment with ETH (MCFL lands in treasury) ============
  console.log('\nA) $25 fee payment via ETH -> treasury');
  const q = await lib.quoteFee(provider, ethUsd);
  console.log('   quote:', Math.round(q.mcflAmountF).toLocaleString(), 'MCFL | eth in:', q.ethInF.toFixed(6), '(~$' + q.usdIn.toFixed(2) + ')');
  const before = await erc20(CFG.MCFL).balanceOf(CFG.TREASURY);
  await sendPlan(stranger, [lib.payFeeWithEthTx(q)]);
  const after = await erc20(CFG.MCFL).balanceOf(CFG.TREASURY);
  const got = parseFloat(ethers.utils.formatEther(after.sub(before)));
  console.log('   treasury received:', Math.round(got).toLocaleString(), 'MCFL', got >= q.mcflAmountF * 0.97 ? '>= min OK' : 'TOO LOW!');

  // ============ TEST B: stranger buys MCFL for itself (needed for straddle) ============
  console.log('\nB) stranger buys own MCFL ($40)');
  const q2 = await lib.quoteFee(provider, ethUsd); // fresh quote after price moved
  const buyTx = lib.payFeeWithEthTx(q2);
  // redirect recipient to self by rebuilding params
  const params = { tokenIn: CFG.WETH, tokenOut: CFG.MCFL, fee: q2.info.fee, recipient: ME,
    amountIn: q2.ethIn.mul(16).div(10), amountOutMinimum: 0, sqrtPriceLimitX96: 0 };
  await sendPlan(stranger, [{ label: 'buy MCFL for self', to: CFG.ROUTER02, value: params.amountIn.toHexString(), data: lib.ifaces.router.encodeFunctionData('exactInputSingle', [params]) }]);
  const myM = await erc20(CFG.MCFL).balanceOf(ME);
  console.log('   stranger MCFL:', Math.round(parseFloat(ethers.utils.formatEther(myM))).toLocaleString());

  // ============ TEST C: Move 1 — deepen the buy side (WETH-only ladder) ============
  console.log('\nC) Move: deepen buy side, 0.02 ETH, 0.90->0.65 of spot');
  state = await lib.readState(provider, info, ethUsd, null);
  const plan1 = lib.planBuySide(state, '0.02', ME);
  console.log('   range ticks', plan1.summary.range, '| top $' + (plan1.summary.topPrice * ethUsd).toExponential(3), 'bottom $' + (plan1.summary.bottomPrice * ethUsd).toExponential(3));
  const nBefore = (await npm.balanceOf(ME)).toNumber();
  await sendPlan(stranger, plan1.txs);
  const nAfter = (await npm.balanceOf(ME)).toNumber();
  const newId = await npm.tokenOfOwnerByIndex(ME, nAfter - 1);
  const pos = await npm.positions(newId);
  console.log('   positions', nBefore, '->', nAfter, '| new #' + newId, 'L=' + pos.liquidity.toString(), '[' + pos.tickLower + ',' + pos.tickUpper + ']', pos.liquidity.gt(0) ? 'LIQUIDITY OK' : 'ZERO LIQ!');

  // ============ TEST D: Move 2 — straddle both sides of spot ============
  console.log('\nD) Move: straddle, 2M MCFL + 0.004 ETH');
  state = await lib.readState(provider, info, ethUsd, null);
  const plan2 = lib.planStraddle(state, '2000000', '0.004', ME);
  console.log('   range ticks', plan2.summary.range, 'current tick', state.tick);
  await sendPlan(stranger, plan2.txs);
  const n2 = (await npm.balanceOf(ME)).toNumber();
  const id2 = await npm.tokenOfOwnerByIndex(ME, n2 - 1);
  const pos2 = await npm.positions(id2);
  console.log('   new #' + id2, 'L=' + pos2.liquidity.toString(), '[' + pos2.tickLower + ',' + pos2.tickUpper + ']', pos2.liquidity.gt(0) ? 'LIQUIDITY OK' : 'ZERO LIQ!');

  // ============ TEST E: Erik collects his fees ============
  console.log('\nE) Erik collects pending fees');
  await provider.send('anvil_impersonateAccount', [ERIK]);
  await provider.send('anvil_setBalance', [ERIK, ethers.utils.parseEther('1').toHexString()]);
  const erik = provider.getSigner(ERIK);
  const st2 = await lib.readState(provider, info, ethUsd, ERIK);
  console.log('   pending:', st2.positions.feesToken.toFixed(0), 'MCFL +', st2.positions.feesEth.toFixed(6), 'WETH across', st2.positions.list.length, 'positions');
  const planC = lib.planCollect(st2, ERIK);
  const mB = await erc20(CFG.MCFL).balanceOf(ERIK);
  for (const t of planC.txs.slice(0, 2)) {
    const tx = await erik.sendTransaction({ to: t.to, data: t.data, gasLimit: 1000000 });
    const rc = await tx.wait();
    console.log('  ', rc.status === 1 ? 'OK ' : 'REVERT', t.label);
  }
  const mA = await erc20(CFG.MCFL).balanceOf(ERIK);
  console.log('   MCFL delta:', parseFloat(ethers.utils.formatEther(mA.sub(mB))).toFixed(0));

  // ============ TEST F: direct MCFL fee payment ============
  console.log('\nF) $25 fee paid directly in MCFL (holder path)');
  const q3 = await lib.quoteFee(provider, ethUsd);
  const tB = await erc20(CFG.MCFL).balanceOf(CFG.TREASURY);
  await sendPlan(stranger, [lib.payFeeWithMcflTx(q3)]);
  const tA = await erc20(CFG.MCFL).balanceOf(CFG.TREASURY);
  console.log('   treasury MCFL delta:', Math.round(parseFloat(ethers.utils.formatEther(tA.sub(tB)))).toLocaleString(), '(expected', Math.round(q3.mcflAmountF).toLocaleString() + ')');

  console.log('\nALL FORK SIMULATIONS DONE');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
