/* Pool Pilot fee swap — ETH | USDG | Token triangular desk on Robinhood Chain. */
(function () {
  'use strict';
  var L = window.ChainLib;
  var PP = window.PoolPilotPartner;
  var CFG = L.CFG;
  var read = L.getProvider();
  var $ = function (id) { return document.getElementById(id); };

  function apiBase() {
    return (PP && PP.apiBase) ? PP.apiBase() : location.origin;
  }

  var S = {
    wallet: { addr: null, provider: null, chainOk: false },
    plan: null,
    busy: false,
    quoteTimer: null,
    ethUsd: null,
    amountMode: 'crypto', // 'crypto' | 'usd'
    tokenUsd: null // last implied USD per 1 token from quote
  };

  var theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  $('themeBtn').addEventListener('click', function () {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
  function explorerTx(h) { return CFG.EXPLORER + '/tx/' + h; }
  function showErr(msg) {
    var b = $('errBanner');
    if (!msg) { b.classList.add('hidden'); b.textContent = ''; return; }
    b.textContent = msg; b.classList.remove('hidden');
  }
  function setWalletUi(kind, label, btn) {
    var st = $('walletStatus');
    st.className = 'wallet-status is-' + (kind || 'off');
    $('walletStatusLabel').textContent = label || 'Not connected';
    if (btn != null) $('walletBtn').textContent = btn;
  }
  function showBanner(html) {
    var b = $('walletBanner');
    if (!html) { b.classList.add('hidden'); b.innerHTML = ''; return; }
    b.innerHTML = html; b.classList.remove('hidden');
  }

  /* -------- wallet (same patterns as app) -------- */
  var CHAIN_HEX = '0x1237';
  var eth = null;
  var eip6963Wallets = [];
  window.addEventListener('eip6963:announceProvider', function (e) {
    var d = e && e.detail;
    if (!d || !d.provider) return;
    for (var i = 0; i < eip6963Wallets.length; i++) {
      if (eip6963Wallets[i].provider === d.provider) return;
    }
    eip6963Wallets.push({ provider: d.provider, name: (d.info && d.info.name) || 'Wallet', rdns: (d.info && d.info.rdns) || '' });
  });
  try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) { /* ignore */ }

  function discoverProviders() {
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) { /* ignore */ }
    var out = [], seen = [];
    function add(provider, name) {
      if (!provider || typeof provider.request !== 'function' || seen.indexOf(provider) !== -1) return;
      seen.push(provider);
      out.push({ provider: provider, name: name || 'Browser wallet' });
    }
    eip6963Wallets.forEach(function (w) { add(w.provider, w.name); });
    var ethereum = window.ethereum;
    if (ethereum) {
      if (ethereum.providers && ethereum.providers.length) ethereum.providers.forEach(function (p) { add(p); });
      else add(ethereum);
    }
    return out;
  }
  function isRobinhood(id) {
    if (id == null) return false;
    if (typeof id === 'number') return id === CFG.CHAIN_ID;
    var s = String(id).toLowerCase();
    if (s === CHAIN_HEX) return true;
    try { return parseInt(s, 16) === CFG.CHAIN_ID || Number(s) === CFG.CHAIN_ID; } catch (e) { return false; }
  }
  function updateWalletBtn() {
    if (!S.wallet.addr) {
      setWalletUi('off', 'Not connected', 'Connect wallet');
      $('walletBtn').setAttribute('aria-pressed', 'false');
      return;
    }
    $('walletBtn').setAttribute('aria-pressed', 'true');
    if (S.wallet.chainOk) setWalletUi('on', 'Connected · RH', short(S.wallet.addr));
    else setWalletUi('warn', 'Wrong network', short(S.wallet.addr));
  }
  function ensureChain(provider) {
    return provider.request({ method: 'eth_chainId' }).then(function (id) {
      if (isRobinhood(id)) return true;
      return provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CHAIN_HEX }]
      }).then(function () { return true; }).catch(function (e) {
        if (e && (e.code === 4902 || (e.message || '').indexOf('Unrecognized chain') !== -1)) {
          return provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: CHAIN_HEX,
              chainName: 'Robinhood Chain',
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: [CFG.RPC],
              blockExplorerUrls: [CFG.EXPLORER]
            }]
          }).then(function () { return true; });
        }
        throw e;
      });
    });
  }
  function bindProvider(provider, addr) {
    eth = provider;
    S.wallet.provider = new ethers.providers.Web3Provider(provider, 'any');
    S.wallet.addr = ethers.utils.getAddress(addr);
    return provider.request({ method: 'eth_chainId' }).then(function (id) {
      S.wallet.chainOk = isRobinhood(id);
      updateWalletBtn();
      if (!S.wallet.chainOk) {
        showBanner('<strong>Wrong network.</strong> Switch to Robinhood Chain (4663). <button class="btn btn-ghost" id="switchRhBtn" type="button">Switch</button>');
        var b = $('switchRhBtn');
        if (b) b.addEventListener('click', function () {
          ensureChain(provider).then(function () {
            S.wallet.chainOk = true; showBanner(''); updateWalletBtn(); scheduleQuote();
          }).catch(function (e) { showErr((e && e.message) || e); });
        });
      } else showBanner('');
      scheduleQuote();
      var PP = window.PoolPilotPartner;
      if (PP && PP.bindRefFromWallet) {
        PP.bindRefFromWallet(S.wallet.addr).then(function () { refreshAttrBanner(); });
      } else refreshAttrBanner();
    });
  }

  function refreshAttrBanner() {
    var el = $('attrBanner');
    if (!el) return;
    var PP = window.PoolPilotPartner;
    var ref = PP && PP.getRef ? PP.getRef() : '';
    if (!ref) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.innerHTML =
      'Attributing to seat <strong class="mono">' + esc(ref) +
      '</strong> — this swap credits their Live field volume. ' +
      '<button type="button" class="btn btn-ghost" id="clearAttrBtn" style="margin-left:8px">Clear</button>';
    el.classList.remove('hidden');
    var c = $('clearAttrBtn');
    if (c) {
      c.addEventListener('click', function () {
        try {
          localStorage.removeItem('pp_ref');
          sessionStorage.removeItem('pp_ref');
        } catch (e) { /* ignore */ }
        refreshAttrBanner();
      });
    }
  }
  function connectWith(provider) {
    return provider.request({ method: 'eth_requestAccounts' }).then(function (accs) {
      if (!accs || !accs[0]) throw new Error('No account returned.');
      return ensureChain(provider).catch(function () { return false; }).then(function () {
        return bindProvider(provider, accs[0]);
      });
    });
  }
  function chooseWalletThenConnect() {
    var list = discoverProviders();
    if (!list.length) {
      showBanner('<strong>No wallet found.</strong> Install MetaMask / Rabby, then refresh.');
      return;
    }
    if (list.length === 1) {
      connectWith(list[0].provider).catch(function (e) { showErr((e && e.message) || e); });
      return;
    }
    openModal(
      '<h3>Choose wallet</h3>' +
      list.map(function (w, i) {
        return '<button class="btn btn-ghost btn-lg" style="width:100%;margin-top:8px" data-wi="' + i + '">' + esc(w.name) + '</button>';
      }).join('') +
      '<button class="btn btn-ghost" id="mClose" style="margin-top:12px;width:100%">Cancel</button>'
    );
    Array.prototype.forEach.call(document.querySelectorAll('[data-wi]'), function (b) {
      b.addEventListener('click', function () {
        closeModal();
        connectWith(list[Number(b.getAttribute('data-wi'))].provider).catch(function (e) { showErr((e && e.message) || e); });
      });
    });
    $('mClose').addEventListener('click', closeModal);
  }
  $('walletBtn').addEventListener('click', function () {
    if (S.wallet.addr) {
      S.wallet = { addr: null, provider: null, chainOk: false };
      eth = null;
      updateWalletBtn();
      showBanner('');
      return;
    }
    chooseWalletThenConnect();
  });

  /* -------- modal / exec -------- */
  function openModal(html) {
    $('modal').innerHTML = html;
    $('overlay').classList.add('open');
  }
  function closeModal() {
    if (S.busy) return;
    $('overlay').classList.remove('open');
    $('modal').innerHTML = '';
  }
  $('overlay').addEventListener('click', function (e) {
    if (e.target === $('overlay') && !S.busy) closeModal();
  });

  /* -------- triangular sides -------- */
  function sideIn() { return $('tokenInSel').value; }
  function sideOut() { return $('tokenOutSel').value; }
  function needsTokenAddr() {
    return sideIn() === 'TOKEN' || sideOut() === 'TOKEN';
  }
  function tokenFromUi() {
    return ($('tokenAddr').value || '').trim();
  }
  function syncTokenPick() {
    var box = $('tokenPick');
    if (!box) return;
    if (needsTokenAddr()) box.classList.remove('hidden');
    else box.classList.add('hidden');
  }
  /** Map UI sides → planFeeSwap args. */
  function mapSides() {
    var a = sideIn(), b = sideOut();
    if (a === b) throw new Error('Pick two different assets.');
    var addr = tokenFromUi();
    function map(side) {
      if (side === 'ETH') return 'ETH';
      if (side === 'USDG') return 'USDG';
      if (!addr) throw new Error('Paste a token address.');
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error('Paste a valid token address (0x…).');
      return addr;
    }
    return { tokenIn: map(a), tokenOut: map(b) };
  }
  /** Prefer a free opposite when user picks the same on both selects. */
  function ensureDistinct(changed) {
    if (sideIn() !== sideOut()) return;
    var free = ['ETH', 'USDG', 'TOKEN'].filter(function (x) { return x !== sideIn(); });
    if (changed === 'in') $('tokenOutSel').value = free[0];
    else $('tokenInSel').value = free[0];
  }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1000) return '$' + Math.round(n).toLocaleString();
    if (n >= 1) return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(4);
    return '$' + n.toPrecision(2);
  }
  function updateUnitBtn() {
    var b = $('unitBtn');
    if (!b) return;
    if (S.amountMode === 'usd') {
      b.textContent = 'Crypto';
      b.setAttribute('aria-pressed', 'true');
      $('amountIn').placeholder = '0.00';
    } else {
      b.textContent = '$ USD';
      b.setAttribute('aria-pressed', 'false');
      $('amountIn').placeholder = '0.0';
    }
  }
  function impliedInUsd(amount) {
    if (!isFinite(amount) || amount <= 0) return null;
    if (sideIn() === 'ETH') return S.ethUsd ? amount * S.ethUsd : null;
    if (sideIn() === 'USDG') return amount; // ~$1
    if (S.tokenUsd != null) return amount * S.tokenUsd;
    return null;
  }
  function estimateOutUsd(plan) {
    if (plan.outIsUsdg) return plan.amountOutF;
    if (plan.outIsEth) return S.ethUsd ? plan.amountOutF * S.ethUsd : null;
    // token out — value ≈ USD spent on swap leg
    if (plan.inIsUsdg) return plan.swapInF;
    if (plan.inIsEth && S.ethUsd) return plan.swapInF * S.ethUsd;
    if (S.tokenUsd != null) return plan.amountInF * S.tokenUsd;
    return null;
  }
  function updateUsdHints() {
    var inEl = $('usdInHint');
    var outEl = $('usdOutHint');
    if (!inEl || !outEl) return;
    var raw = parseFloat(($('amountIn').value || '').replace(/,/g, ''));
    if (!isFinite(raw) || raw <= 0) {
      inEl.textContent = S.amountMode === 'usd' ? 'Enter USD amount' : '≈ $—';
      outEl.textContent = '≈ $—';
      return;
    }
    if (S.amountMode === 'usd') {
      inEl.textContent = 'Paying ≈ ' + fmtUsd(raw);
      outEl.textContent = S.plan ? ('You get ≈ ' + fmtUsd(estimateOutUsd(S.plan))) : '≈ $—';
      return;
    }
    var inU = impliedInUsd(raw);
    inEl.textContent = inU != null ? ('≈ ' + fmtUsd(inU)) : '≈ $—';
    outEl.textContent = S.plan ? ('≈ ' + fmtUsd(estimateOutUsd(S.plan))) : '≈ $—';
  }
  function resolveAmountInCrypto() {
    var raw = ($('amountIn').value || '').trim().replace(/,/g, '');
    var n = parseFloat(raw);
    if (!isFinite(n) || n <= 0) return null;
    if (S.amountMode !== 'usd') return String(n);

    if (sideIn() === 'ETH') {
      if (!S.ethUsd) throw new Error('ETH/USD price unavailable — try again or enter ETH amount.');
      return (n / S.ethUsd).toFixed(8);
    }
    if (sideIn() === 'USDG') {
      return n.toFixed(6); // 1 USDG ≈ $1
    }
    if (S.tokenUsd == null || S.tokenUsd <= 0) {
      throw new Error('Pick a token and wait for a quote first, then enter USD — or switch to crypto units.');
    }
    return (n / S.tokenUsd).toFixed(6);
  }

  function chipListForSwap(routeExtra) {
    var T = window.PoolPilotTokens;
    var all = (window.RH_TOKENS || []).filter(function (t) {
      return (t.address || '').toLowerCase() !== CFG.USDG.toLowerCase();
    });
    var mcfl = all.filter(function (t) { return String(t.symbol).toUpperCase() === 'MCFL'; });
    var rest = all.filter(function (t) { return String(t.symbol).toUpperCase() !== 'MCFL'; });
    var route = (routeExtra || []).map(function (c) {
      return {
        symbol: c.symbol,
        address: c.address,
        iconUrl: c.iconUrl || '',
        routeOnly: true,
        community: true
      };
    });
    var seen = Object.create(null);
    var out = [];
    function add(t) {
      if (!t || !t.address) return;
      var k = String(t.address).toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(t);
    }
    mcfl.forEach(add);
    route.forEach(add);
    rest.forEach(add);
    return out;
  }

  function loadRouteChips() {
    var ref = PP && PP.getRef ? PP.getRef() : '';
    if (!ref || ref === 'poolpilot') return Promise.resolve([]);
    return fetch(apiBase() + '/api/route-chips?ref=' + encodeURIComponent(ref), {
      headers: { Accept: 'application/json' },
      mode: 'cors'
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.chips)) return [];
        return j.chips;
      })
      .catch(function () { return []; });
  }

  function renderTokenChips(routeExtra) {
    var box = $('tokenChips');
    if (!box) return;
    var T = window.PoolPilotTokens;
    var list = chipListForSwap(routeExtra);
    box.innerHTML = list.map(function (t) {
      if (T && T.chipHtml) {
        if (t.routeOnly) {
          return T.chipHtml(t, { route: true });
        }
        return T.chipHtml(t);
      }
      return '<button type="button" class="chip" data-addr="' + t.address + '" data-sym="' + esc(t.symbol) + '">' + esc(t.symbol) + '</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (c) {
      c.addEventListener('click', function () {
        try {
          $('tokenAddr').value = ethers.utils.getAddress(c.getAttribute('data-addr'));
        } catch (e) {
          $('tokenAddr').value = c.getAttribute('data-addr');
        }
        if (sideIn() !== 'TOKEN' && sideOut() !== 'TOKEN') {
          $('tokenOutSel').value = 'TOKEN';
          ensureDistinct('out');
        }
        highlightChip();
        updateTokenConfirm();
        syncTokenPick();
        scheduleQuote();
      });
    });
    highlightChip();
  }

  function updateTokenConfirm() {
    var slot = $('tokenConfirm');
    if (!slot || !window.PoolPilotTokens) return;
    var t = window.PoolPilotTokens.byAddress($('tokenAddr').value);
    if (!t) {
      slot.hidden = true;
      slot.innerHTML = '';
      return;
    }
    slot.hidden = false;
    slot.innerHTML = window.PoolPilotTokens.confirmHtml(t);
    var btn = slot.querySelector('[data-addr]');
    if (btn) {
      btn.addEventListener('click', function () {
        try {
          $('tokenAddr').value = ethers.utils.getAddress(btn.getAttribute('data-addr'));
        } catch (e) {
          $('tokenAddr').value = btn.getAttribute('data-addr');
        }
        if (sideIn() !== 'TOKEN' && sideOut() !== 'TOKEN') {
          $('tokenOutSel').value = 'TOKEN';
          ensureDistinct('out');
        }
        highlightChip();
        syncTokenPick();
        scheduleQuote();
      });
    }
  }
  function highlightChip() {
    var cur = (tokenFromUi() || '').toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll('#tokenChips .chip'), function (c) {
      c.classList.toggle('is-active', (c.getAttribute('data-addr') || '').toLowerCase() === cur);
    });
  }

  function scheduleQuote() {
    clearTimeout(S.quoteTimer);
    S.quoteTimer = setTimeout(runQuote, 280);
    syncTokenPick();
    updateUsdHints();
  }

  function runQuote() {
    showErr('');
    S.plan = null;
    $('amountOut').value = '';
    $('quoteBox').classList.add('hidden');
    $('swapBtn').disabled = true;
    updateUsdHints();

    var sides;
    try { sides = mapSides(); }
    catch (e) {
      // Incomplete form (no token yet) — silent until user fills
      if (/token address/i.test((e && e.message) || '')) return;
      showErr((e && e.message) || e);
      return;
    }

    var cryptoAmt;
    try { cryptoAmt = resolveAmountInCrypto(); }
    catch (e) { showErr((e && e.message) || e); return; }
    if (!cryptoAmt) return;

    var probeFirst = (S.amountMode === 'usd' && sideIn() === 'TOKEN' && (S.tokenUsd == null || S.tokenUsd <= 0));
    $('swapBtn').textContent = 'Quoting…';

    function quoteWith(amountIn) {
      var args = {
        tokenIn: sides.tokenIn,
        tokenOut: sides.tokenOut,
        amountIn: amountIn,
        feeBps: CFG.SWAP_FEE_BPS,
        slippageBps: 100
      };
      var PP = window.PoolPilotPartner;
      var ref = PP && PP.getRef ? PP.getRef() : '';
      if (!ref || !PP.resolveSeatWallet) return L.planFeeSwap(read, args);
      return PP.resolveSeatWallet(ref).then(function (wallet) {
        if (wallet) args.partnerWallet = wallet;
        return L.planFeeSwap(read, args);
      });
    }

    var start = probeFirst ? quoteWith('1') : quoteWith(cryptoAmt);
    start.then(function (plan) {
      if (probeFirst) {
        if (plan.outIsEth && S.ethUsd && plan.amountOutF > 0) {
          S.tokenUsd = (plan.amountOutF * S.ethUsd) / plan.amountInF;
        } else if (plan.outIsUsdg && plan.amountOutF > 0) {
          S.tokenUsd = plan.amountOutF / plan.amountInF;
        }
        return quoteWith(resolveAmountInCrypto());
      }
      return plan;
    }).then(function (plan) {
      S.plan = plan;
      // Refresh implied token USD
      if (sideIn() === 'TOKEN' || sideOut() === 'TOKEN') {
        if (plan.inIsEth && S.ethUsd && plan.amountOutF > 0 && !plan.outIsEth && !plan.outIsUsdg) {
          S.tokenUsd = (plan.swapInF * S.ethUsd) / plan.amountOutF;
        } else if (plan.outIsEth && S.ethUsd && plan.amountInF > 0 && !plan.inIsEth) {
          S.tokenUsd = (plan.amountOutF * S.ethUsd) / plan.amountInF;
        } else if (plan.inIsUsdg && plan.amountOutF > 0 && !plan.outIsUsdg && !plan.outIsEth) {
          S.tokenUsd = plan.swapInF / plan.amountOutF;
        } else if (plan.outIsUsdg && plan.amountInF > 0 && !plan.inIsUsdg) {
          S.tokenUsd = plan.amountOutF / plan.amountInF;
        }
      }

      $('amountOut').value = plan.amountOutF >= 1
        ? plan.amountOutF.toLocaleString(undefined, { maximumFractionDigits: 4 })
        : plan.amountOutF.toPrecision(4);

      var feeLabel = plan.inIsEth
        ? plan.feeF.toFixed(6) + ' ETH' + (S.ethUsd ? ' (' + fmtUsd(plan.feeF * S.ethUsd) + ')' : '')
        : plan.feeF.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' ' + plan.symbolIn +
          (plan.inIsUsdg ? ' (≈ ' + fmtUsd(plan.feeF) + ')' : '');
      // Quiet: ETH skim → buy-wall LP (100% while bootstrapping) + optional desk MCFL buy.
      // Attributed seat ref → full skim to partner wallet instead.
      if (plan.feeToPartner) feeLabel += ' · → seat';
      else if (plan.feeLpsEth && plan.feeBuysMcfl) feeLabel += ' · LP + desk';
      else if (plan.feeLpsEth && plan.feeBootstrap) feeLabel += ' · LP (bootstrap)';
      else if (plan.feeLpsEth) feeLabel += ' · LP';
      else if (plan.feeBuysMcfl) feeLabel += ' · desk';

      var approx = estimateOutUsd(plan);
      var usdLine = approx != null
        ? '<div class="prow"><span class="k">Approx. value</span><span class="v">' + fmtUsd(approx) +
          (S.ethUsd ? ' · ETH $' + Math.round(S.ethUsd) : '') + '</span></div>'
        : '';

      var tierLine = plan.hops > 1
        ? '<div class="prow"><span class="k">Route</span><span class="v">' + esc(plan.pathLabel) + '</span></div>' +
          '<div class="prow"><span class="k">Hops</span><span class="v">2 via WETH</span></div>'
        : '<div class="prow"><span class="k">Pool fee tier</span><span class="v">' +
          ((plan.info && plan.info.fee) ? (plan.info.fee / 10000) + '%' : '—') + '</span></div>';

      var partnerLine = '';
      if (plan.feeToPartner && plan.partnerWallet) {
        partnerLine =
          '<div class="prow"><span class="k">Seat skim</span><span class="v mono">' +
          esc(plan.partnerWallet.slice(0, 6) + '…' + plan.partnerWallet.slice(-4)) +
          '</span></div>';
      }

      $('quoteBox').innerHTML =
        usdLine +
        tierLine +
        '<div class="prow"><span class="k">Protocol fee (' + plan.feeBps / 100 + '%)</span><span class="v">' + esc(feeLabel) + '</span></div>' +
        partnerLine +
        '<div class="prow"><span class="k">Min received</span><span class="v mono">' +
        parseFloat(ethers.utils.formatUnits(plan.minOut, plan.decimalsOut)).toPrecision(4) +
        ' ' + esc(plan.symbolOut) + '</span></div>';
      $('quoteBox').classList.remove('hidden');
      $('swapBtn').disabled = false;
      $('swapBtn').textContent = S.wallet.addr ? 'Swap' : 'Connect to swap';
      updateUsdHints();
      highlightChip();
    }).catch(function (e) {
      showErr((e && e.message) || e);
      $('swapBtn').textContent = 'Swap';
      updateUsdHints();
    });
  }

  function executeSwap() {
    if (!S.plan) return;
    if (!S.wallet.addr || !S.wallet.provider) {
      chooseWalletThenConnect();
      return;
    }
    if (!S.wallet.chainOk) {
      showErr('Switch to Robinhood Chain (4663) first.');
      return;
    }
    var txs;
    try { txs = S.plan.buildTxs(S.wallet.addr); }
    catch (e) { showErr((e && e.message) || e); return; }

    var usdNote = '';
    var v = estimateOutUsd(S.plan);
    if (v != null) usdNote = ' · ≈ ' + fmtUsd(v);

    S.busy = true;
    openModal(
      '<h3>Confirm swap</h3>' +
      '<p class="msub">' + esc(S.plan.pathLabel || (S.plan.symbolIn + ' → ' + S.plan.symbolOut)) + usdNote +
      ' · ' + txs.length + ' step' + (txs.length === 1 ? '' : 's') + '</p>' +
      '<ol class="steps">' + txs.map(function (t, i) {
        return '<li id="step' + i + '"><span class="dot">○</span> ' + esc(t.label) + '</li>';
      }).join('') + '</ol>' +
      '<div id="execFoot"></div>'
    );

    var signer = S.wallet.provider.getSigner();
    var hashes = [];
    var chain = Promise.resolve();
    txs.forEach(function (t, i) {
      chain = chain.then(function () {
        var el = $('step' + i);
        el.classList.add('active');
        return signer.sendTransaction({ to: t.to, data: t.data || '0x', value: t.value || '0x0' }).then(function (resp) {
          hashes.push(resp.hash);
          el.innerHTML += ' <a href="' + explorerTx(resp.hash) + '" target="_blank" rel="noopener">view</a>';
          return read.waitForTransaction(resp.hash, 1, 180000).then(function (rc) {
            if (!rc || rc.status !== 1) throw new Error('Transaction reverted.');
            el.classList.remove('active');
            el.classList.add('done');
            el.querySelector('.dot').textContent = '✓';
          });
        }).catch(function (e) {
          el.classList.remove('active');
          el.classList.add('fail');
          el.querySelector('.dot').textContent = '✕';
          throw e;
        });
      });
    });

    chain.then(function () {
      S.busy = false;
      try {
        var PP = window.PoolPilotPartner;
        if (PP) {
          var approx = estimateOutUsd(S.plan);
          PP.logEvent({
            kind: 'swap',
            ref: PP.getRef(),
            token: tokenAddr(),
            symbol: (S.plan && S.plan.symbolOut) || '',
            usd: approx != null ? approx : (S.amountMode === 'usd' ? Number($('amountIn').value) : null),
            hash: hashes[hashes.length - 1] || '',
            note: (S.plan && S.plan.pathLabel) || ''
          });
        }
      } catch (e) { /* ignore */ }
      $('execFoot').innerHTML =
        '<div class="banner ok">Done.</div>' +
        '<button class="btn btn-primary btn-lg" id="doneBtn" style="margin-top:12px;width:100%">Close</button>';
      $('doneBtn').addEventListener('click', function () { closeModal(); scheduleQuote(); });
    }).catch(function (e) {
      S.busy = false;
      var msg = (e && (e.reason || e.message)) || String(e);
      $('execFoot').innerHTML =
        '<div class="banner err">' + esc(msg) + '</div>' +
        '<button class="btn btn-ghost btn-lg" id="doneBtn" style="margin-top:12px;width:100%">Close</button>';
      $('doneBtn').addEventListener('click', closeModal);
    });
  }

  /* -------- wire -------- */
  function onSideChange(which) {
    ensureDistinct(which);
    S.tokenUsd = null;
    syncTokenPick();
    scheduleQuote();
  }
  $('tokenInSel').addEventListener('change', function () { onSideChange('in'); });
  $('tokenOutSel').addEventListener('change', function () { onSideChange('out'); });
  $('flipBtn').addEventListener('click', function () {
    var a = sideIn(), b = sideOut();
    $('tokenInSel').value = b;
    $('tokenOutSel').value = a;
    S.tokenUsd = null;
    syncTokenPick();
    scheduleQuote();
  });
  $('unitBtn').addEventListener('click', function () {
    var raw = parseFloat(($('amountIn').value || '').replace(/,/g, ''));
    var wasUsd = S.amountMode === 'usd';
    S.amountMode = wasUsd ? 'crypto' : 'usd';
    updateUnitBtn();
    if (isFinite(raw) && raw > 0) {
      if (!wasUsd) {
        // crypto → USD
        var u = impliedInUsd(raw);
        if (u != null) $('amountIn').value = u.toFixed(2);
      } else {
        // USD → crypto
        if (sideIn() === 'ETH' && S.ethUsd) $('amountIn').value = (raw / S.ethUsd).toFixed(6);
        else if (sideIn() === 'USDG') $('amountIn').value = raw.toFixed(4);
        else if (S.tokenUsd) $('amountIn').value = (raw / S.tokenUsd).toFixed(4);
      }
    }
    scheduleQuote();
  });
  Array.prototype.forEach.call(document.querySelectorAll('#usdPresets [data-usd]'), function (b) {
    b.addEventListener('click', function () {
      S.amountMode = 'usd';
      updateUnitBtn();
      $('amountIn').value = b.getAttribute('data-usd');
      // Prefer cash → token when user taps a dollar preset
      if (sideOut() !== 'TOKEN' && sideIn() !== 'TOKEN') {
        $('tokenOutSel').value = 'TOKEN';
        ensureDistinct('out');
      }
      if (sideIn() === 'TOKEN') {
        $('tokenInSel').value = 'USDG';
        ensureDistinct('in');
      }
      syncTokenPick();
      scheduleQuote();
    });
  });
  $('amountIn').addEventListener('input', scheduleQuote);
  $('tokenAddr').addEventListener('input', function () { S.tokenUsd = null; highlightChip(); updateTokenConfirm(); scheduleQuote(); });
  $('maxBtn').addEventListener('click', function () {
    S.amountMode = 'crypto';
    updateUnitBtn();
    if (!S.wallet.addr || !S.wallet.provider) { chooseWalletThenConnect(); return; }
    var p = S.wallet.provider;
    if (sideIn() === 'ETH') {
      p.getBalance(S.wallet.addr).then(function (bal) {
        var leave = ethers.utils.parseEther('0.0004');
        var use = bal.gt(leave) ? bal.sub(leave) : ethers.constants.Zero;
        $('amountIn').value = ethers.utils.formatEther(use);
        scheduleQuote();
      });
    } else if (sideIn() === 'USDG') {
      var cU = new ethers.Contract(CFG.USDG, ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'], p);
      Promise.all([cU.balanceOf(S.wallet.addr), cU.decimals()]).then(function (r) {
        $('amountIn').value = ethers.utils.formatUnits(r[0], r[1]);
        scheduleQuote();
      }).catch(function (e) { showErr((e && e.message) || e); });
    } else {
      var tok = tokenFromUi();
      if (!/^0x[0-9a-fA-F]{40}$/.test(tok)) { showErr('Paste token address first.'); return; }
      var c = new ethers.Contract(tok, ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'], p);
      Promise.all([c.balanceOf(S.wallet.addr), c.decimals()]).then(function (r) {
        $('amountIn').value = ethers.utils.formatUnits(r[0], r[1]);
        scheduleQuote();
      }).catch(function (e) { showErr((e && e.message) || e); });
    }
  });
  $('swapBtn').addEventListener('click', executeSwap);

  /* ---- Fund desk (path, not custody): Relay ETH → back here → ETH→USDG ---- */
  var FUND_KEY = 'pp_fund_open';
  var RELAY_RH = 'https://relay.link/bridge/robinhood';
  S.fundUsd = 25;

  function setFundOpen(open) {
    var desk = $('fundDesk');
    var tog = $('fundToggle');
    if (!desk || !tog) return;
    desk.classList.toggle('is-collapsed', !open);
    tog.setAttribute('aria-expanded', open ? 'true' : 'false');
    try { sessionStorage.setItem(FUND_KEY, open ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function updateFundRelayHref() {
    var a = $('fundRelayBtn');
    if (!a) return;
    var u = new URL(RELAY_RH);
    u.searchParams.set('fromChainId', '1');
    if (S.ethUsd && S.fundUsd > 0) {
      var eth = S.fundUsd / S.ethUsd;
      if (isFinite(eth) && eth > 0) u.searchParams.set('amount', eth.toFixed(6));
    }
    a.href = u.toString();
  }

  function applyBuyUsdg() {
    $('tokenInSel').value = 'ETH';
    $('tokenOutSel').value = 'USDG';
    ensureDistinct('out');
    S.amountMode = 'usd';
    updateUnitBtn();
    $('amountIn').value = String(S.fundUsd);
    syncTokenPick();
    scheduleQuote();
    var ab = $('arriveBanner');
    if (ab) {
      ab.classList.remove('hidden');
      ab.innerHTML = 'Buying <strong>USDG</strong> with ETH on this desk (~$' + S.fundUsd +
        '). If you still need ETH on Robinhood, use <strong>Bridge ETH to RH</strong> above, keep this tab, then swap.';
    }
    try { $('amountIn').focus(); } catch (e) { /* ignore */ }
  }

  (function initFundDesk() {
    var desk = $('fundDesk');
    if (!desk) return;
    var open = true;
    try {
      var saved = sessionStorage.getItem(FUND_KEY);
      if (saved === '0') open = false;
    } catch (e) { /* ignore */ }
    setFundOpen(open);
    updateFundRelayHref();

    $('fundToggle').addEventListener('click', function () {
      setFundOpen(desk.classList.contains('is-collapsed'));
    });
    Array.prototype.forEach.call(document.querySelectorAll('#fundPresets [data-fund-usd]'), function (b) {
      b.addEventListener('click', function () {
        S.fundUsd = Number(b.getAttribute('data-fund-usd')) || 25;
        Array.prototype.forEach.call(document.querySelectorAll('#fundPresets .chip'), function (c) {
          c.classList.toggle('is-active', c === b);
        });
        updateFundRelayHref();
      });
    });
    if ($('fundUsdgBtn')) {
      $('fundUsdgBtn').addEventListener('click', function () {
        setFundOpen(true);
        applyBuyUsdg();
      });
    }
    if ($('fundRelayBtn')) {
      $('fundRelayBtn').addEventListener('click', function () {
        var ab = $('arriveBanner');
        if (ab) {
          ab.classList.remove('hidden');
          ab.innerHTML = 'Relay opened in a new tab. Keep <strong>this</strong> tab open. When ETH lands on Robinhood (4663), tap <strong>Buy USDG here</strong> — no need to leave the swap desk.';
        }
        setFundOpen(true);
      });
    }
  })();

  /* boot from query */
  if (PP) PP.captureRefFromUrl();
  renderTokenChips([]);
  loadRouteChips().then(function (chips) {
    if (chips && chips.length) renderTokenChips(chips);
  });
  var q = new URLSearchParams(location.search);
  var out = q.get('out') || q.get('token') || q.get('buy');
  var inn = (q.get('in') || '').toLowerCase();
  var outSide = (q.get('to') || q.get('sideOut') || '').toLowerCase();
  var fromRelay = (q.get('from') || '').toLowerCase() === 'relay';
  var fundGoal = (q.get('fund') || q.get('get') || '').toLowerCase();
  var qUsd = q.get('usd') || q.get('amountUsd');

  if (inn === 'usdg') $('tokenInSel').value = 'USDG';
  else if (inn === 'token' || inn === 'erc20') $('tokenInSel').value = 'TOKEN';
  else if (inn === 'eth') $('tokenInSel').value = 'ETH';

  if (outSide === 'usdg') $('tokenOutSel').value = 'USDG';
  else if (outSide === 'eth') $('tokenOutSel').value = 'ETH';
  else if (outSide === 'token') $('tokenOutSel').value = 'TOKEN';

  if (qUsd && isFinite(Number(qUsd)) && Number(qUsd) > 0) {
    S.fundUsd = Math.round(Number(qUsd));
    Array.prototype.forEach.call(document.querySelectorAll('#fundPresets .chip'), function (c) {
      c.classList.toggle('is-active', Number(c.getAttribute('data-fund-usd')) === S.fundUsd);
    });
  }

  if (fundGoal === 'usdg' || fundGoal === 'usd' || outSide === 'usdg') {
    setFundOpen(true);
    applyBuyUsdg();
  }

  if (out && /^0x[0-9a-fA-F]{40}$/i.test(out)) {
    $('tokenAddr').value = ethers.utils.getAddress(out);
    if (sideIn() !== 'TOKEN' && sideOut() !== 'TOKEN') $('tokenOutSel').value = 'TOKEN';
  } else if (!$('tokenAddr').value) {
    $('tokenAddr').value = CFG.MCFL;
  }
  updateTokenConfirm();
  highlightChip();

  if ((q.get('side') || '').toLowerCase() === 'sell') {
    $('tokenInSel').value = 'TOKEN';
    $('tokenOutSel').value = 'ETH';
  }
  if ((q.get('side') || '').toLowerCase() === 'cash') {
    $('tokenInSel').value = 'USDG';
    $('tokenOutSel').value = 'TOKEN';
  }
  ensureDistinct('in');
  if ((q.get('usd') || q.get('amountUsd'))) {
    S.amountMode = 'usd';
    $('amountIn').value = q.get('usd') || q.get('amountUsd');
  }
  if (fromRelay) {
    var ab = $('arriveBanner');
    if (ab) {
      ab.innerHTML = fundGoal === 'usdg' || fundGoal === 'usd' || outSide === 'usdg'
        ? 'Back from Relay — desk set to <strong>ETH → USDG</strong>. Connect on <strong>4663</strong> and swap. Still need ETH? Use <strong>Bridge ETH to RH</strong> in Fund this desk.'
        : 'Back from Relay — desk is prefilled. Connect wallet on <strong>4663</strong> and swap. Need cash? Open <strong>Fund this desk</strong> above for ETH → USDG.';
      ab.classList.remove('hidden');
      setFundOpen(true);
    }
  }
  try {
    var PP0 = window.PoolPilotPartner;
    if (PP0) PP0.captureRefFromUrl();
  } catch (e) { /* ignore */ }
  refreshAttrBanner();
  syncTokenPick();
  updateUnitBtn();
  updateWalletBtn();
  highlightChip();
  updateFundRelayHref();
  L.fetchEthUsd().then(function (u) {
    S.ethUsd = u;
    updateFundRelayHref();
    updateUsdHints();
    scheduleQuote();
  }).catch(function () { scheduleQuote(); });
})();
