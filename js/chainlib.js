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
    /** Robinhood Chain USDG — cash leg for triangular / stock-token desk. */
    USDG: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    TREASURY: '0x1aa92670a4e680081c407e060a3e8bc3d1929a13',
    FEE_USD: 25,
    /** Pool Pilot swap UI — bps skimmed before the Uniswap hop (30 = 0.30%). */
    SWAP_FEE_BPS: 30,
    /**
     * Of an ETH skim (after bootstrap): this many bps go to treasury-owned
     * MCFL buy-side LP; the rest quietly buys MCFL for the treasury wallet
     * (10000 = all LP). During bootstrap, LP share is forced to 10000.
     */
    SWAP_FEE_LP_SHARE_BPS: 7000,
    /**
     * While MCFL/WETH buy-side depth (ETH USD in pool) is below this, 100% of
     * the ETH skim strengthens the buy-wall LP — no quiet MCFL buy that would
     * chew the thin sell book.
     */
    SWAP_FEE_BOOTSTRAP_BUY_USD: 10000,
    /** Skip LP or MCFL-buy legs below this wei (dust on tiny swaps). */
    SWAP_FEE_DUST_WEI: '1000000000000', // 1e12 ≈ 0.000001 ETH
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
    'function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
    'function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)'
  ];
  var NPM_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
    'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)',
    'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
    'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint256 amount0,uint256 amount1)',
    'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256 amount0,uint256 amount1)',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
    'function refundETH() payable'
  ];
  var ROUTER_ABI = [
    'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
    'function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
    'function unwrapWETH9(uint256 amountMinimum, address recipient) payable'
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
  function planStraddle(state, tokenAmountStr, ethAmountStr, walletAddr, widthTicksEachSide, wethBalStr) {
    var info = state.info;
    var sp = info.spacing;
    var w = widthTicksEachSide || sp * 3;
    w = Math.max(sp, Math.round(w / sp) * sp);
    var tokenAmt = ethers.utils.parseUnits(tokenAmountStr, info.decimals);
    var ethAmt = ethers.utils.parseEther(ethAmountStr);
    var hasToken = tokenAmt.gt(0), hasEth = ethAmt.gt(0);
    if (!hasToken && !hasEth) throw new Error('Enter an amount on at least one side.');
    var lo, hi, oneSided = null;
    if (hasToken && hasEth) {
      // True straddle: range spans the current price, both tokens deposited.
      lo = alignTick(state.tick - w, sp, false);
      hi = alignTick(state.tick + w, sp, true);
      if (hi <= state.tick) hi = alignTick(state.tick + sp, sp, true);
      if (lo >= state.tick) lo = alignTick(state.tick - sp, sp, false);
    } else {
      // One token only: a range that spans the price would compute ZERO liquidity
      // and revert on-chain. Build a valid one-sided band adjacent to spot instead.
      // Which side holds which token (Uniswap v3): tick < lower = all token0,
      // tick >= upper = all token1.
      var tokenOnlySide = hasToken ? (info.tokenIsToken1 ? 'below' : 'above') : (info.tokenIsToken1 ? 'above' : 'below');
      if (tokenOnlySide === 'below') {
        hi = alignTick(state.tick, sp, false);
        lo = hi - w;
      } else {
        lo = alignTick(state.tick + sp, sp, true);
        hi = lo + w;
      }
      oneSided = hasToken ? info.symbol : 'ETH';
    }
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
    } else {
      // Out-of-range one-sided mint: the pool takes (almost exactly) the full amount
      // regardless of price, so 95% floors are safe and still block MEV games.
      if (a0f > 0) m0 = amount0.mul(950).div(1000);
      if (a1f > 0) m1 = amount1.mul(950).div(1000);
    }
    var mintParams = {
      token0: info.token0, token1: info.token1, fee: info.fee,
      tickLower: lo, tickUpper: hi,
      amount0Desired: amount0, amount1Desired: amount1,
      amount0Min: m0, amount1Min: m1,
      recipient: walletAddr, deadline: deadline()
    };
    var txs = [];
    if (hasEth) {
      // Credit WETH already sitting in the wallet — wrap only the shortfall.
      var wethBal = ethers.utils.parseEther(wethBalStr || '0');
      var wrapAmt = ethAmt.gt(wethBal) ? ethAmt.sub(wethBal) : ethers.constants.Zero;
      if (wrapAmt.gt(0)) {
        txs.push({ label: 'Wrap ' + ethers.utils.formatEther(wrapAmt) + ' ETH (you already hold ' + ethers.utils.formatEther(wethBal) + ' WETH)', to: CFG.WETH, value: wrapAmt.toHexString(), data: iWETH.encodeFunctionData('deposit', []) });
      }
      txs.push({ label: 'Approve WETH', to: CFG.WETH, value: '0x0', data: iERC20.encodeFunctionData('approve', [CFG.NPM, ethAmt]) });
    }
    if (hasToken) {
      txs.push({ label: 'Approve ' + info.symbol, to: info.token, value: '0x0', data: iERC20.encodeFunctionData('approve', [CFG.NPM, tokenAmt]) });
    }
    var mintLabel = oneSided
      ? 'Mint a one-sided ' + oneSided + ' band next to spot'
      : 'Mint the straddle (both sides of spot)';
    txs.push({ label: mintLabel, to: CFG.NPM, value: '0x0', data: iNPM.encodeFunctionData('mint', [mintParams]), mintParams: mintParams });
    return {
      kind: 'straddle',
      summary: { range: [lo, hi], widthTicks: w, tokenIn: parseFloat(tokenAmountStr), ethIn: parseFloat(ethAmountStr), oneSided: oneSided },
      txs: txs
    };
  }

  // Move 3: collect earned fees — one NPM.multicall for every matching position
  // so the user signs once instead of once per NFT (gas + wallet friction).
  function planCollect(state, walletAddr) {
    var all = (state.positions && state.positions.list) || [];
    var positions = all.filter(function (p) {
      return (Number(p.fees0) || 0) + (Number(p.fees1) || 0) > 1e-12;
    });
    // If fee probes failed earlier, still try every matching position rather than no-op.
    if (!positions.length && all.length) positions = all.slice();
    if (!positions.length) return { kind: 'collect', summary: { count: 0 }, txs: [] };

    var calls = positions.map(function (p) {
      return iNPM.encodeFunctionData('collect', [{
        tokenId: p.id, recipient: walletAddr,
        amount0Max: MAX_UINT128, amount1Max: MAX_UINT128
      }]);
    });

    return {
      kind: 'collect',
      summary: { count: positions.length },
      txs: [{
        label: 'Collect fees from ' + positions.length + ' position' + (positions.length === 1 ? '' : 's') + ' (one transaction)',
        to: CFG.NPM,
        value: '0x0',
        data: iNPM.encodeFunctionData('multicall', [calls])
      }]
    };
  }

  /**
   * Exit LP — decreaseLiquidity (full) + collect for each NFT you own in this pool.
   * Tokens (ETH as WETH + token) return to your wallet. You still own the empty NFT.
   * opts.tokenIds: optional string[] to exit only those positions.
   */
  function planExitPositions(state, walletAddr, opts) {
    opts = opts || {};
    var all = (state.positions && state.positions.list) || [];
    var want = opts.tokenIds
      ? all.filter(function (p) {
          return opts.tokenIds.map(String).indexOf(String(p.id)) >= 0;
        })
      : all.slice();
    var positions = want.filter(function (p) {
      try { return ethers.BigNumber.from(p.liquidity || '0').gt(0); }
      catch (e) { return false; }
    });
    if (!positions.length) {
      return { kind: 'exit', summary: { count: 0, tokenIds: [] }, txs: [] };
    }

    var dl = deadline();
    var calls = [];
    positions.forEach(function (p) {
      var liq = ethers.BigNumber.from(p.liquidity);
      calls.push(iNPM.encodeFunctionData('decreaseLiquidity', [{
        tokenId: p.id,
        liquidity: liq,
        amount0Min: 0,
        amount1Min: 0,
        deadline: dl
      }]));
      calls.push(iNPM.encodeFunctionData('collect', [{
        tokenId: p.id,
        recipient: walletAddr,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128
      }]));
    });

    var ids = positions.map(function (p) { return String(p.id); });
    return {
      kind: 'exit',
      summary: { count: positions.length, tokenIds: ids },
      txs: [{
        label: 'Withdraw LP from ' + positions.length + ' position' + (positions.length === 1 ? '' : 's') +
          ' (#' + ids.join(', #') + ') — tokens back to your wallet',
        to: CFG.NPM,
        value: '0x0',
        data: iNPM.encodeFunctionData('multicall', [calls])
      }]
    };
  }

  // $25 fee payment. Two paths:
  //  a) payWithTokenBalance: direct MCFL transfer (user already holds MCFL)
  //  b) payWithEth: the ETH is deposited as buy-side liquidity in the MCFL pool,
  //     position owned by the treasury. No swap, no price impact — every fee
  //     payment automatically deepens the MCFL book instead of moving it.
  function quoteFeeUsd(provider, ethUsd, usdAmount) {
    var usdIn = usdAmount == null ? CFG.FEE_USD : Number(usdAmount);
    if (!isFinite(usdIn) || usdIn <= 0) throw new Error('Invalid fee amount.');
    // price MCFL from its own pool
    return discoverPool(provider, CFG.MCFL).then(function (info) {
      var pool = new ethers.Contract(info.pool, POOL_ABI, provider);
      return pool.slot0().then(function (s) {
        var pEth = priceOfTokenInEth(s.sqrtPriceX96, info.tokenIsToken1, info.decimals);
        // Security: never invent an ETH price. If the feed is down or returned an
        // insane value, refuse to quote a fee rather than charging a wrong amount.
        var usd = saneUsd(ethUsd);
        if (usd == null) throw new Error('Cannot price the fee right now \u2014 the ETH price feed is unavailable. Try again in a moment.');
        var pUsd = pEth * usd;
        if (!isFinite(pUsd) || pUsd <= 0) throw new Error('This pool has no usable price right now \u2014 refusing to quote a fee.');
        var mcflAmountF = usdIn / pUsd;
        var mcflAmount = ethers.utils.parseUnits(mcflAmountF.toFixed(6), info.decimals);
        var ethInF = usdIn / usd; // exact USD of ETH at spot — no impact premium
        var ethIn = ethers.utils.parseEther(ethInF.toFixed(9));
        return {
          info: info,
          tick: s.tick,
          mcflAmount: mcflAmount,
          mcflAmountF: mcflAmountF,
          mcflPriceUsd: pUsd,
          ethIn: ethIn,
          ethInF: parseFloat(ethers.utils.formatEther(ethIn)),
          usdIn: usdIn
        };
      });
    });
  }
  function quoteFee(provider, ethUsd) {
    return quoteFeeUsd(provider, ethUsd, CFG.FEE_USD);
  }

  /** Uniswap v3 packed path: token(20) + fee(3) + token(20) + … */
  function encodeV3Path(tokens, fees) {
    if (!tokens || !fees || tokens.length !== fees.length + 1) {
      throw new Error('Invalid v3 path.');
    }
    var hex = '0x';
    for (var i = 0; i < fees.length; i++) {
      hex += ethers.utils.getAddress(tokens[i]).slice(2).toLowerCase();
      hex += Number(fees[i]).toString(16).padStart(6, '0');
    }
    hex += ethers.utils.getAddress(tokens[tokens.length - 1]).slice(2).toLowerCase();
    return hex;
  }

  function loadTokenMeta(provider, tokenAddr) {
    tokenAddr = ethers.utils.getAddress(tokenAddr);
    var token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
    return Promise.all([
      token.decimals(),
      token.symbol(),
      token.name().catch(function () { return ''; })
    ]).then(function (r) {
      return {
        address: tokenAddr,
        decimals: r[0],
        symbol: cleanLabel(r[1], 12) || 'TOKEN',
        name: cleanLabel(r[2], 40) || 'Unknown token'
      };
    });
  }

  /** Best Uniswap v3 pool between any two ERC-20s (by tokenA balance in pool). */
  function discoverPairPool(provider, tokenA, tokenB) {
    tokenA = ethers.utils.getAddress(tokenA);
    tokenB = ethers.utils.getAddress(tokenB);
    if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
      return Promise.reject(new Error('Same token on both sides.'));
    }
    var factory = new ethers.Contract(CFG.FACTORY, FACTORY_ABI, provider);
    var a = new ethers.Contract(tokenA, ERC20_ABI, provider);
    return Promise.all(CFG.FEE_TIERS.map(function (fee) {
      return factory.getPool(tokenA, tokenB, fee).then(function (addr) {
        if (addr === ethers.constants.AddressZero) return null;
        return a.balanceOf(addr).then(function (bal) {
          return { fee: fee, address: addr, bal: bal };
        });
      }).catch(function () { return null; });
    })).then(function (pools) {
      pools = pools.filter(Boolean);
      if (!pools.length) return null;
      pools.sort(function (x, y) { return y.bal.gte(x.bal) ? 1 : -1; });
      return pools[0];
    });
  }

  /**
   * Normalize UI side: 'ETH' | 'USDG' | 0x address.
   * Returns { kind, address (WETH for ETH), symbol?, decimals? }.
   */
  function normalizeSwapSide(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s.toUpperCase() === 'ETH' || s.toLowerCase() === CFG.WETH.toLowerCase()) {
      return { kind: 'eth', address: CFG.WETH, symbol: 'ETH', decimals: 18 };
    }
    if (s.toUpperCase() === 'USDG' || s.toLowerCase() === CFG.USDG.toLowerCase()) {
      return { kind: 'usdg', address: CFG.USDG, symbol: 'USDG', decimals: null };
    }
    if (!ethers.utils.isAddress(s)) throw new Error('Invalid token address.');
    var addr = ethers.utils.getAddress(s);
    if (addr.toLowerCase() === CFG.WETH.toLowerCase()) {
      return { kind: 'eth', address: CFG.WETH, symbol: 'ETH', decimals: 18 };
    }
    if (addr.toLowerCase() === CFG.USDG.toLowerCase()) {
      return { kind: 'usdg', address: CFG.USDG, symbol: 'USDG', decimals: null };
    }
    return { kind: 'token', address: addr, symbol: null, decimals: null };
  }

  /**
   * Resolve a route for ETH | USDG | Token triangular desk.
   * - ETH↔* : single hop via WETH pool
   * - USDG↔Token : direct pool if any, else multi-hop via WETH
   */
  function resolveSwapRoute(provider, sideIn, sideOut) {
    if (sideIn.kind === sideOut.kind && sideIn.address.toLowerCase() === sideOut.address.toLowerCase()) {
      return Promise.reject(new Error('Pick two different assets.'));
    }
    if (sideIn.kind === 'token' && sideOut.kind === 'token') {
      return Promise.reject(new Error('Token ↔ token: sell to ETH or USDG first.'));
    }

    function hydrate(side) {
      if (side.decimals != null && side.symbol) return Promise.resolve(side);
      return loadTokenMeta(provider, side.address).then(function (m) {
        return {
          kind: side.kind,
          address: m.address,
          symbol: side.symbol || m.symbol,
          decimals: m.decimals,
          name: m.name
        };
      });
    }

    return Promise.all([hydrate(sideIn), hydrate(sideOut)]).then(function (sides) {
      var a = sides[0], b = sides[1];

      // Single-hop when one leg is ETH (WETH pools).
      if (a.kind === 'eth' || b.kind === 'eth') {
        var other = a.kind === 'eth' ? b : a;
        return discoverPool(provider, other.address).then(function (info) {
          return {
            mode: 'single',
            sideIn: a,
            sideOut: b,
            fee: info.fee,
            info: info,
            pathLabel: a.symbol + ' → ' + b.symbol,
            hops: 1
          };
        });
      }

      // USDG ↔ Token
      return discoverPairPool(provider, a.address, b.address).then(function (direct) {
        if (direct) {
          return {
            mode: 'single',
            sideIn: a,
            sideOut: b,
            fee: direct.fee,
            pool: direct.address,
            info: {
              token: b.kind === 'token' ? b.address : a.address,
              symbol: b.kind === 'token' ? b.symbol : a.symbol,
              decimals: b.kind === 'token' ? b.decimals : a.decimals,
              fee: direct.fee,
              pool: direct.address
            },
            pathLabel: a.symbol + ' → ' + b.symbol,
            hops: 1
          };
        }
        // Multi-hop via WETH: need both WETH pools.
        return Promise.all([
          discoverPool(provider, CFG.USDG),
          discoverPool(provider, a.kind === 'token' ? a.address : b.address)
        ]).then(function (r) {
          var usdgPool = r[0];
          var tokPool = r[1];
          var tokSide = a.kind === 'token' ? a : b;
          var tokens, fees;
          if (a.kind === 'usdg') {
            tokens = [CFG.USDG, CFG.WETH, tokSide.address];
            fees = [usdgPool.fee, tokPool.fee];
          } else {
            tokens = [tokSide.address, CFG.WETH, CFG.USDG];
            fees = [tokPool.fee, usdgPool.fee];
          }
          return {
            mode: 'multi',
            sideIn: a,
            sideOut: b,
            tokens: tokens,
            fees: fees,
            path: encodeV3Path(tokens, fees),
            info: tokPool,
            usdgFee: usdgPool.fee,
            pathLabel: a.symbol + ' → WETH → ' + b.symbol,
            hops: 2
          };
        });
      });
    });
  }

  // ETH → WETH-only buy wall below spot. recipient owns the NFT.
  // topMult/bottomMult = token price vs spot (e.g. 0.95 → 0.70 = 5%–30% below).
  function buyWallTx(info, tick, ethIn, recipient, label, topMult, bottomMult) {
    if (!recipient || !ethers.utils.isAddress(recipient)) throw new Error('Buy wall needs a recipient.');
    topMult = topMult == null ? 0.95 : topMult;
    bottomMult = bottomMult == null ? 0.70 : bottomMult;
    var sp = info.spacing;
    var offTop = multToTickOffset(topMult, info.tokenIsToken1);
    var offBot = multToTickOffset(bottomMult, info.tokenIsToken1);
    var lo, hi;
    if (info.tokenIsToken1) { // WETH is token0 — bids ABOVE current tick
      lo = alignTick(tick + offTop, sp, true);
      hi = alignTick(tick + offBot, sp, false);
      if (lo <= tick + sp) lo = alignTick(tick + sp + 1, sp, true);
      if (hi <= lo) hi = lo + sp;
    } else {
      lo = alignTick(tick + offBot, sp, true);
      hi = alignTick(tick + offTop, sp, false);
      if (hi >= tick - sp) hi = alignTick(tick - sp - 1, sp, false);
      if (lo >= hi) lo = hi - sp;
    }
    var amount0 = info.tokenIsToken1 ? ethIn : ethers.constants.Zero;
    var amount1 = info.tokenIsToken1 ? ethers.constants.Zero : ethIn;
    var mintParams = {
      token0: info.token0, token1: info.token1, fee: info.fee,
      tickLower: lo, tickUpper: hi,
      amount0Desired: amount0, amount1Desired: amount1,
      amount0Min: 0, amount1Min: 0,
      recipient: recipient, deadline: deadline()
    };
    return {
      label: label || ('ETH → buy-side LP'),
      to: CFG.NPM,
      value: ethIn.toHexString(),
      data: iNPM.encodeFunctionData('mint', [mintParams]),
      mintParams: mintParams,
      range: [lo, hi],
      kind: 'buywall',
      topMult: topMult,
      bottomMult: bottomMult
    };
  }

  /** Token-only sell wall ABOVE spot (5%–30% by default). Fills when buyers lift offers. */
  function sellWallTx(info, tick, tokenAmt, recipient, label, nearMult, farMult) {
    if (!recipient || !ethers.utils.isAddress(recipient)) throw new Error('Sell wall needs a recipient.');
    if (!tokenAmt || !tokenAmt.gt || !tokenAmt.gt(0)) throw new Error('Sell wall needs token amount.');
    nearMult = nearMult == null ? 1.05 : nearMult;
    farMult = farMult == null ? 1.30 : farMult;
    var sp = info.spacing;
    var offNear = multToTickOffset(nearMult, info.tokenIsToken1);
    var offFar = multToTickOffset(farMult, info.tokenIsToken1);
    var lo, hi;
    if (info.tokenIsToken1) {
      // Higher token price → lower tick. Range entirely below spot tick.
      hi = alignTick(tick + offNear, sp, false);
      lo = alignTick(tick + offFar, sp, true);
      if (hi >= tick - sp) hi = alignTick(tick - sp - 1, sp, false);
      if (lo >= hi) lo = hi - sp;
    } else {
      // Higher token price → higher tick. Range entirely above spot.
      lo = alignTick(tick + offNear, sp, true);
      hi = alignTick(tick + offFar, sp, false);
      if (lo <= tick + sp) lo = alignTick(tick + sp + 1, sp, true);
      if (hi <= lo) hi = lo + sp;
    }
    var amount0 = info.tokenIsToken1 ? ethers.constants.Zero : tokenAmt;
    var amount1 = info.tokenIsToken1 ? tokenAmt : ethers.constants.Zero;
    var mintParams = {
      token0: info.token0, token1: info.token1, fee: info.fee,
      tickLower: lo, tickUpper: hi,
      amount0Desired: amount0, amount1Desired: amount1,
      amount0Min: 0, amount1Min: 0,
      recipient: recipient, deadline: deadline()
    };
    return {
      label: label || ('Token → sell-side LP'),
      to: CFG.NPM,
      value: '0x0',
      data: iNPM.encodeFunctionData('mint', [mintParams]),
      mintParams: mintParams,
      range: [lo, hi],
      kind: 'sellwall',
      nearMult: nearMult,
      farMult: farMult
    };
  }

  /** Auto ladder: 3 buy-wall bands so one dump cannot fill 100% at one print. */
  var SEAT_BUY_LADDER = [
    { top: 0.95, bot: 0.88, weight: 0.34 },
    { top: 0.88, bot: 0.78, weight: 0.33 },
    { top: 0.78, bot: 0.62, weight: 0.33 }
  ];

  function ladderBuyWallTxs(info, tick, ethIn, recipient, usdLabel) {
    var txs = [];
    var ranges = [];
    var remaining = ethIn;
    SEAT_BUY_LADDER.forEach(function (band, i) {
      var slice = i === SEAT_BUY_LADDER.length - 1
        ? remaining
        : ethIn.mul(Math.round(band.weight * 1000)).div(1000);
      if (slice.gt(remaining)) slice = remaining;
      remaining = remaining.sub(slice);
      if (!slice.gt(0)) return;
      var tx = buyWallTx(
        info,
        tick,
        slice,
        recipient,
        'Buy wall ' + (i + 1) + '/3 — ' + Math.round(band.bot * 100) + '–' + Math.round(band.top * 100) + '% of spot',
        band.top,
        band.bot
      );
      txs.push(tx);
      ranges.push({ band: i + 1, topMult: band.top, bottomMult: band.bot, range: tx.range, eth: parseFloat(ethers.utils.formatEther(slice)) });
    });
    // Single payable multicall: all mints + refundETH (automatic, one signature for ETH legs)
    var calls = txs.map(function (t) { return t.data; });
    calls.push(iNPM.encodeFunctionData('refundETH', []));
    var bundled = {
      label: 'Seat buy-wall ladder — $' + usdLabel + ' ETH across 3 bands (you own the NFTs)',
      to: CFG.NPM,
      value: ethIn.toHexString(),
      data: iNPM.encodeFunctionData('multicall', [calls]),
      kind: 'buywall-ladder',
      ranges: ranges,
      legs: txs
    };
    return { bundled: bundled, ranges: ranges, legs: txs };
  }

  function treasuryBuyWallTx(info, tick, ethIn, label) {
    var tx = buyWallTx(info, tick, ethIn, CFG.TREASURY, label || 'ETH → MCFL buy-side LP (treasury)');
    // Keep fee path as single mint+refund multicall
    var calls = [
      tx.data,
      iNPM.encodeFunctionData('refundETH', [])
    ];
    return {
      label: tx.label,
      to: CFG.NPM,
      value: ethIn.toHexString(),
      data: iNPM.encodeFunctionData('multicall', [calls]),
      mintParams: tx.mintParams,
      range: tx.range
    };
  }

  /**
   * Partner seat buy-in (automatic protections):
   * - ETH → 3-band buy wall below spot (buys do not spend it; dumps fill → you get MCFL)
   * - Cap/warn vs live pool depth
   * - If wallet holds MCFL (e.g. bridged from Solana), auto-add a sell wall above spot
   * - Never market-buys MCFL on RH to seed the seat (that would empty the thin book)
   *
   * opts: { usdAmount, walletAddr, token?, ethUsd?, dual? } dual default true when MCFL bal > 0
   */
  function planSeatDeposit(provider, opts) {
    opts = opts || {};
    var usd = Number(opts.usdAmount);
    if (!isFinite(usd) || usd <= 0) throw new Error('Enter a buy-in amount in USD.');
    var wallet = opts.walletAddr;
    if (!wallet || !ethers.utils.isAddress(wallet)) throw new Error('Connect a wallet first.');
    var token = (opts.token && ethers.utils.isAddress(opts.token)) ? opts.token : CFG.MCFL;

    var ethUsdP = opts.ethUsd != null
      ? Promise.resolve(Number(opts.ethUsd))
      : fetchEthUsd();

    return ethUsdP.then(function (ethUsd) {
      if (!isFinite(ethUsd) || ethUsd < 100 || ethUsd > 100000) {
        throw new Error('ETH/USD feed unavailable — try again.');
      }
      var ethF = usd / ethUsd;
      if (ethF < 0.0001) throw new Error('Buy-in too small after ETH conversion.');
      var ethIn = ethers.utils.parseEther(ethF.toFixed(8));
      return discoverPool(provider, token).then(function (info) {
        return readState(provider, info, ethUsd).then(function (state) {
          var tokenCtr = new ethers.Contract(info.token, ERC20_ABI, provider);
          return tokenCtr.balanceOf(wallet).then(function (tokenBal) {
            var wethUsd = state.buySideUsd != null ? state.buySideUsd : (state.buySideEth || 0) * ethUsd;
            var tokenUsd = state.sellSideUsd != null ? state.sellSideUsd : 0;
            var tokenBalF = parseFloat(ethers.utils.formatUnits(tokenBal, info.decimals));
            var tokenBalUsd = tokenBalF * (state.priceUsd || 0);

            var warnings = [];
            var advice = [];
            var capped = false;
            var requestedUsd = usd;

            // Hard cap only when deposit would dwarf the book (>2.5× pool ETH, and above $500).
            // Founding $500 seats are allowed even when the pool is thinner — they deepen it.
            var CAP_MULT = 2.5;
            var depthCapUsd = Math.max(500, wethUsd * CAP_MULT);
            var ethForBuy = ethIn;
            var usdEffective = usd;
            if (usd > depthCapUsd + 1) {
              capped = true;
              usdEffective = Math.floor(depthCapUsd);
              ethForBuy = ethers.utils.parseEther((usdEffective / ethUsd).toFixed(8));
              warnings.push(
                'Seat auto-capped to ~$' + usdEffective + ' (≤ live pool ETH depth ~$' +
                Math.round(wethUsd) + '). Rest would over-concentrate dump risk.'
              );
            }

            if (tokenUsd < Math.max(50, usdEffective * 0.25)) {
              warnings.push(
                'Sell-side is thin (~$' + Math.round(tokenUsd) + ' MCFL in pool). A small buy can clear most offers. Bridge MCFL from Solana (LayerZero OFT /poolpilot.xyz/mcfl) — do not market-buy on RH to seed.'
              );
            }
            if (usdEffective > wethUsd * 0.75) {
              advice.push(
                'Your seat is a large share of pool ETH. The 3-band ladder spreads dump fills; withdraw anytime.'
              );
            }
            advice.push('Buys do not spend your buy wall. Dumps fill it — you receive MCFL.');
            advice.push('Exit: open your NFT positions on the position manager and decrease liquidity anytime — you own them.');

            var wantDual = opts.dual !== false && tokenBalUsd >= 25;
            var txs = [];
            var dual = null;

            if (wantDual) {
              var targetTokenUsd = Math.min(tokenBalUsd, usdEffective);
              var tokenAmtF = targetTokenUsd / (state.priceUsd || 1);
              if (tokenAmtF > tokenBalF) tokenAmtF = tokenBalF;
              var tokenAmt = ethers.utils.parseUnits(
                tokenAmtF.toFixed(Math.min(info.decimals, 8)),
                info.decimals
              );
              if (tokenAmt.gt(0)) {
                txs.push({
                  label: 'Approve ' + (info.symbol || 'TOKEN') + ' for sell-wall mint',
                  to: info.token,
                  value: '0x0',
                  data: iERC20.encodeFunctionData('approve', [CFG.NPM, tokenAmt])
                });
                var sell = sellWallTx(
                  info,
                  state.tick,
                  tokenAmt,
                  wallet,
                  'Sell wall — your ' + (info.symbol || 'TOKEN') + ' above spot (deepens offers)'
                );
                txs.push(sell);
                dual = {
                  tokenAmtF: parseFloat(ethers.utils.formatUnits(tokenAmt, info.decimals)),
                  tokenUsd: targetTokenUsd,
                  range: sell.range
                };
                advice.push('Detected ' + (info.symbol || 'TOKEN') + ' in wallet — auto-added a sell wall above spot so both sides deepen.');
              }
            } else if (tokenUsd < 100) {
              advice.push(
                'To deepen both sides: bridge MCFL from Solana at /mcfl, then buy the seat again — we auto-mint a sell wall. Do not buy MCFL on RH just to LP.'
              );
            }

            var ladder = ladderBuyWallTxs(info, state.tick, ethForBuy, wallet, usdEffective.toFixed(0));
            txs.push(ladder.bundled);

            return {
              kind: 'seat',
              mode: dual ? 'dual-ladder' : 'buywall-ladder',
              usd: usdEffective,
              usdRequested: requestedUsd,
              capped: capped,
              ethUsd: ethUsd,
              ethIn: ethForBuy,
              ethInF: parseFloat(ethers.utils.formatEther(ethForBuy)),
              token: token.toLowerCase(),
              symbol: info.symbol || 'TOKEN',
              pool: info.pool,
              tick: state.tick,
              range: ladder.ranges[0] && ladder.ranges[0].range,
              ranges: ladder.ranges,
              dual: dual,
              wallet: wallet.toLowerCase(),
              txs: txs,
              explorerPool: CFG.EXPLORER + '/address/' + info.pool,
              explorerNpm: CFG.EXPLORER + '/address/' + CFG.NPM,
              explorerPositions: CFG.EXPLORER + '/address/' + wallet + '#nft_transfers',
              protections: {
                ladderBands: SEAT_BUY_LADDER.length,
                belowSpotBuyWall: true,
                dualSellWall: Boolean(dual),
                neverMarketBuyToSeed: true,
                depthCapUsd: depthCapUsd,
                capped: capped,
                pool: {
                  wethUsd: wethUsd,
                  tokenUsd: tokenUsd,
                  mcflInPool: state.sellSideTokens
                },
                warnings: warnings,
                advice: advice
              }
            };
          });
        });
      });
    });
  }

  /**
   * ETH skim LP share: 10000 while buy-side depth is still bootstrapping;
   * otherwise SWAP_FEE_LP_SHARE_BPS. Pure helper for tests + planFeeSwap.
   */
  function resolveEthFeeLpShareBps(buySideUsd) {
    var threshold = Number(CFG.SWAP_FEE_BOOTSTRAP_BUY_USD);
    if (!isFinite(threshold) || threshold < 0) threshold = 10000;
    var bootstrap = threshold > 0 && (buySideUsd == null || !isFinite(buySideUsd) || buySideUsd < threshold);
    if (bootstrap) return { lpShareBps: 10000, bootstrap: true, buySideUsd: buySideUsd, thresholdUsd: threshold };
    var bps = Number(CFG.SWAP_FEE_LP_SHARE_BPS);
    if (!isFinite(bps) || bps < 0) bps = 7000;
    if (bps > 10000) bps = 10000;
    return { lpShareBps: bps, bootstrap: false, buySideUsd: buySideUsd, thresholdUsd: threshold };
  }

  /**
   * Fee swap — ETH | USDG | Token triangular desk.
   * Skims SWAP_FEE_BPS of amountIn before the Uniswap hop. User signs every tx.
   *
   * When opts.partnerWallet is a seat holder address (from attributed ref):
   *   Full skim transfers to that wallet (ETH value or ERC-20) — automatic, no claim.
   * Otherwise ETH skim (quiet, same Swap button):
   *   Bootstrap (MCFL pool buy-side ETH USD < SWAP_FEE_BOOTSTRAP_BUY_USD):
   *     100% → treasury-owned MCFL buy-wall LP (strengthen the book; no quiet buy)
   *   After bootstrap:
   *     1) SWAP_FEE_LP_SHARE_BPS → buy-wall LP
   *     2) remainder → ETH→MCFL buy to TREASURY
   * Dust legs are folded into the other path; total failure falls back to ETH transfer.
   * Non-ETH skims still transfer the input asset to treasury (or partner when set).
   *
   * tokenIn / tokenOut: 'ETH' | 'USDG' | 0x address.
   */
  function planFeeSwap(provider, opts) {
    var slipBps = opts.slippageBps == null ? 100 : Number(opts.slippageBps); // 1%
    var feeBps = opts.feeBps == null ? CFG.SWAP_FEE_BPS : Number(opts.feeBps);
    if (!isFinite(feeBps) || feeBps < 0 || feeBps > 500) throw new Error('Invalid swap fee.');
    if (!isFinite(slipBps) || slipBps < 10 || slipBps > 2000) throw new Error('Invalid slippage.');

    var amountInF = Number(opts.amountIn);
    if (!isFinite(amountInF) || amountInF <= 0) throw new Error('Enter an amount to swap.');

    var partnerWallet = null;
    if (opts.partnerWallet && ethers.utils.isAddress(opts.partnerWallet)) {
      partnerWallet = ethers.utils.getAddress(opts.partnerWallet);
      if (partnerWallet.toLowerCase() === CFG.TREASURY.toLowerCase()) partnerWallet = null;
    }

    var sideIn = normalizeSwapSide(opts.tokenIn);
    var sideOut = normalizeSwapSide(opts.tokenOut);

    return resolveSwapRoute(provider, sideIn, sideOut).then(function (route) {
      var a = route.sideIn;
      var b = route.sideOut;
      var decIn = a.decimals;
      var decOut = b.decimals;
      var amountIn = ethers.utils.parseUnits(amountInF.toFixed(Math.min(decIn, 8)), decIn);
      var feeAmt = amountIn.mul(feeBps).div(10000);
      var swapIn = amountIn.sub(feeAmt);
      if (swapIn.lte(0)) throw new Error('Amount too small after fee.');

      var quoter = new ethers.Contract(CFG.QUOTER_V2, QUOTER_ABI, provider);
      var quoteP;
      if (route.mode === 'multi') {
        quoteP = quoter.callStatic.quoteExactInput(route.path, swapIn);
      } else {
        quoteP = quoter.callStatic.quoteExactInputSingle({
          tokenIn: a.address,
          tokenOut: b.address,
          amountIn: swapIn,
          fee: route.fee,
          sqrtPriceLimitX96: 0
        });
      }

      return quoteP.then(function (q) {
        var amountOut = q.amountOut || q[0];
        var minOut = amountOut.mul(10000 - slipBps).div(10000);
        var feeF = parseFloat(ethers.utils.formatUnits(feeAmt, decIn));
        var swapInF = parseFloat(ethers.utils.formatUnits(swapIn, decIn));
        var outF = parseFloat(ethers.utils.formatUnits(amountOut, decOut));
        var inIsEth = a.kind === 'eth';
        var outIsEth = b.kind === 'eth';
        var inIsUsdg = a.kind === 'usdg';
        var outIsUsdg = b.kind === 'usdg';
        var dust = ethers.BigNumber.from(CFG.SWAP_FEE_DUST_WEI);

        /** Split ETH skim → buy-wall LP (+ quiet MCFL buy only after bootstrap). Skip when partner takes skim. */
        var feeSplitP = Promise.resolve(null);
        if (inIsEth && feeAmt.gt(0) && !partnerWallet) {
          feeSplitP = Promise.all([
            discoverPool(provider, CFG.MCFL),
            fetchEthUsd()
          ]).then(function (pair) {
            var mcflInfo = pair[0];
            var ethUsd = pair[1];
            var pool = new ethers.Contract(mcflInfo.pool, POOL_ABI, provider);
            var weth = new ethers.Contract(CFG.WETH, ERC20_ABI, provider);
            return Promise.all([pool.slot0(), weth.balanceOf(mcflInfo.pool)]).then(function (pr) {
              var s0 = pr[0];
              var wethBal = parseFloat(ethers.utils.formatEther(pr[1]));
              var buySideUsd = ethUsd != null ? wethBal * ethUsd : null;
              var share = resolveEthFeeLpShareBps(buySideUsd);
              var lpShareBps = share.lpShareBps;
              var lpEth = feeAmt.mul(lpShareBps).div(10000);
              var buyEth = feeAmt.sub(lpEth);
              if (lpEth.gt(0) && lpEth.lt(dust)) {
                buyEth = buyEth.add(lpEth);
                lpEth = ethers.constants.Zero;
              }
              if (buyEth.gt(0) && buyEth.lt(dust)) {
                lpEth = lpEth.add(buyEth);
                buyEth = ethers.constants.Zero;
              }

              var buyP = Promise.resolve(null);
              if (buyEth.gt(0)) {
                buyP = quoter.callStatic.quoteExactInputSingle({
                  tokenIn: CFG.WETH,
                  tokenOut: CFG.MCFL,
                  amountIn: buyEth,
                  fee: mcflInfo.fee,
                  sqrtPriceLimitX96: 0
                }).then(function (fq) {
                  var feeOut = fq.amountOut || fq[0];
                  if (!feeOut || feeOut.lte(0)) return null;
                  return {
                    ethIn: buyEth,
                    ethInF: parseFloat(ethers.utils.formatEther(buyEth)),
                    amountOut: feeOut,
                    amountOutF: parseFloat(ethers.utils.formatUnits(feeOut, mcflInfo.decimals)),
                    minOut: feeOut.mul(95).div(100),
                    fee: mcflInfo.fee
                  };
                }).catch(function () { return null; });
              }

              return buyP.then(function (feeBuyMcfl) {
                // If MCFL buy quote failed, fold that ETH back into the LP leg.
                if (buyEth.gt(0) && !feeBuyMcfl) {
                  lpEth = lpEth.add(buyEth);
                  buyEth = ethers.constants.Zero;
                }
                var feeLp = null;
                if (lpEth.gt(0)) {
                  feeLp = {
                    ethIn: lpEth,
                    ethInF: parseFloat(ethers.utils.formatEther(lpEth)),
                    info: mcflInfo,
                    tick: s0.tick
                  };
                }
                if (!feeLp && !feeBuyMcfl) return null;
                return {
                  feeLp: feeLp,
                  feeBuyMcfl: feeBuyMcfl,
                  feeBootstrap: share.bootstrap,
                  feeLpShareBps: lpShareBps,
                  feeBuySideUsd: buySideUsd
                };
              });
            });
          }).catch(function () { return null; });
        }

        return feeSplitP.then(function (feeSplit) {
          var feeLp = feeSplit && feeSplit.feeLp;
          var feeBuyMcfl = feeSplit && feeSplit.feeBuyMcfl;
          return {
            info: route.info,
            route: route,
            feeBps: feeBps,
            feeAmt: feeAmt,
            feeF: feeF,
            feeToPartner: !!partnerWallet,
            feeRecipient: partnerWallet || CFG.TREASURY,
            partnerWallet: partnerWallet,
            feeBuysMcfl: !!(feeBuyMcfl && feeBuyMcfl.amountOut),
            feeMcflOutF: feeBuyMcfl ? feeBuyMcfl.amountOutF : null,
            feeLpsEth: !!(feeLp && feeLp.ethIn),
            feeLpEthF: feeLp ? feeLp.ethInF : null,
            feeBootstrap: !!(feeSplit && feeSplit.feeBootstrap),
            feeLpShareBps: feeSplit ? feeSplit.feeLpShareBps : null,
            feeBuySideUsd: feeSplit ? feeSplit.feeBuySideUsd : null,
            amountIn: amountIn,
            amountInF: amountInF,
            swapIn: swapIn,
            swapInF: swapInF,
            amountOut: amountOut,
            amountOutF: outF,
            minOut: minOut,
            inIsEth: inIsEth,
            outIsEth: outIsEth,
            inIsUsdg: inIsUsdg,
            outIsUsdg: outIsUsdg,
            symbolIn: a.symbol,
            symbolOut: b.symbol,
            decimalsIn: decIn,
            decimalsOut: decOut,
            tokenInAddr: a.address,
            tokenOutAddr: b.address,
            pathLabel: route.pathLabel,
            hops: route.hops,
            buildTxs: function (recipient) {
              if (!recipient || !ethers.utils.isAddress(recipient)) throw new Error('Connect a wallet first.');
              var txs = [];
              var feeSym = a.symbol;
              var feeLabelNum = inIsEth
                ? feeF.toFixed(6)
                : feeF.toLocaleString(undefined, { maximumFractionDigits: Math.min(decIn, 6) });

              if (feeAmt.gt(0)) {
                if (partnerWallet) {
                  if (inIsEth) {
                    txs.push({
                      label: 'Partner skim ' + feeLabelNum + ' ETH → seat',
                      to: partnerWallet,
                      value: feeAmt.toHexString(),
                      data: '0x',
                      partnerFee: true
                    });
                  } else {
                    txs.push({
                      label: 'Partner skim ' + feeLabelNum + ' ' + feeSym + ' → seat',
                      to: a.address,
                      value: '0x0',
                      data: iERC20.encodeFunctionData('transfer', [partnerWallet, feeAmt]),
                      partnerFee: true
                    });
                  }
                } else if (inIsEth && (feeLp || feeBuyMcfl)) {
                  if (feeLp) {
                    txs.push(treasuryBuyWallTx(
                      feeLp.info,
                      feeLp.tick,
                      feeLp.ethIn,
                      (feeSplit && feeSplit.feeBootstrap
                        ? 'Protocol fee ' + feeLp.ethInF.toFixed(6) + ' ETH → MCFL buy wall (bootstrap)'
                        : 'Protocol fee ' + feeLp.ethInF.toFixed(6) + ' ETH → MCFL buy wall')
                    ));
                  }
                  if (feeBuyMcfl) {
                    txs.push({
                      label: 'Protocol fee ' + feeBuyMcfl.ethInF.toFixed(6) + ' ETH → desk',
                      to: CFG.ROUTER02,
                      value: feeBuyMcfl.ethIn.toHexString(),
                      data: iRouter.encodeFunctionData('exactInputSingle', [{
                        tokenIn: CFG.WETH,
                        tokenOut: CFG.MCFL,
                        fee: feeBuyMcfl.fee,
                        recipient: CFG.TREASURY,
                        amountIn: feeBuyMcfl.ethIn,
                        amountOutMinimum: feeBuyMcfl.minOut,
                        sqrtPriceLimitX96: 0
                      }])
                    });
                  }
                } else if (inIsEth) {
                  txs.push({
                    label: 'Protocol fee ' + feeLabelNum + ' ETH → treasury',
                    to: CFG.TREASURY,
                    value: feeAmt.toHexString(),
                    data: '0x'
                  });
                } else {
                  txs.push({
                    label: 'Protocol fee ' + feeLabelNum + ' ' + feeSym + ' → treasury',
                    to: a.address,
                    value: '0x0',
                    data: iERC20.encodeFunctionData('transfer', [CFG.TREASURY, feeAmt])
                  });
                }
              }

              if (!inIsEth) {
                txs.push({
                  label: 'Approve ' + feeSym + ' for Uniswap router',
                  to: a.address,
                  value: '0x0',
                  data: iERC20.encodeFunctionData('approve', [CFG.ROUTER02, swapIn])
                });
              }

              var swapValue = inIsEth ? swapIn.toHexString() : '0x0';
              var routeNote = route.hops > 1 ? ' (' + route.pathLabel + ')' : '';

              if (route.mode === 'multi') {
                var multiRecipient = outIsEth ? CFG.ROUTER02 : recipient;
                var multiParams = {
                  path: route.path,
                  recipient: multiRecipient,
                  amountIn: swapIn,
                  amountOutMinimum: minOut
                };
                var multiData = iRouter.encodeFunctionData('exactInput', [multiParams]);
                if (outIsEth) {
                  var unwrapMulti = iRouter.encodeFunctionData('unwrapWETH9', [minOut, recipient]);
                  txs.push({
                    label: 'Swap ' + feeSym + ' → ETH' + routeNote,
                    to: CFG.ROUTER02,
                    value: swapValue,
                    data: iRouter.encodeFunctionData('multicall', [[multiData, unwrapMulti]])
                  });
                } else {
                  txs.push({
                    label: 'Swap ' + swapInF.toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + feeSym + ' → ' + b.symbol + routeNote,
                    to: CFG.ROUTER02,
                    value: swapValue,
                    data: multiData
                  });
                }
              } else if (outIsEth) {
                var sellParams = {
                  tokenIn: a.address,
                  tokenOut: CFG.WETH,
                  fee: route.fee,
                  recipient: CFG.ROUTER02,
                  amountIn: swapIn,
                  amountOutMinimum: minOut,
                  sqrtPriceLimitX96: 0
                };
                var swapData = iRouter.encodeFunctionData('exactInputSingle', [sellParams]);
                var unwrapData = iRouter.encodeFunctionData('unwrapWETH9', [minOut, recipient]);
                txs.push({
                  label: 'Swap ' + feeSym + ' → ETH',
                  to: CFG.ROUTER02,
                  value: swapValue,
                  data: iRouter.encodeFunctionData('multicall', [[swapData, unwrapData]])
                });
              } else {
                var buyParams = {
                  tokenIn: a.address,
                  tokenOut: b.address,
                  fee: route.fee,
                  recipient: recipient,
                  amountIn: swapIn,
                  amountOutMinimum: minOut,
                  sqrtPriceLimitX96: 0
                };
                txs.push({
                  label: 'Swap ' + (inIsEth ? swapInF.toFixed(6) + ' ETH' : swapInF.toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + feeSym) + ' → ' + b.symbol,
                  to: CFG.ROUTER02,
                  value: swapValue,
                  data: iRouter.encodeFunctionData('exactInputSingle', [buyParams])
                });
              }
              return txs;
            }
          };
        });
      });
    });
  }

  // Build an ETH → MCFL swap via SwapRouter02 (user signs; we never custody).
  function planBuyMcfl(provider, ethAmountF) {
    var ethInF = Number(ethAmountF);
    if (!isFinite(ethInF) || ethInF <= 0) throw new Error('Enter how much ETH you want to spend on MCFL.');
    if (ethInF > 50) throw new Error('Cap this buy at 50 ETH per click — split larger buys.');
    var ethIn = ethers.utils.parseEther(ethInF.toFixed(9));
    return discoverPool(provider, CFG.MCFL).then(function (info) {
      var quoter = new ethers.Contract(CFG.QUOTER_V2, QUOTER_ABI, provider);
      return quoter.callStatic.quoteExactInputSingle({
        tokenIn: CFG.WETH,
        tokenOut: CFG.MCFL,
        amountIn: ethIn,
        fee: info.fee,
        sqrtPriceLimitX96: 0
      }).then(function (q) {
        var amountOut = q.amountOut || q[0];
        // 5% floor — thin book; user can bump size carefully
        var minOut = amountOut.mul(95).div(100);
        var params = {
          tokenIn: CFG.WETH,
          tokenOut: CFG.MCFL,
          fee: info.fee,
          recipient: ethers.constants.AddressZero, // filled at sign time with wallet
          deadline: deadline(),
          amountIn: ethIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0
        };
        return {
          info: info,
          ethIn: ethIn,
          ethInF: ethInF,
          amountOut: amountOut,
          amountOutF: parseFloat(ethers.utils.formatUnits(amountOut, info.decimals)),
          minOut: minOut,
          params: params,
          buildTx: function (recipient) {
            var p = Object.assign({}, params, { recipient: recipient, deadline: deadline() });
            return {
              label: 'Buy MCFL with ' + ethInF.toFixed(5) + ' ETH (Uniswap v3)',
              to: CFG.ROUTER02,
              value: ethIn.toHexString(),
              data: iRouter.encodeFunctionData('exactInputSingle', [p])
            };
          }
        };
      });
    });
  }

  /**
   * $500 featured listing — pay in ETH or USDG; proceeds buy MCFL for treasury.
   * User signs the swap(s); listing API registers after the last hash confirms.
   */
  function planListingPayment(provider, opts) {
    opts = opts || {};
    var usdAmount = opts.usdAmount == null ? 500 : Number(opts.usdAmount);
    if (!isFinite(usdAmount) || usdAmount <= 0) throw new Error('Invalid listing price.');
    var payWith = String(opts.payWith || 'ETH').toUpperCase();
    if (payWith !== 'ETH' && payWith !== 'USDG') {
      throw new Error('Pay with ETH or USDG.');
    }
    var slipBps = opts.slippageBps == null ? 200 : Number(opts.slippageBps); // 2% — listing size
    if (!isFinite(slipBps) || slipBps < 50 || slipBps > 1000) throw new Error('Invalid slippage.');

    var ethUsdP = opts.ethUsd != null
      ? Promise.resolve(opts.ethUsd)
      : fetchEthUsd();

    return ethUsdP.then(function (ethUsd) {
      var usd = saneUsd(ethUsd);
      if (payWith === 'ETH' && usd == null) {
        throw new Error('Cannot price the listing — ETH/USD feed unavailable.');
      }

      var amountInF;
      var sideIn;
      if (payWith === 'ETH') {
        amountInF = usdAmount / usd;
        sideIn = normalizeSwapSide('ETH');
      } else {
        amountInF = usdAmount; // 1 USDG ≈ $1
        sideIn = normalizeSwapSide('USDG');
      }
      var sideOut = normalizeSwapSide(CFG.MCFL);

      return resolveSwapRoute(provider, sideIn, sideOut).then(function (route) {
        var a = route.sideIn;
        var b = route.sideOut;
        var amountIn = ethers.utils.parseUnits(
          amountInF.toFixed(Math.min(a.decimals, payWith === 'ETH' ? 8 : 6)),
          a.decimals
        );
        var quoter = new ethers.Contract(CFG.QUOTER_V2, QUOTER_ABI, provider);
        var quoteP = route.mode === 'multi'
          ? quoter.callStatic.quoteExactInput(route.path, amountIn)
          : quoter.callStatic.quoteExactInputSingle({
              tokenIn: a.address,
              tokenOut: b.address,
              amountIn: amountIn,
              fee: route.fee,
              sqrtPriceLimitX96: 0
            });

        return quoteP.then(function (q) {
          var amountOut = q.amountOut || q[0];
          if (!amountOut || amountOut.lte(0)) {
            throw new Error('No MCFL quote for listing payment — try the other asset.');
          }
          var minOut = amountOut.mul(10000 - slipBps).div(10000);
          var outF = parseFloat(ethers.utils.formatUnits(amountOut, b.decimals));
          var inF = parseFloat(ethers.utils.formatUnits(amountIn, a.decimals));

          return {
            payWith: payWith,
            usdAmount: usdAmount,
            ethUsd: usd,
            amountIn: amountIn,
            amountInF: inF,
            amountOut: amountOut,
            amountOutF: outF,
            minOut: minOut,
            symbolIn: a.symbol,
            symbolOut: b.symbol,
            route: route,
            pathLabel: route.pathLabel,
            buildTxs: function () {
              var txs = [];
              if (payWith === 'USDG') {
                txs.push({
                  label: 'Approve USDG for Uniswap router',
                  to: CFG.USDG,
                  value: '0x0',
                  data: iERC20.encodeFunctionData('approve', [CFG.ROUTER02, amountIn])
                });
              }
              var label =
                'Listing $' + Math.round(usdAmount) + ' — ' +
                (payWith === 'ETH' ? inF.toFixed(5) + ' ETH' : inF.toFixed(2) + ' USDG') +
                ' → buy MCFL for treasury';

              if (route.mode === 'multi') {
                txs.push({
                  label: label + ' (' + route.pathLabel + ')',
                  to: CFG.ROUTER02,
                  value: '0x0',
                  data: iRouter.encodeFunctionData('exactInput', [{
                    path: route.path,
                    recipient: CFG.TREASURY,
                    amountIn: amountIn,
                    amountOutMinimum: minOut
                  }])
                });
              } else {
                txs.push({
                  label: label,
                  to: CFG.ROUTER02,
                  value: payWith === 'ETH' ? amountIn.toHexString() : '0x0',
                  data: iRouter.encodeFunctionData('exactInputSingle', [{
                    tokenIn: a.address,
                    tokenOut: b.address,
                    fee: route.fee,
                    recipient: CFG.TREASURY,
                    amountIn: amountIn,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                  }])
                });
              }
              return txs;
            }
          };
        });
      });
    });
  }
  // ETH fee → treasury-owned buy wall in the MCFL pool (5%–30% below spot).
  function payFeeWithEthTx(quote) {
    return treasuryBuyWallTx(
      quote.info,
      quote.tick,
      quote.ethIn,
      'Pay $' + CFG.FEE_USD + ' fee — your ETH becomes MCFL buy-side liquidity owned by the treasury (no price impact)'
    );
  }
  function payFeeWithMcflTx(quote) {
    var usd = quote.usdIn != null ? quote.usdIn : CFG.FEE_USD;
    return {
      label: 'Pay $' + usd + ' fee — transfer ' + Math.round(quote.mcflAmountF).toLocaleString() + ' MCFL to treasury',
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
      // One-sided plans are only valid while the price stays OUTSIDE the band:
      // token0-only needs tick < lo, token1-only needs tick >= hi.
      if (!bothSides && amount0.gt(0) && tick >= lo) {
        return { ok: false, reason: 'The price moved into your planned band — close this and rebuild the plan so it re-centers on the live price.' };
      }
      if (!bothSides && amount1.gt(0) && tick < hi) {
        return { ok: false, reason: 'The price moved into your planned band — close this and rebuild the plan so it re-centers on the live price.' };
      }
      var m0 = ethers.BigNumber.from(mintParams.amount0Min || 0), m1 = ethers.BigNumber.from(mintParams.amount1Min || 0);
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
    planExitPositions: planExitPositions,
    refreshMintTx: refreshMintTx,
    quoteFee: quoteFee,
    quoteFeeUsd: quoteFeeUsd,
    planBuyMcfl: planBuyMcfl,
    planListingPayment: planListingPayment,
    planFeeSwap: planFeeSwap,
    planSeatDeposit: planSeatDeposit,
    resolveEthFeeLpShareBps: resolveEthFeeLpShareBps,
    buyWallTx: buyWallTx,
    sellWallTx: sellWallTx,
    treasuryBuyWallTx: treasuryBuyWallTx,
    encodeV3Path: encodeV3Path,
    discoverPairPool: discoverPairPool,
    normalizeSwapSide: normalizeSwapSide,
    payFeeWithEthTx: payFeeWithEthTx,
    payFeeWithMcflTx: payFeeWithMcflTx,
    priceOfTokenInEth: priceOfTokenInEth,
    fmtPrice: fmtPrice,
    ifaces: { erc20: iERC20, weth: iWETH, npm: iNPM, router: iRouter }
  };
});
