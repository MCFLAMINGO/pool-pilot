/* Pool Pilot app — reads via public RPC, writes via the user's own wallet. */
(function () {
  'use strict';
  var L = window.ChainLib;
  var CFG = L.CFG;
  var read = L.getProvider();
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    ethUsd: null,
    info: null,
    state: null,
    wallet: { addr: null, provider: null, chainOk: false },
    receipts: [],
    busy: false
  };

  /* ---------------- theme ---------------- */
  var theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  function applyTheme() { document.documentElement.setAttribute('data-theme', theme); }
  applyTheme();
  $('themeBtn').addEventListener('click', function () {
    theme = theme === 'dark' ? 'light' : 'dark'; applyTheme();
  });

  /* ---------------- helpers ---------------- */
  function fmtUsd(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1000) return '$' + Math.round(n).toLocaleString();
    if (n >= 1) return '$' + n.toFixed(2);
    return '$' + n.toPrecision(2);
  }
  function fmtPct(p) {
    if (p == null) return '—';
    var a = Math.abs(p);
    if (a > 500) return '>500%';
    return (a >= 10 ? a.toFixed(0) : a.toFixed(1)) + '%';
  }
  function fmtTok(n) {
    if (n == null) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function explorerTx(h) { return CFG.EXPLORER + '/tx/' + h; }
  function showErr(msg) {
    var b = $('errBanner');
    if (!msg) { b.classList.add('hidden'); return; }
    b.textContent = msg; b.classList.remove('hidden');
  }
  function priceMultAtTicks(w) { return Math.pow(1.0001, w) - 1; }
  function isOperator() {
    return !!(S.wallet.addr && S.wallet.addr.toLowerCase() === CFG.TREASURY.toLowerCase());
  }

  /* ---------------- wallet ---------------- */
  var CHAIN_HEX = '0x1237';
  var eth = null; // EIP-1193 provider the visitor chose — never a hardcoded default account

  /* EIP-6963 announcements accumulate for the whole session; request on each discover. */
  var eip6963Wallets = [];
  window.addEventListener('eip6963:announceProvider', function (e) {
    var d = e && e.detail;
    if (!d || !d.provider) return;
    for (var i = 0; i < eip6963Wallets.length; i++) {
      if (eip6963Wallets[i].provider === d.provider) return;
    }
    eip6963Wallets.push({
      provider: d.provider,
      name: (d.info && d.info.name) || 'Wallet',
      rdns: (d.info && d.info.rdns) || ''
    });
  });
  try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) { /* ignore */ }

  /* Discover every injected wallet. Do not prefer MetaMask/Rabby — visitors pick. */
  function discoverProviders() {
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) { /* ignore */ }
    var out = [];
    var seen = [];
    function add(provider, name, rdns) {
      if (!provider || typeof provider.request !== 'function') return;
      if (seen.indexOf(provider) !== -1) return;
      seen.push(provider);
      out.push({ provider: provider, name: name || guessName(provider), rdns: rdns || '' });
    }
    function guessName(p) {
      if (p.isRabby) return 'Rabby';
      if (p.isCoinbaseWallet || p.isCoinbaseBrowser) return 'Coinbase Wallet';
      if (p.isBraveWallet) return 'Brave Wallet';
      if (p.isOkxWallet || p.isOKExWallet) return 'OKX Wallet';
      if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
      if (p.isFrame) return 'Frame';
      if (p.isMetaMask) return 'MetaMask';
      return 'Browser wallet';
    }
    eip6963Wallets.forEach(function (w) { add(w.provider, w.name, w.rdns); });
    var ethereum = window.ethereum;
    if (ethereum) {
      if (ethereum.providers && ethereum.providers.length) {
        ethereum.providers.forEach(function (p) { add(p, guessName(p)); });
      } else {
        add(ethereum, guessName(ethereum));
      }
    }
    return out;
  }
  function hasWallet() { return discoverProviders().length > 0; }
  function getEth() { return eth; }
  function isRobinhood(id) {
    if (id == null) return false;
    if (typeof id === 'number') return id === CFG.CHAIN_ID;
    var s = String(id).toLowerCase();
    if (s === CHAIN_HEX) return true;
    try { return parseInt(s, 16) === CFG.CHAIN_ID || Number(s) === CFG.CHAIN_ID; }
    catch (e) { return false; }
  }
  function walletErrMsg(e) {
    if (!e) return 'Unknown wallet error';
    var msg = (e.message || String(e));
    var low = msg.toLowerCase();
    if (e.code === 4001 || e.code === 'ACTION_REJECTED') {
      return 'You rejected the wallet request. Click Connect wallet to try again.';
    }
    if (e.code === -32002 || low.indexOf('already processing') !== -1 || low.indexOf('already pending') !== -1 || (low.indexOf('unlock') !== -1 && low.indexOf('wait') !== -1)) {
      return 'Your wallet is still unlocking or a popup is already open. Open MetaMask/Rabby, finish Unlock/Connect, wait a second, then tap Connect wallet again.';
    }
    return msg;
  }
  function isUnlockBusy(e) {
    if (!e) return false;
    var low = ((e.message) || '').toLowerCase();
    return e.code === -32002 || low.indexOf('already processing') !== -1 || low.indexOf('already pending') !== -1 || (low.indexOf('unlock') !== -1 && low.indexOf('wait') !== -1);
  }
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  /* Prefer eth_accounts (no popup). If request is busy unlocking, wait and retry. */
  function requestAccounts(provider, attempt) {
    attempt = attempt || 0;
    return provider.request({ method: 'eth_accounts' }).then(function (existing) {
      if (existing && existing[0]) return existing;
      return provider.request({ method: 'eth_requestAccounts' });
    }).catch(function (e) {
      if (isUnlockBusy(e) && attempt < 4) {
        setWalletUi('warn', 'Unlock wallet…', 'Waiting for wallet…');
        showNotConnectedBanner('<strong>Waiting for your wallet.</strong> Finish Unlock/Connect in the extension popup — retrying automatically…');
        showErr(null);
        return sleep(1400 + attempt * 400).then(function () {
          return requestAccounts(provider, attempt + 1);
        });
      }
      throw e;
    });
  }
  function noWalletHelp() {
    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    var path = (location.pathname || '/').replace(/\/$/, '') || '';
    var mm = 'https://metamask.app.link/dapp/' + location.host + path + '/';
    if (mobile) {
      return 'Phone browser has no wallet plugin. Tap <strong>Connect wallet</strong> for open-in-wallet links, or open poolpilot.xyz inside MetaMask / Coinbase / Trust.';
    }
    return 'No wallet found in this window. Open <strong>poolpilot.xyz</strong> in a desktop browser with any injected wallet (MetaMask, Rabby, Coinbase, Brave, OKX, …).';
  }

  function setWalletUi(mode, statusText, btnText) {
    var status = $('walletStatus');
    var statusLabel = $('walletStatusLabel');
    var b = $('walletBtn');
    if (status) {
      status.className = 'wallet-status is-' + mode;
      if (statusLabel) statusLabel.textContent = statusText;
    }
    if (b) {
      b.className = 'btn wallet-' + (mode === 'on' ? 'on' : mode === 'warn' ? 'warn' : 'off');
      b.textContent = btnText;
      b.setAttribute('aria-pressed', mode === 'off' ? 'false' : 'true');
      b.setAttribute('aria-label', mode === 'off'
        ? 'Connect wallet — currently not connected'
        : (mode === 'on' ? 'Wallet connected' : 'Wallet connected on wrong network') + (S.wallet.addr ? ': ' + S.wallet.addr : ''));
    }
    document.documentElement.setAttribute('data-wallet', mode === 'off' ? 'disconnected' : mode === 'on' ? 'connected' : 'wrong-network');
  }

  function updateWalletBtn() {
    if (!S.wallet.addr) {
      setWalletUi('off', 'Not connected', 'Connect wallet');
      return;
    }
    var addr = short(S.wallet.addr) + (isOperator() ? ' · op' : '');
    if (S.wallet.chainOk === false) {
      setWalletUi('warn', 'Wrong network', addr);
      return;
    }
    setWalletUi('on', 'Connected', addr);
  }

  function showNotConnectedBanner(msg) {
    var b = $('walletBanner');
    b.className = 'banner warn';
    b.innerHTML = msg || ('<strong>Not connected.</strong> ' + noWalletHelp());
    b.classList.remove('hidden');
  }

  function showConnectedBanner() {
    var b = $('walletBanner');
    b.className = 'banner wallet-connected';
    b.innerHTML = '<strong>Connected.</strong> ' + esc(short(S.wallet.addr)) +
      ' · Robinhood Chain' +
      ' <button type="button" id="disconnectBtnInline" data-testid="button-disconnect-inline" style="margin-left:8px;color:var(--accent);background:none;border:none;font-weight:700;cursor:pointer;font-family:var(--font-body);font-size:var(--text-sm)">Disconnect</button>';
    b.classList.remove('hidden');
    var d = $('disconnectBtnInline');
    if (d) d.addEventListener('click', disconnectWallet);
  }

  function disconnectWallet() {
    S.wallet.addr = null;
    S.wallet.provider = null;
    S.wallet.chainOk = false;
    eth = null;
    updateWalletBtn();
    showNotConnectedBanner('<strong>Not connected.</strong> Tap <strong>Connect wallet</strong> to share your address.');
    closeModal();
  }

  function openConnectedSheet() {
    openModal(
      '<h3>Wallet connected</h3>' +
      '<p class="msub">Pool Pilot will use this address for any signed moves. Nothing moves until you approve each transaction.</p>' +
      '<div class="prow"><span class="k">Status</span><span class="v">' + (S.wallet.chainOk ? 'Connected · Robinhood Chain' : 'Connected · wrong network') + '</span></div>' +
      '<div class="prow"><span class="k">Address</span><span class="v mono" style="word-break:break-all">' + esc(S.wallet.addr) + '</span></div>' +
      (S.wallet.chainOk ? '' : '<button class="btn btn-primary btn-lg" id="switchRhBtn" style="margin-top:8px" data-testid="button-switch-rh">Switch to Robinhood Chain</button>') +
      '<a class="btn btn-ghost btn-lg" style="margin-top:8px;display:block;text-align:center;text-decoration:none" href="' + CFG.EXPLORER + '/address/' + encodeURIComponent(S.wallet.addr) + '" target="_blank" rel="noopener">View on explorer</a>' +
      '<button class="btn btn-ghost btn-lg" id="disconnectGo" style="margin-top:8px" data-testid="button-disconnect">Disconnect</button>' +
      '<button class="btn btn-ghost btn-lg" id="cxNo" style="margin-top:8px">Close</button>'
    );
    if ($('switchRhBtn')) {
      $('switchRhBtn').addEventListener('click', function () {
        ensureChain().then(function () {
          S.wallet.chainOk = true;
          updateWalletBtn();
          showConnectedBanner();
          closeModal();
        }).catch(function (e) {
          showErr(walletErrMsg(e));
        });
      });
    }
    $('disconnectGo').addEventListener('click', disconnectWallet);
    $('cxNo').addEventListener('click', closeModal);
  }

  function isPhone() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }
  function openNoWalletHelp() {
    var url = location.origin + (location.pathname || '/') + (location.search || '') + (location.hash || '');
    var enc = encodeURIComponent(url);
    var path = (location.pathname || '/').replace(/\/$/, '') || '';
    var mm = 'https://metamask.app.link/dapp/' + location.host + path + '/';
    var cb = 'https://go.cb-w.com/dapp?cb_url=' + enc;
    var trust = 'https://link.trustwallet.com/open_url?coin_id=60&url=' + enc;
    openModal(
      '<h3>Wallet not connected</h3>' +
      '<p class="msub">Status: <strong>Not connected</strong>. ' + (isPhone()
        ? 'Open Pool Pilot inside <em>your</em> wallet app, then Connect again.'
        : 'Install any browser wallet, then tap Connect.') + '</p>' +
      (isPhone()
        ? '<a class="btn btn-primary btn-lg" style="display:block;text-align:center;margin-top:8px;text-decoration:none" href="' + mm + '">Open in MetaMask</a>' +
          '<a class="btn btn-primary btn-lg" style="display:block;text-align:center;margin-top:8px;text-decoration:none" href="' + cb + '">Open in Coinbase Wallet</a>' +
          '<a class="btn btn-ghost btn-lg" style="display:block;text-align:center;margin-top:8px;text-decoration:none" href="' + trust + '">Open in Trust Wallet</a>'
        : '') +
      '<button class="btn btn-ghost btn-lg" id="cxNo" style="margin-top:8px">Not now</button>'
    );
    $('cxNo').addEventListener('click', closeModal);
    showNotConnectedBanner();
    return Promise.resolve(false);
  }

  function ensureChain() {
    var p = getEth();
    if (!p) return Promise.reject(new Error('No wallet provider'));
    return p.request({ method: 'eth_chainId' }).then(function (id) {
      if (isRobinhood(id)) return true;
      return p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] })
        .then(function () { return true; })
        .catch(function (e) {
          var msg = ((e && e.message) || '').toLowerCase();
          if (e && (e.code === 4902 || String(e.code) === '4902' || msg.indexOf('4902') !== -1 || msg.indexOf('unrecognized') !== -1 || msg.indexOf('not been added') !== -1 || msg.indexOf('not added') !== -1)) {
            return p.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: CHAIN_HEX, chainName: 'Robinhood Chain',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: [CFG.RPC], blockExplorerUrls: [CFG.EXPLORER]
              }]
            }).then(function () { return true; });
          }
          throw e;
        });
    });
  }

  function bindWalletEvents(p) {
    if (!p || p.__ppBound) return;
    p.__ppBound = true;
    if (!p.on) return;
    p.on('accountsChanged', function (a) {
      S.wallet.addr = a && a[0] ? a[0] : null;
      if (!S.wallet.addr) {
        S.wallet.provider = null;
        S.wallet.chainOk = false;
        showNotConnectedBanner('<strong>Not connected.</strong> Wallet disconnected or switched away.');
      } else {
        showConnectedBanner();
      }
      updateWalletBtn();
      if (S.info) loadState();
    });
    p.on('chainChanged', function (id) {
      S.wallet.chainOk = isRobinhood(id);
      updateWalletBtn();
      if (S.wallet.addr && S.wallet.chainOk) showConnectedBanner();
      else if (S.wallet.addr) {
        var b = $('walletBanner');
        b.className = 'banner warn';
        b.innerHTML = '<strong>Wrong network.</strong> Connected as ' + esc(short(S.wallet.addr)) + ' — switch to Robinhood Chain (4663).';
        b.classList.remove('hidden');
      }
      if (S.wallet.addr && S.info) loadState();
    });
  }

  var connectInFlight = null;
  function connectWith(provider) {
    if (!provider) return openNoWalletHelp();
    if (connectInFlight) {
      showNotConnectedBanner('<strong>Connect already in progress.</strong> Check your wallet popup (Unlock / Connect), or wait a moment.');
      return connectInFlight;
    }
    eth = provider;
    bindWalletEvents(provider);
    setWalletUi('warn', 'Connecting…', 'Connecting…');
    connectInFlight = requestAccounts(provider).then(function (accts) {
      if (!accts || !accts[0]) throw new Error('No account returned from wallet.');
      S.wallet.addr = accts[0];
      S.wallet.provider = new ethers.providers.Web3Provider(provider, 'any');
      S.wallet.chainOk = false;
      updateWalletBtn();
      return ensureChain().then(function () {
        S.wallet.chainOk = true;
        updateWalletBtn();
        showConnectedBanner();
        showErr(null);
        if (S.info) loadState();
        return true;
      }).catch(function (e) {
        S.wallet.chainOk = false;
        updateWalletBtn();
        var b = $('walletBanner');
        b.className = 'banner warn';
        b.innerHTML = '<strong>Connected — wrong network.</strong> ' + esc(short(S.wallet.addr)) +
          ' needs <strong>Robinhood Chain (4663)</strong>. Approve Add/Switch in your wallet, then tap the address button. ' +
          esc(walletErrMsg(e));
        b.classList.remove('hidden');
        return false;
      });
    }).catch(function (e) {
      updateWalletBtn();
      if (isUnlockBusy(e)) {
        showNotConnectedBanner('<strong>Not connected.</strong> ' + esc(walletErrMsg(e)));
        showErr(null);
      } else {
        showErr('Wallet connection failed: ' + walletErrMsg(e));
      }
      return false;
    }).then(function (ok) {
      connectInFlight = null;
      return ok;
    }, function (err) {
      connectInFlight = null;
      throw err;
    });
    return connectInFlight;
  }

  function chooseWalletThenConnect() {
    var wallets = discoverProviders();
    if (!wallets.length) return connectWith(null);
    if (wallets.length === 1) return connectWith(wallets[0].provider);
    openModal(
      '<h3>Choose your wallet</h3>' +
      '<p class="msub">Any injected browser wallet works. Pick the one you want to use — Pool Pilot never defaults to a specific account.</p>' +
      '<div id="walletChoices"></div>' +
      '<button class="btn btn-ghost btn-lg" id="cxNo" style="margin-top:8px">Not now</button>'
    );
    var box = $('walletChoices');
    wallets.forEach(function (w, i) {
      var btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-lg';
      btn.style.marginTop = i ? '8px' : '0';
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.setAttribute('data-testid', 'button-wallet-' + (w.rdns || w.name).replace(/\W+/g, '-').toLowerCase());
      btn.textContent = w.name;
      btn.addEventListener('click', function () {
        closeModal();
        connectWith(w.provider);
      });
      box.appendChild(btn);
    });
    $('cxNo').addEventListener('click', closeModal);
    return Promise.resolve(false);
  }

  function connect() {
    return chooseWalletThenConnect();
  }
  /* First-connect explainer — answers "why should I trust this button?" head-on. */
  function connectExplained() {
    if (!hasWallet()) return connect(); // shows the read-only banner path
    if (S.wallet.addr || S.connectExplained) return connect();
    openModal(
      '<h3>What “connect” actually does</h3>' +
      '<p class="msub">Wallets get drained by what people <em>sign</em>, not by connecting. Here is exactly what this button can and cannot do:</p>' +
      '<ul class="tlist">' +
      '<li><strong>Connecting shares your public address only</strong> — the same thing anyone can already see on the block explorer. It creates no permission to move funds.</li>' +
      '<li><strong>Every action is a separate wallet popup</strong> showing the exact contract it goes to. Nothing is ever sent silently.</li>' +
      '<li><strong>Only three audited public contracts are ever used:</strong> WETH, your token, and <a href="' + CFG.EXPLORER + '/address/' + CFG.NPM + '" target="_blank" rel="noopener">Uniswap\u2019s position manager</a>. There is no Pool Pilot contract that could hold or take funds.</li>' +
      '<li><strong>Approvals are exact-amount, never unlimited.</strong> No <code>setApprovalForAll</code>, ever.</li>' +
      '<li><strong>We never ask you to “sign a message.”</strong> If this site ever shows a signature request instead of a transaction — reject it.</li>' +
      '</ul>' +
      '<button class="btn btn-primary btn-lg" id="cxGo" data-testid="button-connect-confirm">Choose wallet & connect</button>' +
      '<button class="btn btn-ghost btn-lg" id="cxNo" style="margin-top:8px">Not now</button>'
    );
    $('cxGo').addEventListener('click', function () { S.connectExplained = true; closeModal(); chooseWalletThenConnect(); });
    $('cxNo').addEventListener('click', closeModal);
    return Promise.resolve(false);
  }
  $('walletBtn').addEventListener('click', function () {
    if (S.wallet.addr) openConnectedSheet();
    else connectExplained();
  });

  function securityNotes() {
    openModal('<h3>Security notes</h3>' +
      '<p class="msub">What we did so a hostile token, a hacked CDN, or a front-runner cannot hurt you. Every item below is tested, not aspirational.</p>' +
      '<ul class="tlist">' +
      '<li><strong>Hostile token metadata.</strong> A token contract can return anything it wants for its name and symbol — including HTML. We strip every character that is not a plain letter, number, or space, cap the length, and escape it again before it reaches the page. Tested by feeding the app a token whose symbol was an image tag with an attack payload: it rendered as harmless text and never ran.</li>' +
      '<li><strong>Injected scripts.</strong> The page runs under a strict content security policy — no inline scripts, no <code>eval</code>, and network requests limited to the chain RPC and two price feeds. Even if something hostile reached the page, the browser refuses to execute it and it has nowhere to send data.</li>' +
      '<li><strong>Supply chain.</strong> The single third-party library (ethers v5.7.2) is pinned to a cryptographic hash. If that CDN were ever compromised and served different code, your browser blocks it and the app simply will not load — it cannot be silently swapped for a drainer.</li>' +
      '<li><strong>Front-running your deposit.</strong> Deposits that sit at the current price used to accept any split. Now every one carries an on-chain minimum computed from the price at preview time. If someone shoves the price before your transaction lands, it reverts and you keep your funds. Tested on a mainnet fork with a live attacker transaction in between.</li>' +
      '<li><strong>Price feed manipulation.</strong> The $25 fee is priced from an external ETH feed. Any value outside a sane band — or a missing feed — now blocks the quote entirely instead of falling back to a guess, so a bad feed can never make you overpay.</li>' +
      '<li><strong>Approvals.</strong> Every approval is for the exact amount of that one move and goes only to Uniswap’s position manager. No unlimited approvals, no <code>setApprovalForAll</code>, and no Pool Pilot contract exists to approve.</li>' +
      '<li><strong>Wrong network.</strong> The app verifies the chain ID before every signature and prompts you to switch. It cannot quietly get you to sign something on a different chain.</li>' +
      '<li><strong>Honest limits.</strong> This is a front end — it can only ever build transactions you approve in your own wallet. The residual risks are the ones every dapp shares: a compromised wallet extension, a DNS hijack of the domain, or a malicious token whose transfer logic itself is hostile. Verify the address in your wallet popup on every step; that is your final check and it always works.</li>' +
      '</ul>' +
      '<button class="btn btn-primary btn-lg" id="secClose" data-testid="button-security-close">Got it</button>');
    $('secClose').addEventListener('click', closeModal);
  }
  if ($('secLink')) $('secLink').addEventListener('click', function (e) { e.preventDefault(); securityNotes(); });

  /* ---------------- load token + state ---------------- */
  function setBusy(on) {
    S.busy = on;
    $('checkBtn').disabled = on;
    $('skeleton').classList.toggle('hidden', !on);
    if (on) {
      $('stateCard').classList.add('hidden');
      $('movesCard').classList.add('hidden');
      $('posCard').classList.add('hidden');
    }
  }

  function loadToken(addr) {
    addr = (addr || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { showErr('That is not a token address. It should start with 0x and be 42 characters long.'); return; }
    showErr(null);
    setBusy(true);
    $('tokenInput').value = addr;
    var pEth = S.ethUsd ? Promise.resolve(S.ethUsd) : L.fetchEthUsd().then(function (u) { S.ethUsd = u; return u; });
    Promise.all([L.discoverPool(read, addr.toLowerCase()), pEth])
      .then(function (r) {
        S.info = r[0];
        try { if (location.hash.slice(1).toLowerCase() !== addr.toLowerCase()) location.hash = addr; } catch (e) {}
        return loadState();
      })
      .catch(function (e) {
        setBusy(false);
        showErr((e && e.message) || 'Could not find a pool for that token.');
      });
  }

  function loadState() {
    if (!S.info) return Promise.resolve();
    setBusy(true);
    return L.readState(read, S.info, S.ethUsd, S.wallet.addr)
      .then(function (st) {
        S.state = st;
        setBusy(false);
        renderState();
        renderMoves();
        renderPositions();
      })
      .catch(function (e) {
        setBusy(false);
        showErr('Could not read the pool: ' + ((e && e.message) || e));
      });
  }

  $('checkBtn').addEventListener('click', function () { loadToken($('tokenInput').value); });
  $('tokenInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadToken($('tokenInput').value); });
  $('tokenInput').addEventListener('input', updateTokenConfirm);
  $('refreshBtn').addEventListener('click', function () { loadState(); });

  function apiBase() {
    return (window.PoolPilotPartner && window.PoolPilotPartner.apiBase)
      ? window.PoolPilotPartner.apiBase()
      : location.origin;
  }

  function bindChipClicks(root) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('.chip[data-addr]'), function (c) {
      c.addEventListener('click', function () { loadToken(c.getAttribute('data-addr')); });
    });
  }

  function updateTokenConfirm() {
    var slot = $('tokenConfirm');
    if (!slot || !window.PoolPilotTokens) return;
    var t = window.PoolPilotTokens.byAddress($('tokenInput').value);
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
        loadToken(btn.getAttribute('data-addr'));
      });
    }
  }

  function renderTokenDirectories(paidExtra) {
    var T = window.PoolPilotTokens;
    if (!T) return;
    var featuredBox = $('featuredChips');
    var communityBox = $('communityChips');
    if (featuredBox) {
      featuredBox.innerHTML = T.featuredTokens(paidExtra || []).map(function (t) {
        return T.chipHtml(t);
      }).join('');
      bindChipClicks(featuredBox);
    }
    if (communityBox) {
      communityBox.innerHTML = T.communityTokens().map(function (t) {
        return T.chipHtml(t);
      }).join('');
      bindChipClicks(communityBox);
    }
  }

  function loadPaidListings() {
    return fetch(apiBase() + '/api/listings', {
      headers: { Accept: 'application/json' },
      mode: 'cors'
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.featured)) return [];
        return j.featured.map(function (t) {
          return {
            symbol: t.symbol,
            address: t.address,
            featured: true,
            paid: true
          };
        });
      })
      .catch(function () { return []; });
  }

  renderTokenDirectories([]);
  updateTokenConfirm();
  loadPaidListings().then(function (extra) {
    if (extra && extra.length) renderTokenDirectories(extra);
  });

  /* ---------------- render: state ---------------- */
  function verdictText(light) {
    if (light === 'green') return 'Healthy pool';
    if (light === 'yellow') return 'Needs attention';
    return 'Trading is broken';
  }

  function renderState() {
    var st = S.state, info = S.info;
    $('stateCard').classList.remove('hidden');
    $('lightDot').className = 'light ' + st.light;
    $('verdict').textContent = verdictText(st.light);
    $('tokLine').textContent = info.symbol + ' · pool ' + short(info.pool) + ' · ' + (info.fee / 10000) + '% fee tier';

    var rows = [];
    rows.push(['Price', L.fmtPrice(st.priceUsd) + ' <span style="color:var(--text-faint)">per ' + esc(info.symbol) + '</span>', '']);
    rows.push(['For sale (sell side)', fmtTok(st.sellSideTokens) + ' ' + esc(info.symbol) + ' · ' + fmtUsd(st.sellSideUsd), st.sellSideUsd != null && st.sellSideUsd < 100 ? 'warn' : '']);
    rows.push(['Buy support (ETH side)', st.buySideEth.toFixed(4) + ' ETH · ' + fmtUsd(st.buySideUsd), st.buySideUsd != null && st.buySideUsd < 100 ? 'warn' : '']);
    var buyTxt = st.buyImpact.ok ? '+' + fmtPct(st.buyImpact.pctMove) : 'no route';
    var sellTxt = st.sellImpact.ok ? '−' + fmtPct(st.sellImpact.pctMove) : 'no route';
    var impactBad = !st.buyImpact.ok || !st.sellImpact.ok;
    var worst = Math.max(st.buyImpact.ok ? Math.abs(st.buyImpact.pctMove) : 0, st.sellImpact.ok ? Math.abs(st.sellImpact.pctMove) : 0);
    rows.push(['A $50 trade moves price', 'buy ' + buyTxt + ' · sell ' + sellTxt, impactBad ? 'bad' : (worst > 10 ? 'warn' : 'good')]);
    if (st.positions) {
      var f = st.positions.feesToken * (st.priceUsd || 0) + st.positions.feesEth * (st.ethUsd || 0);
      rows.push(['Your unclaimed fees', fmtTok(st.positions.feesToken) + ' ' + esc(info.symbol) + ' + ' + st.positions.feesEth.toFixed(5) + ' ETH (' + fmtUsd(f) + ')', f > 0.5 ? 'good' : '']);
    }
    $('stateRows').innerHTML = rows.map(function (r) {
      return '<div class="srow"><span class="k">' + r[0] + '</span><span class="v ' + r[2] + '">' + r[1] + '</span></div>';
    }).join('');

    $('reasonList').innerHTML = (st.reasons || []).map(function (r) {
      return '<div class="reason' + (st.light === 'red' ? ' red' : '') + '">' + esc(r) + '</div>';
    }).join('');
    $('stamp').textContent = 'Live from Robinhood Chain · ' + new Date().toLocaleTimeString();
  }

  /* ---------------- render: positions ---------------- */
  function tickToUsd(tick) {
    var info = S.info, st = S.state;
    var pEthTick = Math.pow(1.0001, info.tokenIsToken1 ? -tick : tick) * Math.pow(10, info.decimals - 18);
    return pEthTick * (st.ethUsd || 0);
  }
  function renderPositions() {
    var st = S.state;
    if (!st.positions || !st.positions.list.length) { $('posCard').classList.add('hidden'); return; }
    $('posCard').classList.remove('hidden');
    $('posRows').innerHTML = st.positions.list.map(function (p) {
      var loP = tickToUsd(S.info.tokenIsToken1 ? p.tickUpper : p.tickLower);
      var hiP = tickToUsd(S.info.tokenIsToken1 ? p.tickLower : p.tickUpper);
      var fT = S.info.tokenIsToken1 ? p.fees1 : p.fees0;
      var fE = S.info.tokenIsToken1 ? p.fees0 : p.fees1;
      var active = p.liquidity !== '0';
      var exitBtn = active
        ? ' <button type="button" class="btn btn-ghost" style="padding:4px 10px;font-size:0.75rem" data-exit-id="' + p.id + '" data-testid="button-exit-' + p.id + '">Withdraw</button>'
        : '';
      return '<tr data-testid="row-position-' + p.id + '"><td>#' + p.id + (active ? '' : ' <span style="color:var(--text-faint)">(empty)</span>') + exitBtn + '</td>' +
        '<td>' + L.fmtPrice(loP) + ' – ' + L.fmtPrice(hiP) + '</td>' +
        '<td>' + fmtTok(fT) + ' ' + esc(S.info.symbol) + ' + ' + fE.toFixed(5) + ' ETH</td></tr>';
    }).join('');
    Array.prototype.forEach.call($('posRows').querySelectorAll('[data-exit-id]'), function (b) {
      b.addEventListener('click', function () {
        openExit([b.getAttribute('data-exit-id')]);
      });
    });
  }

  /* ---------------- render: moves ---------------- */
  function buildMoveDefs() {
    var st = S.state, info = S.info;
    var defs = [];
    var sSell = st.sellSideUsd || 0, sBuy = st.buySideUsd || 0;
    var feesUsd = st.positions ? st.positions.feesToken * (st.priceUsd || 0) + st.positions.feesEth * (st.ethUsd || 0) : 0;

    if (!st.routable) {
      defs.push({ id: 'straddle', rec: true, title: 'Turn trading back on', why: 'Routers see zero active liquidity, so trade widgets say "no route". A straddle around the current price puts inventory on both sides so trading works again.', fx: 'Adds ' + info.symbol + ' + ETH right around the current price', price: '$25 in MCFL' });
      defs.push({ id: 'buyside', rec: false, title: 'Deepen your buy side', why: 'Puts ETH to work catching sellers below the current price.', fx: 'ETH ladder from −10% down to −35% of spot', price: '$25 in MCFL' });
    } else if (sSell > sBuy * 2) {
      defs.push({ id: 'buyside', rec: true, title: 'Deepen your buy side', why: 'Your book is heavy on the sell side (' + fmtUsd(sSell) + ' for sale vs ' + fmtUsd(sBuy) + ' of buy support). ETH below spot catches sellers and steadies the price.', fx: 'ETH ladder from −10% down to −35% of spot', price: '$25 in MCFL' });
      defs.push({ id: 'straddle', rec: false, title: 'Tighten the spread', why: 'Concentrated liquidity right at the price makes small trades feel smooth.', fx: 'Both sides, tight band around spot', price: '$25 in MCFL' });
    } else if (sBuy > sSell * 2) {
      defs.push({ id: 'straddle', rec: true, title: 'Add sell-side inventory', why: 'You have buy support (' + fmtUsd(sBuy) + ') but only ' + fmtUsd(sSell) + ' of ' + info.symbol + ' for sale — buyers hit big slippage. A straddle adds inventory near the price.', fx: 'Both sides, tight band around spot', price: '$25 in MCFL' });
      defs.push({ id: 'buyside', rec: false, title: 'Deepen your buy side', why: 'More ETH below spot for even sturdier support.', fx: 'ETH ladder from −10% down to −35% of spot', price: '$25 in MCFL' });
    } else {
      defs.push({ id: 'straddle', rec: st.light !== 'green', title: 'Tighten the spread', why: 'Concentrated liquidity right at the price cuts the impact of small trades — the single biggest "feels healthy" upgrade.', fx: 'Both sides, tight band around spot', price: '$25 in MCFL' });
      defs.push({ id: 'buyside', rec: false, title: 'Deepen your buy side', why: 'ETH below spot catches sellers before the price slides.', fx: 'ETH ladder from −10% down to −35% of spot', price: '$25 in MCFL' });
    }

    if (feesUsd > 0.25) {
      defs.push({ id: 'collect', rec: false, title: 'Collect your earned fees', why: 'You have ' + fmtUsd(feesUsd) + ' of trading fees sitting unclaimed across your positions.', fx: 'Sends earned fees to your wallet', price: 'Free' });
    }
    var livePos = st.positions && st.positions.list
      ? st.positions.list.filter(function (p) {
          try { return ethers.BigNumber.from(p.liquidity || '0').gt(0); } catch (e) { return false; }
        }).length
      : 0;
    if (livePos > 0) {
      defs.push({
        id: 'exit',
        rec: false,
        title: 'Withdraw from LP',
        why: 'Pull your ETH / ' + info.symbol + ' out of ' + livePos + ' Uniswap position' + (livePos === 1 ? '' : 's') + ' you own. One signature; tokens return to your wallet.',
        fx: 'decreaseLiquidity + collect → your wallet',
        price: 'Free'
      });
    }
    defs.push({ id: 'superchain', rec: false, title: 'Super Chain launch', why: 'Mint one LayerZero OFT wired across Solana, Base, and Robinhood Chain from day one — same supply everywhere, plus Robinhood app listing guidance. Hand-delivered within 72h or your fee is refunded on-chain.', fx: 'Multi-chain peers before public trading · receipt on-chain', price: '$25 in MCFL' });
    return defs.slice(0, 5);
  }

  function renderMoves() {
    var defs = buildMoveDefs();
    $('movesCard').classList.remove('hidden');
    $('moveList').innerHTML = defs.map(function (d) {
      return '<div class="move' + (d.rec ? ' recommended' : '') + '" data-testid="move-' + d.id + '">' +
        (d.rec ? '<span class="rec-badge">Recommended</span>' : '') +
        '<div class="movehead"><span class="t">' + esc(d.title) + '</span><span class="price-tag' + (d.price === 'Free' ? ' free' : '') + '">' + esc(d.price) + '</span></div>' +
        '<p class="why">' + esc(d.why) + '</p>' +
        '<div class="fx">' + esc(d.fx) + '</div>' +
        '<button class="btn ' + (d.rec ? 'btn-primary' : 'btn-ghost') + ' go" data-move="' + d.id + '" data-testid="button-move-' + d.id + '">Preview this move</button>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call($('moveList').querySelectorAll('[data-move]'), function (b) {
      b.addEventListener('click', function () { openMove(b.getAttribute('data-move')); });
    });
  }

  /* ---------------- modal ---------------- */
  function openModal(html) { $('modal').innerHTML = html; $('overlay').classList.add('open'); }
  function closeModal() { $('overlay').classList.remove('open'); }
  $('overlay').addEventListener('click', function (e) { if (e.target === $('overlay') && !S.busy) closeModal(); });

  function walletGate() {
    if (!hasWallet()) {
      openNoWalletHelp();
      return false;
    }
    if (!S.wallet.addr) { connectExplained(); return false; }
    if (S.wallet.chainOk === false) {
      openConnectedSheet();
      return false;
    }
    return true;
  }

  function balances() {
    var mcfl = new ethers.Contract(CFG.MCFL, ['function balanceOf(address) view returns (uint256)'], read);
    return Promise.all([
      read.getBalance(S.wallet.addr),
      mcfl.balanceOf(S.wallet.addr),
      S.info.token.toLowerCase() === CFG.MCFL.toLowerCase() ? Promise.resolve(null)
        : new ethers.Contract(S.info.token, ['function balanceOf(address) view returns (uint256)'], read).balanceOf(S.wallet.addr),
      new ethers.Contract(CFG.WETH, ['function balanceOf(address) view returns (uint256)'], read).balanceOf(S.wallet.addr)
    ]).then(function (r) {
      return {
        eth: parseFloat(ethers.utils.formatEther(r[0])),
        mcfl: parseFloat(ethers.utils.formatEther(r[1])),
        token: r[2] == null ? parseFloat(ethers.utils.formatEther(r[1])) : parseFloat(ethers.utils.formatUnits(r[2], S.info.decimals)),
        weth: parseFloat(ethers.utils.formatEther(r[3]))
      };
    });
  }

  function feeSection(quote, bal) {
    if (isOperator()) return '<div class="banner ok">Operator wallet detected — fee waived.</div>';
    var canMcfl = bal.mcfl >= quote.mcflAmountF;
    var canEth = true;
    var html = '<div class="field"><label>How you pay the $25 fee</label><div class="paychoice" id="payChoice">';
    if (canMcfl) html += '<div class="opt sel" data-pay="mcfl" data-testid="option-pay-mcfl">Pay with MCFL you hold<span class="amt">' + Math.round(quote.mcflAmountF).toLocaleString() + ' MCFL</span></div>';
    if (canEth) html += '<div class="opt' + (canMcfl ? '' : ' sel') + '" data-pay="eth" data-testid="option-pay-eth">Pay with ETH — deposited as MCFL buy-side liquidity, treasury-owned<span class="amt">' + quote.ethInF.toFixed(5) + ' ETH = ' + fmtUsd(quote.usdIn) + '</span></div>';
    html += '</div><div class="hint" style="font-size:var(--text-xs);color:var(--text-faint)">The ETH path never swaps — your exact $25 of ETH is placed as a buy wall in the MCFL pool (owned by the treasury), so paying the fee deepens the MCFL book instead of moving its price. The fee only leaves your wallet as part of executing the plan below.</div></div>';
    return html;
  }
  function wirePayChoice() {
    var pc = $('payChoice');
    if (!pc) return;
    Array.prototype.forEach.call(pc.querySelectorAll('.opt'), function (o) {
      o.addEventListener('click', function () {
        Array.prototype.forEach.call(pc.querySelectorAll('.opt'), function (x) { x.classList.remove('sel'); });
        o.classList.add('sel');
      });
    });
  }
  function chosenPay() {
    var pc = $('payChoice');
    if (!pc) return null;
    var sel = pc.querySelector('.opt.sel');
    return sel ? sel.getAttribute('data-pay') : null;
  }
  function feeTxs(quote) {
    if (isOperator()) return [];
    var pay = chosenPay();
    if (pay === 'mcfl') return [L.payFeeWithMcflTx(quote)];
    return [L.payFeeWithEthTx(quote)];
  }
  function feeEthCost(quote) {
    if (isOperator()) return 0;
    return chosenPay() === 'eth' ? quote.ethInF : 0;
  }

  /* ---------------- move: buy side ---------------- */
  function openMove(id) {
    showErr(null);
    if (id === 'collect') return openCollect();
    if (id === 'exit') return openExit(null);
    if (id === 'omni' || id === 'superchain') return openOmni();
    if (!walletGate()) return;
    openModal('<h3>Loading preview…</h3><div class="skel" style="height:16px;margin:12px 0"></div><div class="skel" style="height:16px;width:70%"></div>');
    Promise.all([L.quoteFee(read, S.ethUsd), balances()]).then(function (r) {
      var quote = r[0], bal = r[1];
      if (id === 'buyside') renderBuySide(quote, bal);
      else renderStraddle(quote, bal);
    }).catch(function (e) {
      openModal('<h3>Could not build the preview</h3><p class="msub">' + esc((e && e.message) || e) + '</p><button class="btn btn-ghost btn-lg" id="mClose">Close</button>');
      $('mClose').addEventListener('click', closeModal);
    });
  }

  function renderBuySide(quote, bal) {
    var gasReserve = 0.0015;
    var maxEth = Math.max(0, bal.eth - gasReserve - (isOperator() ? 0 : (bal.mcfl >= quote.mcflAmountF ? 0 : quote.ethInF)));
    var def = Math.min(maxEth, Math.max(0.001, maxEth * 0.5));
    openModal(
      '<h3>Deepen your buy side</h3>' +
      '<p class="msub">Places an ETH-only ladder below the current price — from −10% down to −35%. When people sell, your ladder buys. You own the position; withdraw it any time in any Uniswap v3 interface.</p>' +
      '<div class="field"><label>ETH to commit</label><input id="amtEth" inputmode="decimal" value="' + (def > 0 ? def.toFixed(4) : '') + '" data-testid="input-eth-amount">' +
      '<div class="hint"><span>Balance: ' + bal.eth.toFixed(4) + ' ETH</span><button id="maxBtn" data-testid="button-max">MAX</button></div></div>' +
      feeSection(quote, bal) +
      '<div class="preview" id="pv"></div>' +
      '<div id="mErr"></div>' +
      '<button class="btn btn-primary btn-lg" id="goBtn" data-testid="button-execute">Pay & execute</button>' +
      '<button class="btn btn-ghost btn-lg" id="mClose" style="margin-top:8px">Cancel</button>'
    );
    wirePayChoice();
    $('mClose').addEventListener('click', closeModal);
    $('maxBtn').addEventListener('click', function () { $('amtEth').value = maxEth > 0 ? maxEth.toFixed(4) : '0'; refresh(); });
    function refresh() {
      var v = parseFloat($('amtEth').value);
      if (!v || v <= 0) { $('pv').innerHTML = '<div class="prow"><span class="k">Enter an ETH amount to preview.</span></div>'; $('goBtn').disabled = true; return; }
      try {
        var plan = L.planBuySide(S.state, String(v), S.wallet.addr);
        var st = S.state;
        $('pv').innerHTML =
          '<div class="prow"><span class="k">Ladder top</span><span class="v">' + L.fmtPrice(plan.summary.topPrice * (st.ethUsd || 0)) + ' (−10%)</span></div>' +
          '<div class="prow"><span class="k">Ladder bottom</span><span class="v">' + L.fmtPrice(plan.summary.bottomPrice * (st.ethUsd || 0)) + ' (−35%)</span></div>' +
          '<div class="prow"><span class="k">Buy support added</span><span class="v">' + v.toFixed(4) + ' ETH ≈ ' + fmtUsd(v * (st.ethUsd || 0)) + '</span></div>' +
          '<div class="prow"><span class="k">Transactions you will sign</span><span class="v">' + (plan.txs.length + (isOperator() ? 0 : 1)) + '</span></div>';
        var need = v + feeEthCost(quote) + 0.001;
        if (need > bal.eth) { $('mErr').innerHTML = '<div class="banner err">You need ~' + need.toFixed(4) + ' ETH (amount + fee + gas) but hold ' + bal.eth.toFixed(4) + '.</div>'; $('goBtn').disabled = true; }
        else { $('mErr').innerHTML = ''; $('goBtn').disabled = false; }
      } catch (e) { $('pv').innerHTML = '<div class="prow"><span class="k">' + esc(e.message) + '</span></div>'; $('goBtn').disabled = true; }
    }
    $('amtEth').addEventListener('input', refresh);
    var pc = $('payChoice');
    if (pc) Array.prototype.forEach.call(pc.querySelectorAll('.opt'), function (o) { o.addEventListener('click', refresh); });
    refresh();
    $('goBtn').addEventListener('click', function () {
      var v = parseFloat($('amtEth').value);
      var plan = L.planBuySide(S.state, String(v), S.wallet.addr);
      execute('Deepen buy side — ' + S.info.symbol, feeTxs(quote).concat(plan.txs));
    });
  }

  /* ---------------- move: straddle ---------------- */
  function renderStraddle(quote, bal) {
    var gasReserve = 0.0015;
    var weth = bal.weth || 0;
    var maxEth = Math.max(0, bal.eth - gasReserve - (isOperator() ? 0 : (bal.mcfl >= quote.mcflAmountF ? 0 : quote.ethInF))) + weth;
    var defTok = bal.token > 0 ? bal.token * 0.5 : 0;
    var defEth = Math.min(maxEth, maxEth * 0.5);
    var band = priceMultAtTicks(S.info.spacing * 3) * 100;
    openModal(
      '<h3>Tighten the spread</h3>' +
      '<p class="msub">Mints a concentrated position roughly ±' + band.toFixed(0) + '% around the current price, with ' + esc(S.info.symbol) + ' on one side and ETH on the other. Small trades get much smoother. You own the position and can withdraw any time.</p>' +
      '<div class="field"><label>' + esc(S.info.symbol) + ' to commit</label><input id="amtTok" inputmode="decimal" value="' + (defTok > 0 ? Math.floor(defTok) : '') + '" data-testid="input-token-amount">' +
      '<div class="hint"><span>Balance: ' + fmtTok(bal.token) + ' ' + esc(S.info.symbol) + '</span><button id="maxTok">MAX</button></div></div>' +
      '<div class="field"><label>ETH to commit</label><input id="amtEth" inputmode="decimal" value="' + (defEth > 0.0005 ? defEth.toFixed(4) : '0') + '" data-testid="input-eth-amount">' +
      '<div class="hint"><span>Balance: ' + bal.eth.toFixed(4) + ' ETH' + (weth > 0 ? ' + ' + weth.toFixed(4) + ' WETH (counted)' : '') + '</span><button id="maxEth2">MAX</button></div></div>' +
      feeSection(quote, bal) +
      '<div class="preview" id="pv"></div>' +
      '<div id="mErr"></div>' +
      '<button class="btn btn-primary btn-lg" id="goBtn" data-testid="button-execute">Pay & execute</button>' +
      '<button class="btn btn-ghost btn-lg" id="mClose" style="margin-top:8px">Cancel</button>'
    );
    wirePayChoice();
    $('mClose').addEventListener('click', closeModal);
    $('maxTok').addEventListener('click', function () { $('amtTok').value = Math.floor(bal.token); refresh(); });
    $('maxEth2').addEventListener('click', function () { $('amtEth').value = maxEth > 0 ? maxEth.toFixed(4) : '0'; refresh(); });
    function refresh() {
      var vt = parseFloat($('amtTok').value) || 0;
      var ve = parseFloat($('amtEth').value) || 0;
      if (vt <= 0 && ve <= 0) { $('pv').innerHTML = '<div class="prow"><span class="k">Enter amounts to preview.</span></div>'; $('goBtn').disabled = true; return; }
      try {
        var plan = L.planStraddle(S.state, String(vt || 0), String(ve || 0), S.wallet.addr, undefined, weth.toFixed(18));
        var st = S.state;
        var bandLabel = plan.summary.oneSided
          ? '<div class="prow"><span class="k">Shape</span><span class="v">One-sided ' + esc(plan.summary.oneSided) + ' band next to spot</span></div>' +
            '<div class="prow"><span class="k" style="font-size:var(--text-xs)">You committed one token, so this mints a tight band adjacent to the current price instead of a straddle. Add both tokens for a true straddle.</span></div>'
          : '<div class="prow"><span class="k">Band around price</span><span class="v">±' + band.toFixed(0) + '%</span></div>';
        $('pv').innerHTML =
          bandLabel +
          '<div class="prow"><span class="k">' + esc(S.info.symbol) + ' side</span><span class="v">' + fmtTok(vt) + ' ≈ ' + fmtUsd(vt * (st.priceUsd || 0)) + '</span></div>' +
          '<div class="prow"><span class="k">ETH side</span><span class="v">' + ve.toFixed(4) + ' ETH ≈ ' + fmtUsd(ve * (st.ethUsd || 0)) + '</span></div>' +
          '<div class="prow"><span class="k">Transactions you will sign</span><span class="v">' + (plan.txs.length + (isOperator() ? 0 : 1)) + '</span></div>' +
          '<div class="prow"><span class="k" style="font-size:var(--text-xs)">The pool takes what the math allows; any unused WETH stays in your wallet as WETH.</span></div>';
        var bad = null;
        if (vt > bal.token) bad = 'You only hold ' + fmtTok(bal.token) + ' ' + S.info.symbol + '.';
        var need = Math.max(0, ve - weth) + feeEthCost(quote) + 0.001;
        if (need > bal.eth) bad = 'You need ~' + need.toFixed(4) + ' ETH (amount + fee + gas) but hold ' + bal.eth.toFixed(4) + (weth > 0 ? ' (your ' + weth.toFixed(4) + ' WETH is already counted)' : '') + '.';
        if (bad) { $('mErr').innerHTML = '<div class="banner err">' + esc(bad) + '</div>'; $('goBtn').disabled = true; }
        else { $('mErr').innerHTML = ''; $('goBtn').disabled = false; }
      } catch (e) { $('pv').innerHTML = '<div class="prow"><span class="k">' + esc(e.message) + '</span></div>'; $('goBtn').disabled = true; }
    }
    $('amtTok').addEventListener('input', refresh);
    $('amtEth').addEventListener('input', refresh);
    var pc = $('payChoice');
    if (pc) Array.prototype.forEach.call(pc.querySelectorAll('.opt'), function (o) { o.addEventListener('click', refresh); });
    refresh();
    $('goBtn').addEventListener('click', function () {
      var vt = parseFloat($('amtTok').value) || 0;
      var ve = parseFloat($('amtEth').value) || 0;
      var plan = L.planStraddle(S.state, String(vt), String(ve), S.wallet.addr, undefined, weth.toFixed(18));
      execute('Tighten spread — ' + S.info.symbol, feeTxs(quote).concat(plan.txs));
    });
  }

  /* ---------------- move: collect (free) ---------------- */
  function openCollect() {
    if (!walletGate()) return;
    var st = S.state;
    var plan = L.planCollect(st, S.wallet.addr);
    if (!plan.txs.length) {
      openModal('<h3>Nothing to collect</h3><p class="msub">No unclaimed fees on your positions in this pool.</p><button class="btn btn-ghost btn-lg" id="mClose">Close</button>');
      $('mClose').addEventListener('click', closeModal);
      return;
    }
    openModal(
      '<h3>Collect your earned fees</h3>' +
      '<p class="msub">Free — unclaimed fees from every matching position are pulled in <strong>one</strong> Uniswap multicall. You sign once; fees land in your wallet.</p>' +
      '<div class="preview">' +
      '<div class="prow"><span class="k">Unclaimed</span><span class="v">' + fmtTok(st.positions.feesToken) + ' ' + esc(S.info.symbol) + ' + ' + st.positions.feesEth.toFixed(5) + ' ETH</span></div>' +
      '<div class="prow"><span class="k">Positions</span><span class="v">' + (plan.summary.count || plan.txs.length) + '</span></div>' +
      '<div class="prow"><span class="k">Transactions you will sign</span><span class="v">' + plan.txs.length + '</span></div></div>' +
      '<button class="btn btn-primary btn-lg" id="goBtn" data-testid="button-execute">Collect — free (1 tx)</button>' +
      '<button class="btn btn-ghost btn-lg" id="mClose" style="margin-top:8px">Cancel</button>'
    );
    $('mClose').addEventListener('click', closeModal);
    $('goBtn').addEventListener('click', function () { execute('Collect fees — ' + S.info.symbol, plan.txs); });
  }

  /* ---------------- move: exit LP (free) ---------------- */
  function openExit(tokenIds) {
    if (!walletGate()) return;
    var st = S.state;
    var plan = L.planExitPositions(st, S.wallet.addr, tokenIds ? { tokenIds: tokenIds } : {});
    if (!plan.txs.length) {
      openModal('<h3>Nothing to withdraw</h3><p class="msub">No live liquidity in your positions for this pool.</p><button class="btn btn-ghost btn-lg" id="mClose">Close</button>');
      $('mClose').addEventListener('click', closeModal);
      return;
    }
    var ids = (plan.summary.tokenIds || []).map(function (id) { return '#' + id; }).join(', ');
    openModal(
      '<h3>Withdraw from LP</h3>' +
      '<p class="msub">Removes <strong>all</strong> liquidity from ' + plan.summary.count +
      ' position' + (plan.summary.count === 1 ? '' : 's') +
      ' (' + esc(ids) + ') and sends the tokens to your wallet. Free — one Uniswap multicall. WETH may show as wrapped ETH until you unwrap.</p>' +
      '<div class="preview">' +
      '<div class="prow"><span class="k">NFTs</span><span class="v mono">' + esc(ids) + '</span></div>' +
      '<div class="prow"><span class="k">You sign</span><span class="v">1 transaction</span></div>' +
      '<div class="prow"><span class="k">Custody</span><span class="v">You keep the empty NFT; capital returns to you</span></div></div>' +
      '<button class="btn btn-primary btn-lg" id="goBtn" data-testid="button-execute-exit">Withdraw to wallet</button>' +
      '<button class="btn btn-ghost btn-lg" id="mClose" style="margin-top:8px">Cancel</button>'
    );
    $('mClose').addEventListener('click', closeModal);
    $('goBtn').addEventListener('click', function () {
      execute('Withdraw LP — ' + S.info.symbol, plan.txs, function () {
        return '<div class="banner ok">Liquidity withdrawn. Tokens are in your wallet — refresh the reading to confirm.</div>';
      });
    });
  }

  /* ---------------- move: Super Chain launch (manual OFT mesh) ---------------- */
  function openOmni() {
    if (!walletGate()) return;
    openModal('<h3>Loading…</h3><div class="skel" style="height:16px;margin:12px 0"></div>');
    Promise.all([L.quoteFee(read, S.ethUsd), balances()]).then(function (r) {
      var quote = r[0], bal = r[1];
      openModal(
        '<h3>Super Chain launch</h3>' +
        '<p class="msub">One token, many chains — designed that way from the start. We deploy a LayerZero OFT mesh (the same standard MCFL uses) with peers on <strong>Solana + Base + Robinhood Chain</strong> wired before public trading, so you never end up with orphan Smithii/pump mints to merge later. Includes Robinhood app listing guidance. <strong>Delivered within 72 hours of payment, or the fee is refunded on-chain — the receipt below is your proof.</strong></p>' +
        '<div class="preview">' +
        '<div class="prow"><span class="k">You get</span><span class="v">OFT on Solana · Base · RH + listing guidance</span></div>' +
        '<div class="prow"><span class="k">Design rule</span><span class="v">One supply · peers before the crowd</span></div>' +
        '<div class="prow"><span class="k">Turnaround</span><span class="v">≤ 72 hours or refunded</span></div></div>' +
        feeSection(quote, bal) +
        '<div id="mErr"></div>' +
        '<button class="btn btn-primary btn-lg" id="goBtn" data-testid="button-execute">' + (isOperator() ? 'Operator — email us directly' : 'Pay $25 & request') + '</button>' +
        '<button class="btn btn-ghost btn-lg" id="mClose" style="margin-top:8px">Cancel</button>'
      );
      wirePayChoice();
      $('mClose').addEventListener('click', closeModal);
      $('goBtn').addEventListener('click', function () {
        var txs = feeTxs(quote);
        if (!txs.length) { $('mErr').innerHTML = '<div class="banner warn">Operator wallet — nothing to pay. Email us directly.</div>'; return; }
        execute('Super Chain launch — ' + S.info.symbol, txs, function (hashes) {
          var mail = 'mailto:erik@mcflamingo.com?subject=' + encodeURIComponent('Super Chain launch: ' + S.info.symbol) +
            '&body=' + encodeURIComponent(
              'Super Chain launch request\n\n' +
              'Token (current / home): ' + S.info.token + '\n' +
              'Symbol: ' + S.info.symbol + '\n' +
              'Payment tx: ' + explorerTx(hashes[0]) + '\n' +
              'Wallet: ' + S.wallet.addr + '\n\n' +
              'Requested peers: Solana + Base + Robinhood Chain\n' +
              'Canonical home chain (if known): \n' +
              'Anything else we should know:\n'
            );
          return '<div class="banner ok">Paid. Now send us the receipt so the clock starts: <a href="' + mail + '" style="color:var(--accent);font-weight:700">email your Super Chain request</a> — it is pre-filled with your payment link.</div>';
        });
      });
    });
  }

  /* ---------------- execute a tx sequence ---------------- */
  function execute(title, txs, afterHtml) {
    if (!txs.length) return;
    S.busy = true;
    function contractName(addr) {
      var a = (addr || '').toLowerCase();
      if (a === CFG.NPM) return 'Uniswap position manager';
      if (a === CFG.WETH) return 'WETH';
      if (a === CFG.MCFL) return 'MCFL token';
      if (S.info && a === S.info.token.toLowerCase()) return S.info.symbol + ' token';
      return 'contract';
    }
    function shortAddr(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
    var stepsHtml = txs.map(function (t, i) {
      return '<div class="step" id="step' + i + '"><span class="dot">' + (i + 1) + '</span><span class="lbl">' + esc(t.label) +
        '<a class="to" href="' + CFG.EXPLORER + '/address/' + esc(t.to) + '" target="_blank" rel="noopener">→ ' + esc(contractName(t.to)) + ' · ' + esc(shortAddr(t.to)) + '</a></span></div>';
    }).join('');
    openModal('<h3>' + esc(title) + '</h3><p class="msub">Confirm each transaction in your wallet. Nothing moves without your signature. <strong>Check the “to” address in your wallet matches each step below</strong> — that is your proof nothing else is being signed.</p><div class="steps">' + stepsHtml + '</div><div id="execFoot"></div>');

    var signer = S.wallet.provider.getSigner();
    var hashes = [];
    var chain = ensureChain();
    txs.forEach(function (t, i) {
      chain = chain.then(function () {
        var el = $('step' + i);
        el.classList.add('active');
        // Mints re-read the live pool price right before signing so the slippage
        // guard is computed against NOW, not against when the plan was built.
        var prep = Promise.resolve(t.data);
        if (t.mintParams) {
          var wrapRefund = t.data.slice(0, 10) === '0xac9650d8'; // multicall (fee payment carries refundETH)
          prep = L.refreshMintTx(S.info, t.mintParams, wrapRefund).then(function (r) {
            if (!r.ok) throw new Error(r.reason);
            return r.data;
          });
        }
        return prep.then(function (data) {
          return signer.sendTransaction({ to: t.to, data: data, value: t.value || '0x0' });
        }).then(function (resp) {
          hashes.push(resp.hash);
          el.innerHTML += '<a href="' + explorerTx(resp.hash) + '" target="_blank" rel="noopener">view tx</a>';
          return read.waitForTransaction(resp.hash, 1, 180000).then(function (rc) {
            if (!rc || rc.status !== 1) throw new Error('Transaction reverted on-chain.');
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
      S.receipts.unshift({ title: title, when: new Date(), hashes: hashes.slice() });
      renderReceipts();
      var extra = afterHtml ? afterHtml(hashes) : '';
      $('execFoot').innerHTML =
        '<div class="banner ok">Done. Everything confirmed on-chain.</div>' + extra +
        '<button class="btn btn-primary btn-lg" id="doneBtn" style="margin-top:12px">See updated pool state</button>';
      $('doneBtn').addEventListener('click', function () { closeModal(); loadState(); });
    }).catch(function (e) {
      S.busy = false;
      var msg = (e && (e.reason || (e.data && e.data.message) || e.message)) || String(e);
      if (msg.length > 220) msg = msg.slice(0, 220) + '…';
      var paid = hashes.length ? '<div class="banner warn">Signed so far: ' + hashes.map(function (h, i) { return '<a href="' + explorerTx(h) + '" target="_blank" rel="noopener" style="color:var(--accent)">tx ' + (i + 1) + '</a>'; }).join(' · ') + '</div>' : '';
      $('execFoot').innerHTML =
        '<div class="banner err">Stopped: ' + esc(msg) + '</div>' + paid +
        '<div class="banner warn">If a fee was paid but the move did not complete, message us with the tx link — we refund on-chain, no questions.</div>' +
        '<button class="btn btn-ghost btn-lg" id="doneBtn" style="margin-top:12px">Close</button>';
      $('doneBtn').addEventListener('click', function () { closeModal(); loadState(); });
    });
  }

  /* ---------------- receipts ---------------- */
  function renderReceipts() {
    if (!S.receipts.length) { $('historyCard').classList.add('hidden'); return; }
    $('historyCard').classList.remove('hidden');
    $('receipts').innerHTML = S.receipts.map(function (r) {
      return '<div class="receipt"><div class="rt"><span>' + esc(r.title) + '</span><span class="when">' + r.when.toLocaleTimeString() + '</span></div>' +
        r.hashes.map(function (h, i) { return '<a href="' + explorerTx(h) + '" target="_blank" rel="noopener">tx ' + (i + 1) + ': ' + h.slice(0, 18) + '…</a><br>'; }).join('') + '</div>';
    }).join('');
  }

  /* ---------------- fund RH: orphan Solana → Jupiter → bridge ETH ---------------- */
  function isSolMint(s) {
    s = String(s || '').trim();
    if (s.length < 32 || s.length > 44) return false;
    return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
  }
  function openOrphanSolOnJupiter() {
    var mint = ($('solMintInput') && $('solMintInput').value || '').trim();
    var err = $('solMintErr');
    if (!err) return;
    if (!isSolMint(mint)) {
      err.classList.remove('hidden');
      err.textContent = 'Paste a Solana mint (base58, 32–44 chars). Orphan tokens cannot teleport 1:1 to Robinhood.';
      return;
    }
    err.classList.add('hidden');
    err.textContent = '';
    window.open('https://jup.ag/swap/' + encodeURIComponent(mint) + '-SOL', '_blank', 'noopener');
  }
  if ($('solSellBtn')) {
    $('solSellBtn').addEventListener('click', openOrphanSolOnJupiter);
  }
  if ($('solMintInput')) {
    $('solMintInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') openOrphanSolOnJupiter();
    });
  }

  /* ---------------- boot ---------------- */
  updateWalletBtn();
  if (!S.wallet.addr) {
    showNotConnectedBanner('<strong>Not connected.</strong> ' + (hasWallet()
      ? 'Tap <strong>Connect wallet</strong> to share your address. Pool checks work either way.'
      : noWalletHelp()));
  }
  var h = (location.hash || '').slice(1);
  if (h === 'fundCard' || h === 'fund') {
    var fc = $('fundCard');
    if (fc) fc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (/^0x[0-9a-fA-F]{40}$/.test(h)) loadToken(h);
})();
