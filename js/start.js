/* Start your token — reality desk. Platform fees in MCFL only. */
(function () {
  'use strict';
  var L = window.ChainLib;
  var CFG = L.CFG;
  var read = L.getProvider();
  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'poolpilot_start_stage_v1';
  var ACK_KEY = 'poolpilot_start_acks_v1';

  var LINKS = {
    uniswapMcfl: 'https://app.uniswap.org/swap?chain=robinhood&inputCurrency=NATIVE&outputCurrency=0x21a91215fbfc4fc002b07cc87698a6fc01aed523',
    jupiterMcfl: 'https://jup.ag/swap/SOL-CdmKJqhHEkqTr1BFBdcoBNHQvh2BEqLap6ivt2b2pump',
    mcflExplorer: CFG.EXPLORER + '/token/' + CFG.MCFL,
    poolPilot: 'index.html',
    builders: 'builders.html',
    coingeckoRequest: 'https://www.coingecko.com/en/coins/new',
    coingeckoSupport: 'https://support.coingecko.com/hc/en-us',
    discordCreate: 'https://support.discord.com/hc/en-us/articles/204849977-How-do-I-create-a-server',
    discordSafety: 'https://discord.com/safety',
    telegramApps: 'https://desktop.telegram.org/',
    telegramBots: 'https://core.telegram.org/bots',
    xHelp: 'https://help.x.com/en/using-x',
    printify: 'https://printify.com/',
    shopify: 'https://www.shopify.com/',
    gemini: 'https://gemini.google.com/app',
    rhBridge: 'https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain',
    jumperRh: 'https://jumper.xyz/?toChain=4663',
    relayRh: 'https://relay.link/bridge?toChainId=4663',
    jupiterSwap: 'https://jup.ag/swap/SOL',
    fundRh: 'index.html#fundCard',
    solanaMint: 'https://solscan.io/token/CdmKJqhHEkqTr1BFBdcoBNHQvh2BEqLap6ivt2b2pump'
  };

  var FEES = {
    desk: { id: 'desk', usd: 50, title: 'Unlock Start Desk', desc: 'Stage + full module access confirmation · paid in MCFL' },
    buybot: { id: 'buybot', usd: 50, title: 'Telegram buy bot setup', desc: 'We wire a buy bot for your TG · paid in MCFL · never pay random DMs' },
    marketer: { id: 'marketer', usd: 200, title: 'Marketing intro', desc: 'Pay $200 in MCFL · we forward your Stage pack to the marketer' }
  };

  var S = {
    ethUsd: null,
    wallet: { addr: null, chainOk: false },
    mcflBal: null,
    busy: false,
    paid: { desk: false, buybot: false, marketer: false }
  };

  /* ---------------- theme: inherit system via styles.css vars; light default from index pattern ---------------- */
  var theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
  function explorerTx(h) { return CFG.EXPLORER + '/tx/' + h; }

  /* ---------------- stage ---------------- */
  var STAGE_FIELDS = ['fName', 'fTicker', 'fTagline', 'fUse', 'fBlurb', 'fLong', 'fLogo', 'fSite', 'fPaper', 'fX', 'fTg', 'fDisc', 'fContracts', 'fNotes'];

  function readStage() {
    var o = {};
    STAGE_FIELDS.forEach(function (id) {
      var el = $(id);
      o[id] = el ? el.value.trim() : '';
    });
    return o;
  }
  function writeStage(o) {
    if (!o) return;
    STAGE_FIELDS.forEach(function (id) {
      if ($(id) && o[id] != null) $(id).value = o[id];
    });
  }
  function saveStage() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(readStage()));
      $('stageNote').textContent = 'Stage saved on this device.';
    } catch (e) {
      $('stageNote').textContent = 'Could not save locally.';
    }
  }
  function loadStage() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) writeStage(JSON.parse(raw));
    } catch (e) { /* ignore */ }
  }
  function listingPacket() {
    var s = readStage();
    return [
      'TOKEN LISTING PACKET — Pool Pilot Stage',
      'Name: ' + s.fName,
      'Symbol: ' + s.fTicker,
      'Tagline: ' + s.fTagline,
      'Why it exists: ' + s.fUse,
      '',
      'Short blurb:',
      s.fBlurb,
      '',
      'Long description:',
      s.fLong,
      '',
      'Logo: ' + s.fLogo,
      'Website: ' + s.fSite,
      'White paper: ' + s.fPaper,
      'X: ' + s.fX,
      'Telegram: ' + s.fTg,
      'Discord: ' + s.fDisc,
      '',
      'Contracts:',
      s.fContracts,
      '',
      'MCFL (platform fee token, Robinhood): ' + CFG.MCFL,
      'Generated from Pool Pilot — Start your token (poolpilot.xyz/start)'
    ].join('\n');
  }

  /* ---------------- acks ---------------- */
  function loadAcks() {
    try {
      var a = JSON.parse(localStorage.getItem(ACK_KEY) || '{}');
      if (a.liq) $('liqAck').checked = true;
      if (a.liability) {
        $('liabilityAck').checked = true;
        $('liabilityType').value = 'I UNDERSTAND';
      }
      if (a.paid) S.paid = Object.assign(S.paid, a.paid);
    } catch (e) { /* ignore */ }
  }
  function saveAcks() {
    try {
      localStorage.setItem(ACK_KEY, JSON.stringify({
        liq: $('liqAck').checked,
        liability: gatesOk(),
        paid: S.paid,
        at: Date.now(),
        wallet: S.wallet.addr || null
      }));
    } catch (e) { /* ignore */ }
  }
  function gatesOk() {
    return $('liqAck').checked &&
      $('liabilityAck').checked &&
      ($('liabilityType').value || '').trim().toUpperCase() === 'I UNDERSTAND';
  }

  /* ---------------- wallet ---------------- */
  var CHAIN_HEX = '0x1237';
  var eth = null;

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
  function requestAccounts(provider, attempt) {
    attempt = attempt || 0;
    return provider.request({ method: 'eth_accounts' }).then(function (existing) {
      if (existing && existing[0]) return existing;
      return provider.request({ method: 'eth_requestAccounts' });
    }).catch(function (e) {
      if (isUnlockBusy(e) && attempt < 4) {
        setWalletUi('warn', 'Unlock wallet…', 'Waiting for wallet…');
        showNotConnectedBanner('<strong>Waiting for your wallet.</strong> Finish Unlock/Connect in the extension popup — retrying automatically…');
        return sleep(1400 + attempt * 400).then(function () {
          return requestAccounts(provider, attempt + 1);
        });
      }
      throw e;
    });
  }
  function noWalletHelp() {
    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    if (mobile) {
      return 'Phone browser has no wallet plugin. Tap <strong>Connect wallet</strong> for open-in-wallet links.';
    }
    return 'No wallet found in this window. Open <strong>poolpilot.xyz/start</strong> in a desktop browser with any injected wallet.';
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
    }
  }
  function updateWalletBtn() {
    if (!S.wallet.addr) {
      setWalletUi('off', 'Not connected', 'Connect wallet');
      return;
    }
    var addr = short(S.wallet.addr);
    if (S.wallet.chainOk === false) setWalletUi('warn', 'Wrong network', addr);
    else setWalletUi('on', 'Connected', addr);
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
      ' <button type="button" id="disconnectBtnInline" style="margin-left:8px;color:var(--accent);background:none;border:none;font-weight:700;cursor:pointer;font-family:var(--font-body);font-size:var(--text-sm)">Disconnect</button>';
    b.classList.remove('hidden');
    var d = $('disconnectBtnInline');
    if (d) d.addEventListener('click', disconnectWallet);
  }
  function disconnectWallet() {
    S.wallet.addr = null;
    S.wallet.chainOk = false;
    eth = null;
    updateWalletBtn();
    showNotConnectedBanner('<strong>Not connected.</strong> Tap <strong>Connect wallet</strong> to share your address.');
    closeModal();
  }
  function openConnectedSheet() {
    openModal(
      '<h3>Wallet connected</h3>' +
      '<p class="msub">Status: <strong>' + (S.wallet.chainOk ? 'Connected · Robinhood Chain' : 'Connected · wrong network') + '</strong></p>' +
      '<div class="prow"><span class="k">Address</span><span class="v mono" style="word-break:break-all">' + esc(S.wallet.addr) + '</span></div>' +
      (S.wallet.chainOk ? '' : '<button class="btn btn-primary btn-lg" id="switchRhBtn" style="margin-top:8px">Switch to Robinhood Chain</button>') +
      '<button class="btn btn-ghost btn-lg" id="disconnectGo" style="margin-top:8px">Disconnect</button>' +
      '<button class="btn btn-ghost btn-lg" id="cxNo" style="margin-top:8px">Close</button>'
    );
    if ($('switchRhBtn')) {
      $('switchRhBtn').addEventListener('click', function () {
        ensureChain().then(function () {
          S.wallet.chainOk = true;
          updateWalletBtn();
          showConnectedBanner();
          refreshMcfl();
          closeModal();
        }).catch(function (e) {
          $('walletBanner').textContent = walletErrMsg(e);
          $('walletBanner').classList.remove('hidden');
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
    var mm = 'https://metamask.app.link/dapp/' + location.host + '/start';
    var cb = 'https://go.cb-w.com/dapp?cb_url=' + enc;
    var trust = 'https://link.trustwallet.com/open_url?coin_id=60&url=' + enc;
    openModal(
      '<h3>Wallet not connected</h3>' +
      '<p class="msub">Status: <strong>Not connected</strong>. ' +
      (isPhone() ? 'Open this page inside your wallet app.' : 'Install a browser wallet, then Connect.') + '</p>' +
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
            });
          }
          throw e;
        });
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
    setWalletUi('warn', 'Connecting…', 'Connecting…');
    connectInFlight = requestAccounts(provider).then(function (accts) {
      if (!accts || !accts[0]) throw new Error('No account returned from wallet.');
      S.wallet.addr = accts[0];
      S.wallet.chainOk = false;
      updateWalletBtn();
      return ensureChain().then(function () {
        S.wallet.chainOk = true;
        updateWalletBtn();
        showConnectedBanner();
        return refreshMcfl().then(function () { return true; });
      }).catch(function (e) {
        S.wallet.chainOk = false;
        updateWalletBtn();
        var b = $('walletBanner');
        b.className = 'banner warn';
        b.innerHTML = '<strong>Connected — wrong network.</strong> ' + esc(short(S.wallet.addr)) +
          ' needs Robinhood Chain (4663). ' + esc(walletErrMsg(e));
        b.classList.remove('hidden');
        return false;
      });
    }).catch(function (e) {
      updateWalletBtn();
      showNotConnectedBanner('<strong>Not connected.</strong> ' + esc(walletErrMsg(e)));
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
      '<p class="msub">Any injected browser wallet works. Pick the one you want — Pool Pilot never defaults to a specific account.</p>' +
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

  function refreshMcfl() {
    if (!S.wallet.addr) return Promise.resolve();
    var c = new ethers.Contract(CFG.MCFL, ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'], read);
    return Promise.all([c.balanceOf(S.wallet.addr), c.decimals()]).then(function (r) {
      S.mcflBal = parseFloat(ethers.utils.formatUnits(r[0], r[1]));
      var el = $('mcflBal');
      el.textContent = 'MCFL balance: ' + S.mcflBal.toLocaleString(undefined, { maximumFractionDigits: 2 });
      el.classList.remove('hidden');
    }).catch(function () { /* ignore */ });
  }

  /* ---------------- modal / execute ---------------- */
  function openModal(html) { $('modal').innerHTML = html; $('overlay').classList.add('open'); }
  function closeModal() { if (!S.busy) $('overlay').classList.remove('open'); }
  $('overlay').addEventListener('click', function (e) { if (e.target === $('overlay')) closeModal(); });

  function sendTx(tx) {
    var p = getEth();
    if (!p) return Promise.reject(new Error('No wallet provider'));
    return ensureChain().then(function () {
      return p.request({
        method: 'eth_sendTransaction',
        params: [{
          from: S.wallet.addr,
          to: tx.to,
          data: tx.data,
          value: tx.value || '0x0'
        }]
      });
    });
  }

  /* ---------------- Get MCFL ---------------- */
  function openGetMcfl() {
    openModal(
      '<h3>Get MCFL</h3>' +
      '<p class="msub">Platform fees are paid in MCFL on Robinhood Chain. Buy here with ETH (you sign), or open Uniswap / Jupiter.</p>' +
      '<div class="field"><label for="buyEthAmt">ETH to spend</label>' +
      '<input id="buyEthAmt" value="0.01" inputmode="decimal" data-testid="input-buy-eth">' +
      '<div class="hint">Quoted live from the MCFL/WETH pool · 5% min-out slippage</div></div>' +
      '<div id="buyQuote" class="preview"><div class="prow"><span class="k">Quote</span><span class="v">—</span></div></div>' +
      '<div id="buyErr"></div>' +
      '<button class="btn btn-primary btn-lg" id="buyQuoteBtn" data-testid="button-quote-mcfl">Refresh quote</button>' +
      '<button class="btn btn-primary btn-lg" id="buyGoBtn" style="margin-top:8px" data-testid="button-buy-mcfl">Buy MCFL in wallet</button>' +
      '<a class="btn btn-ghost btn-lg" style="margin-top:8px;display:block;text-align:center" href="' + LINKS.uniswapMcfl + '" target="_blank" rel="noopener" data-testid="link-uniswap-mcfl">Open Uniswap (ETH → MCFL)</a>' +
      '<a class="btn btn-ghost btn-lg" style="margin-top:8px;display:block;text-align:center" href="' + LINKS.jupiterMcfl + '" target="_blank" rel="noopener" data-testid="link-jupiter-mcfl">Open Jupiter (Solana MCFL)</a>' +
      '<a class="btn btn-ghost btn-lg" style="margin-top:8px;display:block;text-align:center" href="' + LINKS.rhBridge + '" target="_blank" rel="noopener">Bridge ETH to Robinhood Chain</a>' +
      '<button class="btn btn-ghost btn-lg" id="mClose" style="margin-top:8px">Close</button>'
    );
    $('mClose').addEventListener('click', closeModal);
    var plan = null;
    function refreshQuote() {
      $('buyErr').innerHTML = '';
      var amt = $('buyEthAmt').value;
      try {
        L.planBuyMcfl(read, amt).then(function (p) {
          plan = p;
          $('buyQuote').innerHTML =
            '<div class="prow"><span class="k">You spend</span><span class="v">' + p.ethInF.toFixed(5) + ' ETH</span></div>' +
            '<div class="prow"><span class="k">You get ~</span><span class="v">' + Math.round(p.amountOutF).toLocaleString() + ' MCFL</span></div>';
        }).catch(function (e) {
          plan = null;
          $('buyErr').innerHTML = '<div class="banner err">' + esc((e && e.message) || e) + '</div>';
        });
      } catch (e) {
        $('buyErr').innerHTML = '<div class="banner err">' + esc(e.message || e) + '</div>';
      }
    }
    $('buyQuoteBtn').addEventListener('click', refreshQuote);
    refreshQuote();
    $('buyGoBtn').addEventListener('click', function () {
      if (!plan) { refreshQuote(); return; }
      connect().then(function (ok) {
        if (!ok) return;
        S.busy = true;
        $('buyGoBtn').textContent = 'Confirm in wallet…';
        var tx = plan.buildTx(S.wallet.addr);
        sendTx(tx).then(function (hash) {
          S.busy = false;
          openModal(
            '<h3>MCFL buy submitted</h3>' +
            '<p class="msub"><a href="' + explorerTx(hash) + '" target="_blank" rel="noopener">' + short(hash) + '</a></p>' +
            '<button class="btn btn-primary btn-lg" id="mClose">Done</button>'
          );
          $('mClose').addEventListener('click', closeModal);
          refreshMcfl();
        }).catch(function (e) {
          S.busy = false;
          $('buyErr').innerHTML = '<div class="banner err">' + esc((e && e.message) || e) + '</div>';
          $('buyGoBtn').textContent = 'Buy MCFL in wallet';
        });
      });
    });
  }

  /* ---------------- pay fee in MCFL ---------------- */
  function payUsd(feeKey) {
    var fee = FEES[feeKey];
    if (!fee) return;
    if (!gatesOk()) {
      openModal('<h3>Complete the gates first</h3><p class="msub">Liquidity acknowledgment + liability (“I UNDERSTAND”) are required before platform payments.</p><button class="btn btn-ghost btn-lg" id="mClose">Close</button>');
      $('mClose').addEventListener('click', closeModal);
      return;
    }
    connect().then(function (ok) {
      if (!ok) return;
      openModal('<h3>Loading MCFL quote…</h3><div class="skel" style="height:16px;margin:12px 0"></div>');
      Promise.all([
        S.ethUsd != null ? Promise.resolve(S.ethUsd) : L.fetchEthUsd(),
        refreshMcfl()
      ]).then(function (r) {
        S.ethUsd = r[0];
        return L.quoteFeeUsd(read, S.ethUsd, fee.usd);
      }).then(function (quote) {
        var need = quote.mcflAmountF;
        var have = S.mcflBal || 0;
        var shortfall = have < need;
        openModal(
          '<h3>' + esc(fee.title) + '</h3>' +
          '<p class="msub">' + esc(fee.desc) + '</p>' +
          '<div class="preview">' +
          '<div class="prow"><span class="k">USD</span><span class="v">$' + fee.usd + '</span></div>' +
          '<div class="prow"><span class="k">MCFL to pay</span><span class="v">' + Math.round(need).toLocaleString() + '</span></div>' +
          '<div class="prow"><span class="k">Your MCFL</span><span class="v">' + have.toLocaleString(undefined, { maximumFractionDigits: 2 }) + '</span></div>' +
          '</div>' +
          (shortfall ? '<div class="banner warn">Not enough MCFL — use Get MCFL, then come back.</div>' : '') +
          '<div id="payModalErr"></div>' +
          (shortfall
            ? '<button class="btn btn-primary btn-lg" id="needMcflBtn">Get MCFL</button>'
            : '<button class="btn btn-primary btn-lg" id="payGoBtn" data-testid="button-pay-' + fee.id + '">Pay ' + Math.round(need).toLocaleString() + ' MCFL</button>') +
          '<button class="btn btn-ghost btn-lg" id="mClose" style="margin-top:8px">Cancel</button>'
        );
        $('mClose').addEventListener('click', closeModal);
        if (shortfall) {
          $('needMcflBtn').addEventListener('click', openGetMcfl);
          return;
        }
        $('payGoBtn').addEventListener('click', function () {
          S.busy = true;
          $('payGoBtn').textContent = 'Confirm in wallet…';
          var tx = L.payFeeWithMcflTx(quote);
          sendTx(tx).then(function (hash) {
            S.busy = false;
            S.paid[fee.id] = true;
            saveAcks();
            renderPays();
            renderModules();
            var extra = '';
            if (fee.id === 'marketer') {
              saveStage();
              var body = 'Marketing intro — Stage pack attached below.\n\nWallet: ' + S.wallet.addr +
                '\nPayment: ' + explorerTx(hash) + '\n\n' + listingPacket();
              var mail = 'mailto:erik@mcflamingo.com?subject=' + encodeURIComponent('Marketer intro: ' + (readStage().fTicker || 'token')) +
                '&body=' + encodeURIComponent(body);
              extra = '<div class="banner ok">Paid. <a href="' + mail + '">Email Stage pack to start the intro</a> (pre-filled).</div>';
            } else if (fee.id === 'buybot') {
              var mail2 = 'mailto:erik@mcflamingo.com?subject=' + encodeURIComponent('TG buy bot: ' + (readStage().fTicker || 'token')) +
                '&body=' + encodeURIComponent('TG: ' + readStage().fTg + '\nWallet: ' + S.wallet.addr + '\nTx: ' + explorerTx(hash) + '\n\n' + listingPacket());
              extra = '<div class="banner ok">Paid. <a href="' + mail2 + '">Email TG + Stage for buy bot setup</a>.</div>';
            } else {
              extra = '<div class="banner ok">Desk unlocked. Work the modules below.</div>';
            }
            openModal(
              '<h3>Payment sent</h3>' +
              '<p class="msub"><a href="' + explorerTx(hash) + '" target="_blank" rel="noopener">' + short(hash) + '</a></p>' +
              extra +
              '<button class="btn btn-primary btn-lg" id="mClose" style="margin-top:12px">Done</button>'
            );
            $('mClose').addEventListener('click', closeModal);
            refreshMcfl();
            var box = $('payReceipts');
            box.innerHTML += '<div>' + esc(fee.title) + ' · <a href="' + explorerTx(hash) + '" target="_blank" rel="noopener">' + short(hash) + '</a></div>';
          }).catch(function (e) {
            S.busy = false;
            $('payModalErr').innerHTML = '<div class="banner err">' + esc((e && e.message) || e) + '</div>';
            $('payGoBtn').textContent = 'Pay ' + Math.round(need).toLocaleString() + ' MCFL';
          });
        });
      }).catch(function (e) {
        openModal('<h3>Could not quote</h3><p class="msub">' + esc((e && e.message) || e) + '</p><button class="btn btn-ghost btn-lg" id="mClose">Close</button>');
        $('mClose').addEventListener('click', closeModal);
      });
    });
  }

  /* ---------------- modules ---------------- */
  function modules() {
    return [
      {
        id: 'seed',
        tag: 'Required reality',
        title: 'Seed liquidity (50/50)',
        why: 'Your start money becomes half ETH and half token in the pool — you’re building the book. No real price until ETH fills the seed target. Serious floor ~$5k–$15k concentrated near spot.',
        actions: [
          { label: 'Open Pool Pilot (seed / deepen book)', href: LINKS.poolPilot },
          { label: 'Bridge ETH · Jumper', href: LINKS.jumperRh, external: true },
          { label: 'Bridge ETH · Relay', href: LINKS.relayRh, external: true }
        ]
      },
      {
        id: 'orphan-sol',
        tag: 'Fund RH',
        title: 'Orphan Solana token → value on RH',
        why: 'A pump / Smithii mint with no Robinhood peer cannot teleport 1:1. Cash out on Jupiter (mint → SOL), then bridge ETH to chain 4663. Same value, usable for gas and LP. Super Chain is for launching OFT peers — not moving an existing orphan.',
        actions: [
          { label: 'Paste mint in Pool Pilot fund card', href: LINKS.fundRh },
          { label: 'Open Jupiter', href: LINKS.jupiterSwap, external: true },
          { label: 'Then bridge ETH · Jumper', href: LINKS.jumperRh, external: true }
        ]
      },
      {
        id: 'superchain',
        tag: 'Omnichain',
        title: 'Super Chain launch',
        why: 'One LayerZero OFT across Solana + Base + Robinhood before the crowd — no orphan Smithii/pump mints. Hand-delivered concierge lives in Pool Pilot after you have a RH pool to check.',
        actions: [
          { label: 'Super Chain playbook', href: LINKS.builders },
          { label: 'Request in Pool Pilot', href: LINKS.poolPilot + '#superchain' }
        ]
      },
      {
        id: 'useful',
        tag: 'Gate',
        title: 'Justify the push',
        why: 'Most tokens are not useful. If you cannot justify use, it is not worth the push. Memecoins need real marketing and dated products — not vibes alone.',
        actions: [
          { label: 'Edit “Why it exists” in Stage', href: '#stageCard' }
        ]
      },
      {
        id: 'discord',
        tag: 'Community',
        title: 'Discord',
        why: 'Use Discord for roles, announcements, support threads, and a home base — not a ghost server. Save owner login + 2FA in a password manager (note that in Stage notes — never paste passwords here).',
        actions: [
          { label: 'How to create a Discord server', href: LINKS.discordCreate, external: true },
          { label: 'Discord Safety Center', href: LINKS.discordSafety, external: true }
        ]
      },
      {
        id: 'telegram',
        tag: 'Community + bot',
        title: 'Telegram',
        why: 'Fast updates and optional buy bot. Telegram is full of scammers — anyone who DMs asking for money first is a red flag. Real help shows the service working before you pay. Pay for our buy bot only on this page in MCFL.',
        warn: 'Do not engage wallets/DMs that ask for funds first. Never seed-phrase. Our buy bot is +$50 MCFL below — not a random TG invoice.',
        actions: [
          { label: 'Get Telegram Desktop', href: LINKS.telegramApps, external: true },
          { label: 'Telegram bots docs', href: LINKS.telegramBots, external: true },
          { label: 'Pay $50 MCFL — buy bot', pay: 'buybot' }
        ]
      },
      {
        id: 'x',
        tag: 'Distribution',
        title: 'X (Twitter)',
        why: 'Distribution surface. Copy blurbs from Stage. Pin the one-liner. Don’t outsource the handle to strangers.',
        actions: [
          { label: 'X help center', href: LINKS.xHelp, external: true },
          { label: 'Copy listing packet', action: 'copyPacket' }
        ]
      },
      {
        id: 'listings',
        tag: 'Discovery',
        title: 'CoinGecko & explorers',
        why: 'Not a homepage link — the request flow plus your Stage packet (contracts, logo, socials). Approval is never guaranteed.',
        actions: [
          { label: 'CoinGecko — add / request coin', href: LINKS.coingeckoRequest, external: true },
          { label: 'CoinGecko support', href: LINKS.coingeckoSupport, external: true },
          { label: 'Copy listing packet', action: 'copyPacket' },
          { label: 'MCFL on Blockscout (example token page)', href: LINKS.mcflExplorer, external: true }
        ]
      },
      {
        id: 'commerce',
        tag: 'Products',
        title: 'Printify · Shopify · content',
        why: 'Memecoins need scheduled products. Link merch (Printify), a shop (Shopify), and content tools (e.g. Gemini). Put drop dates in Stage notes.',
        actions: [
          { label: 'Printify', href: LINKS.printify, external: true },
          { label: 'Shopify', href: LINKS.shopify, external: true },
          { label: 'Gemini (content)', href: LINKS.gemini, external: true }
        ]
      },
      {
        id: 'marketer',
        tag: 'Optional',
        title: 'Marketing intro',
        why: 'Pay $200 in MCFL here. We forward your Stage pack to the marketer. Ongoing weekly fees are between you and them — do not overpay strangers in DMs.',
        actions: [
          { label: 'Pay $200 MCFL — send to marketer', pay: 'marketer' }
        ]
      }
    ];
  }

  function renderModules() {
    var locked = !gatesOk();
    $('moduleList').innerHTML = modules().map(function (m) {
      var actions = m.actions.map(function (a) {
        if (a.pay) {
          return '<button class="btn btn-primary" data-pay="' + a.pay + '"' + (locked ? ' disabled' : '') + '>' + esc(a.label) + '</button>';
        }
        if (a.action === 'copyPacket') {
          return '<button class="btn btn-ghost" data-act="copyPacket">' + esc(a.label) + '</button>';
        }
        var ext = a.external ? ' target="_blank" rel="noopener"' : '';
        return '<a class="btn btn-ghost" href="' + esc(a.href) + '"' + ext + '>' + esc(a.label) + '</a>';
      }).join('');
      return '<article class="mod' + (locked ? ' locked' : '') + (S.paid[m.id] ? ' done' : '') + '" id="mod-' + m.id + '" data-testid="module-' + m.id + '">' +
        '<div class="tag">' + esc(m.tag) + '</div>' +
        '<h3>' + esc(m.title) + '</h3>' +
        '<p class="why">' + esc(m.why) + '</p>' +
        (m.warn ? '<div class="warn-tg">' + esc(m.warn) + '</div>' : '') +
        '<div class="mod-actions">' + actions + '</div></article>';
    }).join('');

    Array.prototype.forEach.call($('moduleList').querySelectorAll('[data-pay]'), function (b) {
      b.addEventListener('click', function () { payUsd(b.getAttribute('data-pay')); });
    });
    Array.prototype.forEach.call($('moduleList').querySelectorAll('[data-act="copyPacket"]'), function (b) {
      b.addEventListener('click', copyPacket);
    });
  }

  function renderPays() {
    $('payList').innerHTML = Object.keys(FEES).map(function (k) {
      var f = FEES[k];
      var done = S.paid[f.id];
      return '<div class="pay-row" data-testid="pay-row-' + f.id + '">' +
        '<div class="info"><div class="t">' + esc(f.title) + (done ? ' · paid' : '') + '</div>' +
        '<div class="d">' + esc(f.desc) + '</div></div>' +
        '<div class="price">$' + f.usd + ' in MCFL</div>' +
        (done
          ? '<span class="btn btn-ghost" style="pointer-events:none">Done</span>'
          : '<button class="btn btn-primary" data-pay="' + f.id + '">Pay in MCFL</button>') +
        '</div>';
    }).join('');
    Array.prototype.forEach.call($('payList').querySelectorAll('[data-pay]'), function (b) {
      b.addEventListener('click', function () { payUsd(b.getAttribute('data-pay')); });
    });
  }

  function copyPacket() {
    var text = listingPacket();
    function ok() { $('stageNote').textContent = 'Listing packet copied.'; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { $('stageNote').textContent = 'Copy failed — download JSON instead.'; }
      document.body.removeChild(ta);
    }
  }

  /* ---------------- wire UI ---------------- */
  $('walletBtn').addEventListener('click', function () {
    if (S.wallet.addr) openConnectedSheet();
    else connect();
  });
  $('getMcflBtn').addEventListener('click', openGetMcfl);
  $('scrollStageBtn').addEventListener('click', function () { $('stageCard').scrollIntoView({ behavior: 'smooth' }); });
  $('saveStageBtn').addEventListener('click', function () { saveStage(); saveAcks(); });
  $('copyPacketBtn').addEventListener('click', copyPacket);
  $('exportStageBtn').addEventListener('click', function () {
    saveStage();
    var blob = new Blob([JSON.stringify(readStage(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (readStage().fTicker || 'token') + '-stage.json';
    a.click();
    URL.revokeObjectURL(a.href);
    $('stageNote').textContent = 'Stage JSON downloaded.';
  });
  ['liqAck', 'liabilityAck', 'liabilityType'].forEach(function (id) {
    $(id).addEventListener('change', function () { saveAcks(); renderModules(); });
    $(id).addEventListener('input', function () { saveAcks(); renderModules(); });
  });

  loadStage();
  loadAcks();
  renderModules();
  renderPays();
  L.fetchEthUsd().then(function (u) { S.ethUsd = u; }).catch(function () { /* ignore */ });

  updateWalletBtn();
  if (!S.wallet.addr) {
    showNotConnectedBanner('<strong>Not connected.</strong> ' + (hasWallet()
      ? 'Tap <strong>Connect wallet</strong> to share your address.'
      : noWalletHelp()));
  }

  if (location.hash === '#get-mcfl') openGetMcfl();
})();
