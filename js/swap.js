/* Pool Pilot fee swap — ETH ↔ token on Robinhood Chain. */
(function () {
  'use strict';
  var L = window.ChainLib;
  var CFG = L.CFG;
  var read = L.getProvider();
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    wallet: { addr: null, provider: null, chainOk: false },
    plan: null,
    busy: false,
    quoteTimer: null
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
    });
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

  function direction() {
    return $('tokenInSel').value === 'ETH' ? 'buy' : 'sell';
  }
  function syncDirectionUi() {
    var buy = direction() === 'buy';
    $('tokenOutSel').value = buy ? 'TOKEN' : 'ETH';
    $('labelIn').textContent = 'You pay';
    $('labelOut').textContent = 'You get';
  }
  function tokenFromUi() {
    return ($('tokenAddr').value || '').trim();
  }

  function scheduleQuote() {
    clearTimeout(S.quoteTimer);
    S.quoteTimer = setTimeout(runQuote, 280);
  }

  function runQuote() {
    showErr('');
    S.plan = null;
    $('amountOut').value = '';
    $('quoteBox').classList.add('hidden');
    $('swapBtn').disabled = true;

    var amt = ($('amountIn').value || '').trim();
    var tok = tokenFromUi();
    if (!amt || !tok) return;
    if (!/^0x[0-9a-fA-F]{40}$/.test(tok)) {
      showErr('Paste a valid token address (0x…).');
      return;
    }

    var buy = direction() === 'buy';
    $('swapBtn').textContent = 'Quoting…';
    L.planFeeSwap(read, {
      tokenIn: buy ? 'ETH' : tok,
      tokenOut: buy ? tok : 'ETH',
      amountIn: amt,
      feeBps: CFG.SWAP_FEE_BPS,
      slippageBps: 100
    }).then(function (plan) {
      S.plan = plan;
      $('amountOut').value = plan.amountOutF >= 1
        ? plan.amountOutF.toLocaleString(undefined, { maximumFractionDigits: 4 })
        : plan.amountOutF.toPrecision(4);
      var feeLabel = plan.inIsEth
        ? plan.feeF.toFixed(6) + ' ETH'
        : plan.feeF.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' ' + plan.info.symbol;
      $('quoteBox').innerHTML =
        '<div class="prow"><span class="k">Pool fee tier</span><span class="v">' + (plan.info.fee / 10000) + '%</span></div>' +
        '<div class="prow"><span class="k">Protocol fee (' + plan.feeBps / 100 + '%)</span><span class="v">' + esc(feeLabel) + '</span></div>' +
        '<div class="prow"><span class="k">Min received</span><span class="v mono">' +
        parseFloat(ethers.utils.formatUnits(plan.minOut, plan.outIsEth ? 18 : plan.info.decimals)).toPrecision(4) +
        ' ' + esc(plan.symbolOut) + '</span></div>';
      $('quoteBox').classList.remove('hidden');
      $('swapBtn').disabled = false;
      $('swapBtn').textContent = S.wallet.addr ? 'Swap' : 'Connect to swap';
    }).catch(function (e) {
      showErr((e && e.message) || e);
      $('swapBtn').textContent = 'Swap';
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

    S.busy = true;
    openModal(
      '<h3>Confirm swap</h3>' +
      '<p class="msub">' + esc(S.plan.symbolIn) + ' → ' + esc(S.plan.symbolOut) + ' · ' + txs.length + ' step' + (txs.length === 1 ? '' : 's') + '</p>' +
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
  $('tokenInSel').addEventListener('change', function () {
    $('tokenOutSel').value = direction() === 'buy' ? 'TOKEN' : 'ETH';
    syncDirectionUi();
    scheduleQuote();
  });
  $('tokenOutSel').addEventListener('change', function () {
    $('tokenInSel').value = $('tokenOutSel').value === 'ETH' ? 'TOKEN' : 'ETH';
    syncDirectionUi();
    scheduleQuote();
  });
  $('flipBtn').addEventListener('click', function () {
    $('tokenInSel').value = direction() === 'buy' ? 'TOKEN' : 'ETH';
    $('tokenOutSel').value = direction() === 'buy' ? 'ETH' : 'TOKEN';
    syncDirectionUi();
    scheduleQuote();
  });
  $('amountIn').addEventListener('input', scheduleQuote);
  $('tokenAddr').addEventListener('input', scheduleQuote);
  Array.prototype.forEach.call(document.querySelectorAll('.chip[data-addr]'), function (c) {
    c.addEventListener('click', function () {
      $('tokenAddr').value = c.getAttribute('data-addr');
      scheduleQuote();
    });
  });
  $('maxBtn').addEventListener('click', function () {
    if (!S.wallet.addr || !S.wallet.provider) { chooseWalletThenConnect(); return; }
    var p = S.wallet.provider;
    if (direction() === 'buy') {
      p.getBalance(S.wallet.addr).then(function (bal) {
        var leave = ethers.utils.parseEther('0.0004');
        var use = bal.gt(leave) ? bal.sub(leave) : ethers.constants.Zero;
        $('amountIn').value = ethers.utils.formatEther(use);
        scheduleQuote();
      });
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

  /* boot from query */
  var q = new URLSearchParams(location.search);
  var out = q.get('out') || q.get('token') || q.get('buy');
  if (out && /^0x[0-9a-fA-F]{40}$/i.test(out)) {
    $('tokenAddr').value = ethers.utils.getAddress(out);
  } else {
    $('tokenAddr').value = CFG.MCFL;
  }
  if ((q.get('side') || '').toLowerCase() === 'sell') {
    $('tokenInSel').value = 'TOKEN';
    $('tokenOutSel').value = 'ETH';
  }
  syncDirectionUi();
  updateWalletBtn();
  scheduleQuote();
})();
