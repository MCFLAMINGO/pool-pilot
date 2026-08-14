const lib = require('../js/chainlib.js');
const fetch = global.fetch;

const TOKENS = {
  MCFL: '0x21A91215fbFc4fc002B07cc87698A6fC01Aed523',
  CASHCAT: '0x020bfc650a365f8bb26819deaabf3e21291018b4',
  FLAMINGO: '0x09fd8577a5d4a7202d41aa3040f4247df4ea2d98',
  ANSEM: '0x521934eA44568164cd3A578E5823DBa0dE700880'
};
const ERIK = '0x1Aa92670a4e680081c407E060A3E8BC3D1929a13';

(async () => {
  const provider = lib.getProvider();
  const ethUsd = await lib.fetchEthUsd(fetch);
  console.log('ETH/USD =', ethUsd);

  for (const [name, addr] of Object.entries(TOKENS)) {
    console.log('\n===== ' + name + ' =====');
    try {
      const info = await lib.discoverPool(provider, addr);
      console.log('pool:', info.pool, 'fee:', info.fee, 'symbol:', info.symbol, 'dec:', info.decimals, 'tokenIsToken1:', info.tokenIsToken1);
      const st = await lib.readState(provider, info, ethUsd, name === 'MCFL' ? ERIK : null);
      console.log('tick:', st.tick, 'routable:', st.routable);
      console.log('price:', st.priceEth.toExponential(4), 'ETH =', st.priceUsd ? '$' + st.priceUsd.toExponential(4) : 'n/a');
      console.log('sell-side:', Math.round(st.sellSideTokens).toLocaleString(), info.symbol, '= $' + (st.sellSideUsd||0).toFixed(2));
      console.log('buy-side:', st.buySideEth.toFixed(4), 'WETH = $' + (st.buySideUsd||0).toFixed(2));
      console.log('sell $50 impact:', st.sellImpact.ok ? st.sellImpact.pctMove.toFixed(2) + '%' : 'FAIL ' + st.sellImpact.error);
      console.log('buy  $50 impact:', st.buyImpact.ok ? st.buyImpact.pctMove.toFixed(2) + '%' : 'FAIL ' + st.buyImpact.error);
      console.log('light:', st.light, '| reasons:', st.reasons.join(' / ') || '(healthy)');
      if (st.positions) {
        console.log('erik positions:', st.positions.list.map(p => '#' + p.id + ' [' + p.tickLower + ',' + p.tickUpper + '] L=' + p.liquidity).join(' | '));
        console.log('uncollected fees:', st.positions.feesToken.toFixed(0), info.symbol, '+', st.positions.feesEth.toFixed(6), 'WETH');
      }
    } catch (e) {
      console.log('DISCOVERY/READ ERROR:', e.message.slice(0, 160));
    }
  }
})();
