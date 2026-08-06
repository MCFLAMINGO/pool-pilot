/* Pool Pilot chain library — Robinhood Chain (Uniswap v3)
   Universal module: Node (tests) + browser (widget).
   All reads are live RPC. All writes are built as raw tx objects
   for the user's own wallet to sign — nothing custodial. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('ethers').ethers || require('ethers'));
  } else {
    root.ChainLib = factory(root.ethers);
  }
})(typeof self !== 'undefined' ? self : this, function (ethers) {
  'use strict';

  var CFG = {
    RPC: 'https://rpc.mainnet.chain.robinhood.com',
    CHAIN_ID: 4663,
    CHAIN_ID_HEX: '0x1237',
    EXPLORER: 'https://robinhoodchain.blockscout.com',
    WETH: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
    FACTORY: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
    NPM: '0x73991a25c818bf1f1128deaab1492d45638de0d3',
    QUOTER_V2: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
    ROUTER02: '0xcaf681a66d020601342297493863e78c959e5cb2',
    MCFL: '0x21a91215fbfc4fc002b07cc87698a6fc01aed523',
    TREASURY: '0x1aa92670a4e680081c407e060a3e8bc3d1929a13',
    FEE_USD: 25,
    FEE_TIERS: [10000, 3000, 500, 100],
    SPACING: { 100: 1, 500: 10, 3000: 60, 10000: 200 }
  };

  var ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function transfer(address,uint256) returns (bool)'
  ];
  var WETH_ABI = ERC20_ABI.concat(['function deposit() payable']);
  var FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
  var POOL_ABI = [
    'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)',
    'function liquidity() view returns (uint128)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function fee() view returns (uint24)',
    'function tickSpacing() view returns (int24)'
  ];
  var QUOTER_ABI = [
    'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
    'function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'
  ];
  var NPM_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
    'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)',
    'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
    'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256 amount0,uint256 amount1)',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
    'function refundETH() payable'
  ];
  var ROUTER_ABI = [
    'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
  ];

  var iERC20 = new ethers.utils.Interface(ERC20_ABI);
  var iWETH = new ethers.utils.Interface(WETH_ABI);
  var iNPM = new ethers.utils.Interface(NPM_ABI);
  var iRouter = new ethers.utils.Interface(ROUTER_ABI);

  function getProvider() {
    return new ethers.providers.StaticJsonRpcProvider(CFG.RPC, {
      chainId: CFG.CHAIN_ID, name: 'robinhood'
    });
  }

  var MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1);

  // ---------- price math ----------
  function sqrtToPriceRaw(sqrtPriceX96) {
    // token1 raw per token0 raw
    var q = ethers.BigNumber.from(2).pow(96);
    var ratio = parseFloat(sqrtPriceX96.mul(1e9).div(q).toString()) / 1e9;
    return ratio * ratio;
  }
  // human price of 1 whole TOKEN in whole ETH:
  //   token==token1: (1/P) * 10^(tokenDec) / 10^18  -> (1/P)*10^(tokenDec-18)
  //   token==token0: P * 10^(tokenDec) / 10^18      -> P*10^(tokenDec-18)
  function priceOfTokenInEth(sqrtPriceX96, tokenIsToken1, tokenDec) {
    var P = sqrtToPriceRaw(sqrtPriceX96);
    var base = tokenIsToken1 ? (1 / P) : P;
    return base * Math.pow(10, tokenDec - 18);
  }

  function tickToSqrtPriceX96Float(tick) {
    return Math.pow(1.0001, tick / 2);
  }

  // price multiplier for the TOKEN -> tick offset direction depends on orientation
  // token==token1: token price DOWN as tick UP.  mult m -> tickOffset = ln(1/m)/ln(1.0001)
  // token==token0: token price UP  as tick UP.  mult m -> tickOffset = ln(m)/ln(1.0001)
  function multToTickOffset(mult, tokenIsToken1) {
    var l = Math.log(tokenIsToken1 ? (1 / mult) : mult) / Math.log(1.0001);
    return Math.round(l);
  }

  // Security: token symbol/name come from arbitrary contracts — strip anything
  // that is not a plain label character so they can never carry markup.
  function cleanLabel(s, max) {
    return String(s == null ? '' : s).replace(/[^A-Za-z0-9 _.$-]/g, '').trim().slice(0, max);
  }

  function alignTick(tick, spacing, roundUp) {
    var r = Math.floor(tick / spacing) * spacing;
    if (roundUp && r < tick) r += spacing;
    return r;
  }

  // ---------- discovery ----------
  function discoverPool(provider, tokenAddr) {
    tokenAddr = ethers.utils.getAddress(tokenAddr);
    if (tokenAddr.toLowerCase() === CFG.WETH.toLowerCase()) {
      return Promise.reject(new Error('That is the WETH address — paste your token address.'));
    }
    var factory = new ethers.Contract(CFG.FACTORY, FACTORY_ABI, provider);
    var weth = new ethers.Contract(CFG.WETH, ERC20_ABI, provider);
    return Promise.all(CFG.FEE_TIERS.map(function (fee) {
      return factory.getPool(tokenAddr, CFG.WETH, fee).then(function (addr) {
        if (addr === ethers.constants.AddressZero) return null;
        return weth.balanceOf(addr).then(function (bal) {
          return { fee: fee, address: addr, wethBal: bal };
        });
      }).catch(function () { return null; });
    })).then(function (pools) {
      pools = pools.filter(Boolean);
      if (!pools.length) throw new Error('No Uniswap v3 pool paired with WETH found for this token on Robinhood Chain.');
      pools.sort(function (a, b) { return b.wethBal.gte(a.wethBal) ? 1 : -1; });
      var best = pools[0];
      var pool = new ethers.Contract(best.address, POOL_ABI, provider);
      var token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
      return Promise.all([
        pool.token0(), pool.token1(), token.decimals(), token.symbol(),
        token.name().catch(function () { return ''; })
      ]).then(function (r) {
        return {
          token: tokenAddr,
          symbol: cleanLabel(r[3], 12) || 'TOKEN',
          name: cleanLabel(r[4], 40) || 'Unknown token',
          decimals: r[2],
          pool: best.address,
          fee: best.fee,
          spacing: CFG.SPACING[best.fee],
          token0: r[0],
          token1: r[1],
          tokenIsToken1: r[1].toLowerCase() === tokenAddr.toLowerCase()
        };
      });
    });
  }

  // ---------- ETH/USD ----------
  // Security: a poisoned/failing price API must never produce an absurd fee.
  // Anything outside a wide sanity band is treated as "no price" (blocks the ETH fee path).
  function saneUsd(v) { return (typeof v === 'number' && isFinite(v) && v >= 100 && v <= 100000) ? v : null; }

  function fetchEthUsd(fetchFn) {
    var f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return Promise.resolve(null);
    return f('https://api.coinbase.com/v2/prices/ETH-USD/spot')
      .then(function (r) { return r.json(); })
      .then(function (j) { var v = saneUsd(parseFloat(j.data.amount)); if (v == null) throw new Error('bad price'); return v; })
      .catch(function () {
        return f('https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var m = j.data.attributes.token_prices;
            return saneUsd(parseFloat(m[Object.keys(m)[0]]));
          })
          .catch(function () { return null; });
      });
  }

  // ---------- state ----------
  function readState(provider, info, ethUsd, walletAddr) {
    var pool = new ethers.Contract(info.pool, POOL_ABI, provider);
    var token = new ethers.Contract(info.token, ERC20_ABI, provider);
    var weth = new ethers.Contract(CFG.WETH, ERC20_ABI, provider);
    var quoter = new ethers.Contract(CFG.QUOTER_V2, QUOTER_ABI, provider);

    return Promise.all([
      pool.slot0(), pool.liquidity(),
      token.balanceOf(info.pool), weth.balanceOf(info.pool)
    ]).then(function (r) {
      var slot0 = r[0], liq = r[1];
      var tokenBal = parseFloat(ethers.utils.formatUnits(r[2], info.decimals));
      var wethBal = parseFloat(ethers.utils.formatEther(r[3]));
      var priceEth = priceOfTokenInEth(slot0.sqrtPriceX96, info.tokenIsToken1, info.decimals);
      var priceUsd = ethUsd ? priceEth * ethUsd : null;
      var state = {
        info: info,
        tick: slot0.tick,
        sqrtPriceX96: slot0.sqrtPriceX96,
        activeLiquidity: liq,
        routable: !liq.isZero(),
        priceEth: priceEth,
        priceUsd: priceUsd,
        ethUsd: ethUsd,
        sellSideTokens: tokenBal,            // tokens waiting to be bought
        sellSideUsd: priceUsd ? tokenBal * priceUsd : null,
        buySideEth: wethBal,                 // ETH backing the buy side
        buySideUsd: ethUsd ? wethBal * ethUsd : null
      };

      // impact probes: $50 sell and $50 buy (fall back to ETH terms if no USD feed)
      var usd = ethUsd || 3000;
      var sellTokens = (50 / (priceUsd || (priceEth * usd)));
      var sellIn = ethers.utils.parseUnits(sellTokens.toFixed(Math.min(info.decimals, 8)), info.decimals);
      var buyEth = 50 / usd;
      var buyIn = ethers.utils.parseEther(buyEth.toFixed(12));

      function probe(tokenIn, tokenOut, amountIn) {
        return quoter.callStatic.quoteExactInputSingle({
          tokenIn: tokenIn, tokenOut: tokenOut, amountIn: amountIn,
          fee: info.fee, sqrtPriceLimitX96: 0
        }).then(function (q) {
          var pAfter = priceOfTokenInEth(q.sqrtPriceX96After, info.tokenIsToken1, info.decimals);
          return { ok: true, amountOut: q.amountOut, pctMove: (pAfter / priceEth - 1) * 100 };
        }).catch(function (e) { return { ok: false, error: (e && e.message || '').slice(0, 120) }; });
      }

      return Promise.all([
        probe(info.token, CFG.WETH, sellIn),   // someone sells $50 of token
        probe(CFG.WETH, info.token, buyIn),    // someone buys with $50 of ETH
        walletAddr ? readWalletPositions(provider, info, walletAddr) : Promise.resolve(null)
      ]).then(function (pr) {
        state.sellImpact = pr[0];
        state.buyImpact = pr[1];
        state.positions = pr[2];

        // status
        var sSell = state.sellSideUsd == null ? state.sellSideTokens * priceEth * usd : state.sellSideUsd;
        var sBuy = state.buySideUsd == null ? state.buySideEth * usd : state.buySideUsd;
        var reasons = [];
        var light = 'green';
        if (!state.routable) { light = 'red'; reasons.push('Routers see zero active liquidity — most trade widgets will say "no route" for your token.'); }
        if (!pr[0].ok || !pr[1].ok) { if (light !== 'red') light = 'red'; reasons.push('A $50 trade cannot even be quoted — one side of your book is empty.'); }
        var worst = Math.max(Math.abs(pr[0].ok ? pr[0].pctMove : 0), Math.abs(pr[1].ok ? pr[1].pctMove : 0));
        if (worst > 10 && light === 'green') { light = 'yellow'; reasons.push('A $50 trade moves your price ' + (worst > 500 ? 'more than 500' : worst.toFixed(0)) + '% — thin book.'); }
        var hi = Math.max(sSell, sBuy), lo = Math.min(sSell, sBuy);
        if (lo > 0 && hi / lo > 3 && light === 'green') { light = 'yellow'; reasons.push('Your book is lopsided — ' + (sSell > sBuy ? 'lots for sale, little buy support.' : 'buy support but little inventory for sale.')); }
        if (lo === 0 && light === 'green') { light = 'yellow'; reasons.push('One side of your book is completely empty.'); }
        state.light = light;
        state.reasons = reasons;
        return state;
      });
    });
  }

  function readWalletPositions(provider, info, walletAddr) {
    var npm = new ethers.Contract(CFG.NPM, NPM_ABI, provider);
    return npm.balanceOf(walletAddr).then(function (n) {
      n = n.toNumber();
      if (n === 0) return { list: [], feesToken: 0, feesEth: 0 };
      var idx = []; for (var i = 0; i < Math.min(n, 30); i++) idx.push(i);
      return Promise.all(idx.map(function (i) {
        return npm.tokenOfOwnerByIndex(walletAddr, i).then(function (id) {
          return npm.positions(id).then(function (p) {
            var match = p.token0.toLowerCase() === info.token0.toLowerCase() &&
                        p.token1.toLowerCase() === info.token1.toLowerCase() &&
                        p.fee === info.fee;
            if (!match) return null;
            return npm.callStatic.collect({
              tokenId: id, recipient: walletAddr,
              amount0Max: MAX_UINT128, amount1Max: MAX_UINT128
            }, { from: walletAddr }).then(function (c) {
              return {
                id: id.toString(), tickLower: p.tickLower, tickUpper: p.tickUpper,
                liquidity: p.liquidity.toString(),
                fees0: parseFloat(ethers.utils.formatUnits(c.amount0, info.tokenIsToken1 ? 18 : info.decimals)),
                fees1: parseFloat(ethers.utils.formatUnits(c.amount1, info.tokenIsToken1 ? info.decimals : 18))
              };
            }).catch(function () {
              return { id: id.toString(), tickLower: p.tickLower, tickUpper: p.tickUpper, liquidity: p.liquidity.toString(), fees0: 0, fees1: 0 };
            });
          });
        });
      })).then(function (list) {
        list = list.filter(Boolean);
        var fT = 0, fE = 0;
        list.forEach(function (p) {
          if (info.tokenIsToken1) { fE += p.fees0; fT += p.fees1; }
          else { fT += p.fees0; fE += p.fees1; }
        });
        return { list: list, feesToken: fT, feesEth: fE };
      });
    });
  }

  // ---------- move planners (return {summary, txs:[{to,data,value,label}]}) ----------
  function deadline() { return Math.floor(Date.now() / 1000) + 1200; }

  // Move 1: deepen the buy side — WETH-only ladder on the "cheaper" side of spot
  function planBuySide(state, ethAmountStr, walletAddr, topMult, bottomMult) {
    var info = state.info;
    var ethAmount = ethers.utils.parseEther(ethAmountStr);
    topMult = topMult || 0.90; bottomMult = bottomMult || 0.65;
    var offTop = multToTickOffset(topMult, info.tokenIsToken1);
    var offBot = multToTickOffset(bottomMult, info.tokenIsToken1);
    var tick = state.tick, sp = info.spacing;
    var lo, hi;
    if (info.tokenIsToken1) { // bids ABOVE current tick
      lo = alignTick(tick + offTop, sp, true);
      hi = alignTick(tick + offBot, sp, false);
      if (lo <= tick) lo = alignTick(tick + sp, sp, true);
      if (hi <= lo) hi = lo + sp;
    } else {                  // bids BELOW current tick
      lo = alignTick(tick + offBot, sp, true); // offBot negative
      hi = alignTick(tick + offTop, sp, false);
      if (hi >= tick) hi = alignTick(tick - sp, sp, false);
      if (lo >= hi) lo = hi - sp;
    }
    // WETH-only position: if token is token1, range above tick holds token0(WETH) ✓
    // if token is token0, range below tick holds token1(WETH) ✓
    var amount0 = info.tokenIsToken1 ? ethAmount : ethers.constants.Zero;
    var amount1 = info.tokenIsToken1 ? ethers.constants.Zero : ethAmount;
    var mintParams = {
      token0: info.token0, token1: info.token1, fee: info.fee,
      tickLower: lo, tickUpper: hi,
      amount0Desired: amount0, amount1Desired: amount1,
      amount0Min: 0, amount1Min: 0,
      recipient: walletAddr, deadline: deadline()
    };
    return {
      kind: 'buyside',
      summary: {
        range: [lo, hi],
        topPrice: state.priceEth * topMult,
        bottomPrice: state.priceEth * bottomMult,
        ethIn: parseFloat(ethAmountStr)
      },
      txs: [
        { label: 'Wrap ' + ethAmountStr + ' ETH', to: CFG.WETH, value: ethAmount.toHexString(), data: iWETH.encodeFunctionData('deposit', []) },
        { label: 'Approve WETH for the position manager', to: CFG.WETH, value: '0x0', data: iERC20.encodeFunctionData('approve', [CFG.NPM, ethAmount]) },
        { label: 'Place your buy wall (mint position)', to: CFG.NPM, value: '0x0', data: iNPM.encodeFunctionData('mint', [mintParams]), mintParams: mintParams }
      ]
    };
  }

  // Move 2: tighten the spread — straddle around spot using wallet balances
  function planStraddle(state, tokenAmountStr, ethAmountStr, walletAddr, widthTicksEachSide) {
    var info = state.info;
    var sp = info.spacing;
    var w = widthTicksEachSide || sp * 3;
    w = Math.max(sp, Math.round(w / sp) * sp);
    var lo = alignTick(state.tick - w, sp, false);
    var hi = alignTick(state.tick + w, sp, true);
    if (hi <= state.tick) hi = alignTick(state.tick + sp, sp, true);
    if (lo >= state.tick) lo = alignTick(state.tick - sp, sp, false);
    var tokenAmt = ethers.utils.parseUnits(tokenAmountStr, info.decimals);
    var ethAmt = ethers.utils.parseEther(ethAmountStr);
    var amount0 = info.tokenIsToken1 ? ethAmt : tokenAmt;
    var amount1 = info.tokenIsToken1 ? tokenAmt : ethAmt;
    // Security (MEV): for an in-range mint the pool price at execution decides how much of
    // each side is actually used. Compute the expected split at the CURRENT price and
    // require at least 80% of it — if someone shoves the price before the mint lands,
    // the transaction reverts instead of depositing a skewed position.
    var m0 = 0, m1 = 0;
    var a0f = parseFloat(amount0.toString()), a1f = parseFloat(amount1.toString());
    if (a0f > 0 && a1f > 0) {
      var sqP = Math.pow(1.0001, state.tick / 2), sqL = Math.pow(1.0001, lo / 2), sqH = Math.pow(1.0001, hi / 2);
      var L0 = a0f * (sqP * sqH) / (sqH - sqP);
      var L1 = a1f / (sqP - sqL);
      var L = Math.min(L0, L1);
      var r0 = (L * (sqH - sqP) / (sqP * sqH)) / a0f;   // expected used / desired, 0..1
      var r1 = (L * (sqP - sqL)) / a1f;
      m0 = amount0.mul(Math.max(0, Math.floor(r0 * 800))).div(1000);
      m1 = amount1.mul(Math.max(0, Math.floor(r1 * 800))).div(1000);
    }
    var mintParams = {
      token0: info.token0, token1: info.token1, fee: info.fee,
      tickLower: lo, tickUpper: hi,
      amount0Desired: amount0, amount1Desired: amount1,
      amount0Min: m0, amount1Min: m1,
      recipient: walletAddr, deadline: deadline()
    };
    var txs = [];
    if (parseFloat(ethAmountStr) > 0) {
      txs.push({ label: 'Wrap ' + ethAmountStr + ' ETH', to: CFG.WETH, value: ethAmt.toHexString(), data: iWETH.encodeFunctionData('deposit', []) });
      txs.push({ label: 'Approve WETH', to: CFG.WETH, value: '0x0', data: iERC20.encodeFunctionData('approve', [CFG.NPM, ethAmt]) });
    }
    txs.push({ label: 'Approve ' + info.symbol, to: info.token, value: '0x0', data: iERC20.encodeFunctionData('approve', [CFG.NPM, tokenAmt]) });
    txs.push({ label: 'Mint the straddle (both sides of spot)', to: CFG.NPM, value: '0x0', data: iNPM.encodeFunctionData('mint', [mintParams]), mintParams: mintParams });
    return {
      kind: 'straddle',
      summary: { range: [lo, hi], widthTicks: w, tokenIn: parseFloat(tokenAmountStr), ethIn: parseFloat(ethAmountStr) },
      txs: txs
    };
  }

  // Move 3: collect earned fees on all matching positions
  function planCollect(state, walletAddr) {
    var txs = (state.positions && state.positions.list || [])
      .filter(function (p) { return true; })
      .map(function (p) {
        return {
          label: 'Collect fees from position #' + p.id,
          to: CFG.NPM, value: '0x0',
          data: iNPM.encodeFunctionData('collect', [{
            tokenId: p.id, recipient: walletAddr,
            amount0Max: MAX_UINT128, amount1Max: MAX_UINT128
          }])
        };
      });
    return { kind: 'collect', summary: {}, txs: txs };
  }

  // $25 fee payment. Two paths:
  //  a) payWithTokenBalance: direct MCFL transfer (user already holds MCFL)
  //  b) payWithEth: the ETH is deposited as buy-side liquidity in the MCFL pool,
  //     position owned by the treasury. No swap, no price impact — every fee
  //     payment automatically deepens the MCFL book instead of moving it.
  function quoteFee(provider, ethUsd) {
    // price MCFL from its own pool
    return discoverPool(provider, CFG.MCFL).then(function (info) {
      var pool = new ethers.Contract(info.pool, POOL_ABI, provider);
      return pool.slot0().then(function (s) {
        var pEth = priceOfTokenInEth(s.sqrtPriceX96, info.tokenIsToken1, info.decimals);
        // Security: never invent an ETH price. If the feed is down or returned an
        // insane value, refuse to quote a fee rather than charging a wrong amount.
        var usd = saneUsd(ethUsd);
        if (usd == null) throw new Error('Cannot price the $25 fee right now \u2014 the ETH price feed is unavailable. Try again in a moment.');
        var pUsd = pEth * usd;
        if (!isFinite(pUsd) || pUsd <= 0) throw new Error('This pool has no usable price right now \u2014 refusing to quote a fee.');
        var mcflAmountF = CFG.FEE_USD / pUsd;
        var mcflAmount = ethers.utils.parseUnits(mcflAmountF.toFixed(6), info.decimals);
        var ethInF = CFG.FEE_USD / usd; // exactly $25 of ETH at spot — no impact premium
        var ethIn = ethers.utils.parseEther(ethInF.toFixed(9));
        return {
          info: info,
          tick: s.tick,
          mcflAmount: mcflAmount,
          mcflAmountF: mcflAmountF,
          mcflPriceUsd: pUsd,
          ethIn: ethIn,
          ethInF: parseFloat(ethers.utils.formatEther(ethIn)),
          usdIn: CFG.FEE_USD
        };
      });
    });
  }
  // ETH fee → treasury-owned buy wall in the MCFL pool (5%–30% below spot).
  // Single tx: NPM.multicall([mint(recipient=treasury), refundETH]) with ETH value.
  function payFeeWithEthTx(quote) {
    var info = quote.info, sp = info.spacing, tick = quote.tick;
    var offTop = multToTickOffset(0.95, info.tokenIsToken1);
    var offBot = multToTickOffset(0.70, info.tokenIsToken1);
    var lo, hi;
    if (info.tokenIsToken1) { // bids ABOVE current tick
      lo = alignTick(tick + offTop, sp, true);
      hi = alignTick(tick + offBot, sp, false);
      if (lo <= tick + sp) lo = alignTick(tick + sp + 1, sp, true); // keep a full spacing of buffer
      if (hi <= lo) hi = lo + sp;
    } else {                  // bids BELOW current tick
      lo = alignTick(tick + offBot, sp, true);
      hi = alignTick(tick + offTop, sp, false);
      if (hi >= tick - sp) hi = alignTick(tick - sp - 1, sp, false);
      if (lo >= hi) lo = hi - sp;
    }
    var amount0 = info.tokenIsToken1 ? quote.ethIn : ethers.constants.Zero;
    var amount1 = info.tokenIsToken1 ? ethers.constants.Zero : quote.ethIn;
    var mintParams = {
      token0: info.token0, token1: info.token1, fee: info.fee,
      tickLower: lo, tickUpper: hi,
      amount0Desired: amount0, amount1Desired: amount1,
      amount0Min: 0, amount1Min: 0,
      recipient: CFG.TREASURY, deadline: deadline()
    };
    var calls = [
      iNPM.encodeFunctionData('mint', [mintParams]),
      iNPM.encodeFunctionData('refundETH', [])
    ];
    return {
      label: 'Pay $' + CFG.FEE_USD + ' fee — your ETH becomes MCFL buy-side liquidity owned by the treasury (no price impact)',
      to: CFG.NPM, value: quote.ethIn.toHexString(),
      data: iNPM.encodeFunctionData('multicall', [calls]),
      mintParams: mintParams
    };
  }
  function payFeeWithMcflTx(quote) {
    return {
      label: 'Pay $' + CFG.FEE_USD + ' fee — transfer ' + Math.round(quote.mcflAmountF).toLocaleString() + ' MCFL to treasury',
      to: CFG.MCFL, value: '0x0',
      data: iERC20.encodeFunctionData('transfer', [CFG.TREASURY, quote.mcflAmount])
    };
  }

  // Rebuild a mint's slippage minimums + deadline against the LIVE tick right before
  // signing. Plans can sit open for minutes while the user wraps/approves; the pool
  // trades in the meantime and mins computed at plan time go stale, which makes the
  // wallet's gas estimate revert (the tx "blips" and never broadcasts).
  function refreshMintTx(info, mintParams, wrapRefund) {
    var provider = getProvider();
    var pool = new ethers.Contract(info.pool, POOL_ABI, provider);
    return pool.slot0().then(function (s) {
      var tick = s.tick;
      var lo = mintParams.tickLower, hi = mintParams.tickUpper;
      var amount0 = ethers.BigNumber.from(mintParams.amount0Desired);
      var amount1 = ethers.BigNumber.from(mintParams.amount1Desired);
      var bothSides = amount0.gt(0) && amount1.gt(0);
      // A straddle whose price escaped the range is no longer a straddle — rebuild it.
      if (bothSides && (tick <= lo || tick >= hi)) {
        return { ok: false, reason: 'The price has moved outside your planned range — close this and rebuild the plan so it re-centers on the live price.' };
      }
      var m0 = 0, m1 = 0;
      if (bothSides) {
        var a0f = parseFloat(amount0.toString()), a1f = parseFloat(amount1.toString());
        var sqP = Math.pow(1.0001, tick / 2), sqL = Math.pow(1.0001, lo / 2), sqH = Math.pow(1.0001, hi / 2);
        var L0 = a0f * (sqP * sqH) / (sqH - sqP);
        var L1 = a1f / (sqP - sqL);
        var L = Math.min(L0, L1);
        var r0 = (L * (sqH - sqP) / (sqP * sqH)) / a0f;
        var r1 = (L * (sqP - sqL)) / a1f;
        m0 = amount0.mul(Math.max(0, Math.floor(r0 * 800))).div(1000);
        m1 = amount1.mul(Math.max(0, Math.floor(r1 * 800))).div(1000);
      }
      var fresh = {
        token0: mintParams.token0, token1: mintParams.token1, fee: mintParams.fee,
        tickLower: lo, tickUpper: hi,
        amount0Desired: amount0, amount1Desired: amount1,
        amount0Min: m0, amount1Min: m1,
        recipient: mintParams.recipient, deadline: deadline()
      };
      var call = iNPM.encodeFunctionData('mint', [fresh]);
      if (wrapRefund) call = iNPM.encodeFunctionData('multicall', [[call, iNPM.encodeFunctionData('refundETH', [])]]);
      return { ok: true, data: call };
    });
  }

  function fmtPrice(p) {
    if (p == null) return '—';
    if (p === 0) return '0';
    if (p < 0.001) return '$' + p.toExponential(2);
    if (p < 1) return '$' + p.toPrecision(3);
    return '$' + p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return {
    CFG: CFG,
    getProvider: getProvider,
    discoverPool: discoverPool,
    fetchEthUsd: fetchEthUsd,
    readState: readState,
    readWalletPositions: readWalletPositions,
    planBuySide: planBuySide,
    planStraddle: planStraddle,
    planCollect: planCollect,
    refreshMintTx: refreshMintTx,
    quoteFee: quoteFee,
    payFeeWithEthTx: payFeeWithEthTx,
    payFeeWithMcflTx: payFeeWithMcflTx,
    priceOfTokenInEth: priceOfTokenInEth,
    fmtPrice: fmtPrice,
    ifaces: { erc20: iERC20, weth: iWETH, npm: iNPM, router: iRouter }
  };
});
