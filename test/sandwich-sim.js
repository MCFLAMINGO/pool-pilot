/* Sim H: adversarial sandwich test.
   1. Victim plans a straddle at the current price (mins are baked in at plan time).
   2. BEFORE the mint lands, an attacker shoves the price with a big buy.
   3. The victim's mint must REVERT (slippage floors), not deposit a skewed position. */
const lib = require('../js/chainlib.js');
const { ethers } = require('ethers');
const CFG = lib.CFG;

const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');
const victim = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider); // hardhat acct0
const attacker = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider); // hardhat acct1

async function send(signer, t) {
  const tx = await signer.sendTransaction({ to: t.to, data: t.data, value: t.value || 0, gasLimit: 3000000 });
  return tx.wait();
}

(async () => {
  await provider.send('anvil_setBalance', [attacker.address, ethers.utils.parseEther('10').toHexString()]);
  const ethUsd = await lib.fetchEthUsd(global.fetch) || 1910;
  const info = await lib.discoverPool(provider, CFG.MCFL);
  let state = await lib.readState(provider, info, ethUsd, null);
  console.log('tick at plan time:', state.tick);

  // victim buys some MCFL first so it can straddle
  const q = await lib.quoteFee(provider, ethUsd);
  const buy = { tokenIn: CFG.WETH, tokenOut: CFG.MCFL, fee: info.fee, recipient: victim.address,
    amountIn: ethers.utils.parseEther('0.02'), amountOutMinimum: 0, sqrtPriceLimitX96: 0 };
  await send(victim, { to: CFG.ROUTER02, value: buy.amountIn.toHexString(), data: lib.ifaces.router.encodeFunctionData('exactInputSingle', [buy]) });

  // re-read state, plan straddle NOW (mins locked to this tick)
  state = await lib.readState(provider, info, ethUsd, null);
  const plan = lib.planStraddle(state, '1500000', '0.004', victim.address);
  console.log('straddle planned at tick', state.tick, 'range', plan.summary ? plan.summary.range : '(n/a)');
  const mintIdx = plan.txs.length - 1;
  // send all prep txs (wrap + approvals) but NOT the mint yet
  for (let i = 0; i < mintIdx; i++) await send(victim, plan.txs[i]);

  // ATTACKER shoves the price with a 0.05 ETH buy (huge for this pool)
  const shove = { tokenIn: CFG.WETH, tokenOut: CFG.MCFL, fee: info.fee, recipient: attacker.address,
    amountIn: ethers.utils.parseEther('0.05'), amountOutMinimum: 0, sqrtPriceLimitX96: 0 };
  await send(attacker, { to: CFG.ROUTER02, value: shove.amountIn.toHexString(), data: lib.ifaces.router.encodeFunctionData('exactInputSingle', [shove]) });
  const after = await lib.readState(provider, info, ethUsd, null);
  console.log('tick after attacker shove:', after.tick, '(moved', after.tick - state.tick, 'ticks)');

  // victim's mint should now REVERT
  let reverted = false;
  try {
    const rc = await send(victim, plan.txs[mintIdx]);
    if (rc.status !== 1) reverted = true;
  } catch (e) { reverted = true; }
  console.log(reverted
    ? 'SIM H PASS ✓ — skewed mint REVERTED, victim funds untouched (only gas + approvals spent)'
    : 'SIM H FAIL ✗ — mint went through at the manipulated price!');
  process.exit(reverted ? 0 : 1);
})().catch(e => { console.error('sim error:', e.message); process.exit(1); });
