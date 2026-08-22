/* Pool Pilot — $500 front-page featured token listing */
(function () {
  'use strict';
  var L = window.ChainLib;
  var P = window.PoolPilotPartner;
  var T = window.PoolPilotTokens;
  var CFG = L.CFG;
  var read = L.getProvider();
  var $ = function (id) { return document.getElementById(id); };

  var PRICE_USD = (window.RH_LISTING_PRICE_USD || (T && T.listingPriceUsd && T.listingPriceUsd()) || 500);
  var S = {
    wallet: { addr: null, provider: null, chainOk: false },
    ethUsd: null,
    busy: false
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function short(a) {
    if (!a) return '—';
    return a.slice(0, 6) + '…' + a.slice(-4);
  }
  function apiBase() {
    return P && P.apiBase ? P.apiBase() : location.origin;
  }
  function showErr(msg) {
    var b = $('errBanner');
    if (!msg) {
      b.classList.add('hidden');
      b.textContent = '';
      return;
    }
    b.textContent = msg;
    b.classList.remove('hidden');
  }
  function explorerTx(h) { return CFG.EXPLORER + '/tx/' + h; }

  function updateWalletBtn() {
    var b = $('walletBtn');
    if (!b) return;
    if (S.wallet.addr) {
      b.textContent = short(S.wallet.addr);
    } else {
      b.textContent = 'Connect';
    }
  }

  function connectWith(provider) {
    var wp = new ethers.providers.Web3Provider(provider, 'any');
    return wp.send('eth_requestAccounts', []).then(function (accs) {
      S.wallet.provider = wp;
      S.wallet.addr = accs && accs[0] ? ethers.utils.getAddress(accs[0]) : null;
      return wp.getNetwork().then(function (n) {
        S.wallet.chainOk = Number(n.chainId) === CFG.CHAIN_ID;
        updateWalletBtn();
        if (!S.wallet.chainOk) {
          return provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x' + CFG.CHAIN_ID.toString(16) }]
          }).then(function () {
            S.wallet.chainOk = true;
          }).catch(function () {
            showErr('Switch to Robinhood Chain (4663) in your wallet.');
          });
        }
      });
    });
  }

  function connect() {
    var eth = window.ethereum;
    if (!eth) {
      showErr('No wallet found. Install MetaMask or Rabby.');
      return Promise.reject(new Error('No wallet'));
    }
    var p = eth.providers && eth.providers.length
      ? (eth.providers.find(function (x) { return x.isRabby; }) || eth.providers[0])
      : eth;
    return connectWith(p);
  }

  function ethForListing() {
    if (!S.ethUsd || S.ethUsd <= 0) return null;
    return PRICE_USD / S.ethUsd;
  }

  function refreshPriceLine() {
    var eth = ethForListing();
    var line = $('priceLine');
    if (!line) return;
    if (eth == null) {
      line.innerHTML = 'Listing · <strong>$' + PRICE_USD + '</strong> · ETH amount loads with the feed…';
      return;
    }
    line.innerHTML =
      'Listing · <strong>$' + PRICE_USD + '</strong> ≈ <span class="mono">' +
      eth.toFixed(5) + ' ETH</span> (@ $' + Math.round(S.ethUsd) + '/ETH) → treasury';
  }

  function updateConfirm() {
    var slot = $('tokenConfirm');
    if (!slot || !T) return;
    var known = T.byAddress($('addr').value);
    if (!known) {
      slot.hidden = true;
      slot.innerHTML = '';
      return;
    }
    slot.hidden = false;
    slot.innerHTML = T.confirmHtml(known);
    if (!$('sym').value) $('sym').value = known.symbol;
  }

  function renderPaid(featured) {
    var box = $('paidChips');
    var empty = $('paidEmpty');
    if (!box) return;
    if (!featured || !featured.length) {
      box.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    box.innerHTML = featured.map(function (t) {
      return T ? T.chipHtml(t) : ('<span class="chip">' + esc(t.symbol) + '</span>');
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.chip[data-addr]'), function (c) {
      c.addEventListener('click', function () {
        location.href = '/#' + c.getAttribute('data-addr');
      });
    });
  }

  function loadListings() {
    return fetch(apiBase() + '/api/listings', {
      headers: { Accept: 'application/json' },
      mode: 'cors'
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.priceUsd) PRICE_USD = j.priceUsd;
        refreshPriceLine();
        renderPaid(j && j.featured);
      })
      .catch(function () { /* offline ok */ });
  }

  function registerListing(payload) {
    var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (window.POOL_PILOT_PARTNER_KEY) headers['X-Partner-Key'] = String(window.POOL_PILOT_PARTNER_KEY);
    return fetch(apiBase() + '/api/listings', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      mode: 'cors'
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, j: j }; });
    });
  }

  function payAndList() {
    showErr('');
    if (S.busy) return;
    var symbol = String($('sym').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    var address = String($('addr').value || '').trim();
    if (!symbol) {
      showErr('Enter a ticker symbol.');
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      showErr('Paste a valid token address (0x…).');
      return;
    }
    try { address = ethers.utils.getAddress(address); } catch (e) {
      showErr('Invalid checksum address.');
      return;
    }
    var eth = ethForListing();
    if (eth == null || eth <= 0) {
      showErr('ETH/USD price unavailable — wait a moment and try again.');
      return;
    }

    var go = function () {
      if (!S.wallet.chainOk) {
        showErr('Switch to Robinhood Chain (4663) first.');
        return;
      }
      S.busy = true;
      $('payBtn').disabled = true;
      $('payBtn').textContent = 'Confirm in wallet…';
      $('execBox').classList.remove('hidden');
      $('execBox').textContent = 'Sending ≈ ' + eth.toFixed(5) + ' ETH to treasury…';

      var value = ethers.utils.parseEther(eth.toFixed(8));
      var signer = S.wallet.provider.getSigner();
      signer.sendTransaction({
        to: CFG.TREASURY,
        value: value,
        data: '0x'
      }).then(function (resp) {
        $('execBox').innerHTML =
          'Tx <a href="' + esc(explorerTx(resp.hash)) + '" target="_blank" rel="noopener">' +
          esc(short(resp.hash)) + '</a> — waiting…';
        return read.waitForTransaction(resp.hash, 1, 180000).then(function (rc) {
          if (!rc || rc.status !== 1) throw new Error('Transaction reverted.');
          return resp.hash;
        });
      }).then(function (hash) {
        $('execBox').textContent = 'Registering featured listing…';
        return registerListing({
          address: address,
          symbol: symbol,
          wallet: S.wallet.addr,
          hash: hash,
          usd: PRICE_USD,
          eth: eth,
          note: 'featured-listing'
        }).then(function (reg) {
          if (!reg.j || !reg.j.ok) {
            throw new Error((reg.j && reg.j.error) || 'Payment landed but API failed — keep your tx hash.');
          }
          $('execBox').innerHTML =
            '<strong>Listed.</strong> Your chip is on the front page featured row. ' +
            '<a href="/#' + esc(address) + '">Open pool</a>';
          return loadListings();
        });
      }).catch(function (e) {
        showErr((e && e.message) || String(e));
      }).then(function () {
        S.busy = false;
        $('payBtn').disabled = false;
        $('payBtn').textContent = 'Pay $' + PRICE_USD + ' & list';
      });
    };

    if (!S.wallet.addr) {
      connect().then(go).catch(function (e) { showErr((e && e.message) || e); });
    } else go();
  }

  $('walletBtn').addEventListener('click', function () {
    connect().catch(function (e) { showErr((e && e.message) || e); });
  });
  $('payBtn').addEventListener('click', payAndList);
  $('addr').addEventListener('input', updateConfirm);
  $('sym').addEventListener('input', function () {
    $('sym').value = String($('sym').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  });

  L.fetchEthUsd().then(function (u) {
    S.ethUsd = u;
    refreshPriceLine();
  }).catch(function () { /* ignore */ });
  loadListings();
  updateConfirm();
})();
