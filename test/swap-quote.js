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
  console.log('protocol fee', plan.feeF, plan.symbolIn, `(${plan.feeBps} bps)`,
    plan.feeLpsEth ? `LP ${plan.feeLpEthF} ETH` : '',
    plan.feeBuysMcfl ? `→ MCFL desk ~${plan.feeMcflOutF}` : '');
  const txs = plan.buildTxs(L.CFG.TREASURY);
  console.log('steps', txs.map((t) => t.label));
  if (txs.length < 2) throw new Error('expected fee + swap steps');
  if (!plan.amountOut.gt(0)) throw new Error('zero out');
  if (plan.feeLpsEth) {
    if (txs[0].to.toLowerCase() !== L.CFG.NPM.toLowerCase()) throw new Error('ETH LP fee should mint via NPM');
  }
  if (plan.feeBuysMcfl) {
    const buyTx = txs.find((t) => /desk/i.test(t.label));
    if (!buyTx || buyTx.to.toLowerCase() !== L.CFG.ROUTER02.toLowerCase()) {
      throw new Error('ETH fee MCFL buy should hit router');
    }
    if (!plan.feeMcflOutF || plan.feeMcflOutF <= 0) throw new Error('expected MCFL out from fee buy');
  }
  console.log('SWAP QUOTE OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
