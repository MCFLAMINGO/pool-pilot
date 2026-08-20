/* Live quote smoke test for planFeeSwap (needs RPC). */
const L = require('../js/chainlib.js');
const provider = L.getProvider();

async function main() {
  const plan = await L.planFeeSwap(provider, {
    tokenIn: 'ETH',
    tokenOut: L.CFG.MCFL,
    amountIn: '0.01',
    feeBps: L.CFG.SWAP_FEE_BPS,
    slippageBps: 100
  });
  console.log('symbol', plan.info.symbol, 'feeTier', plan.info.fee);
  console.log('in', plan.amountInF, plan.symbolIn, '→ out~', plan.amountOutF, plan.symbolOut);
  console.log('protocol fee', plan.feeF, plan.symbolIn, `(${plan.feeBps} bps)`);
  const txs = plan.buildTxs(L.CFG.TREASURY);
  console.log('steps', txs.map((t) => t.label));
  if (txs.length < 2) throw new Error('expected fee + swap steps');
  if (!plan.amountOut.gt(0)) throw new Error('zero out');
  console.log('SWAP QUOTE OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
