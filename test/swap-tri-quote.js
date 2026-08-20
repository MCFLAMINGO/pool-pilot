/* Live quote smoke tests for triangular ETH | USDG | Token desk. */
const L = require('../js/chainlib.js');
const provider = L.getProvider();

async function assertPlan(label, opts, expect) {
  const plan = await L.planFeeSwap(provider, {
    feeBps: L.CFG.SWAP_FEE_BPS,
    slippageBps: 100,
    ...opts
  });
  console.log('—', label);
  console.log('  route', plan.pathLabel, 'hops', plan.hops);
  console.log('  in', plan.amountInF, plan.symbolIn, '→ out~', plan.amountOutF, plan.symbolOut);
  console.log('  protocol fee', plan.feeF, plan.symbolIn);
  if (!plan.amountOut.gt(0)) throw new Error(label + ': zero out');
  if (expect.hops != null && plan.hops !== expect.hops) {
    throw new Error(label + ': expected hops ' + expect.hops + ' got ' + plan.hops);
  }
  if (expect.multi && plan.route.mode !== 'multi') {
    throw new Error(label + ': expected multi-hop');
  }
  const txs = plan.buildTxs(L.CFG.TREASURY);
  console.log('  steps', txs.map((t) => t.label));
  if (txs.length < 1) throw new Error(label + ': no txs');
  return plan;
}

async function main() {
  await assertPlan('ETH → MCFL', {
    tokenIn: 'ETH',
    tokenOut: L.CFG.MCFL,
    amountIn: '0.01'
  }, { hops: 1 });

  await assertPlan('ETH → USDG', {
    tokenIn: 'ETH',
    tokenOut: 'USDG',
    amountIn: '0.01'
  }, { hops: 1 });

  await assertPlan('USDG → ETH', {
    tokenIn: 'USDG',
    tokenOut: 'ETH',
    amountIn: '5'
  }, { hops: 1 });

  // MCFL has no direct USDG pool → multi-hop via WETH
  await assertPlan('USDG → MCFL (via WETH)', {
    tokenIn: 'USDG',
    tokenOut: L.CFG.MCFL,
    amountIn: '5'
  }, { hops: 2, multi: true });

  await assertPlan('MCFL → USDG (via WETH)', {
    tokenIn: L.CFG.MCFL,
    tokenOut: 'USDG',
    amountIn: '1000'
  }, { hops: 2, multi: true });

  console.log('TRIANGULAR SWAP QUOTES OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
