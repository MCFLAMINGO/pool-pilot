/* Pool Pilot Shepherd — arm first-day launch guard */
(function () {
  'use strict';
  var L = window.ChainLib;
  var P = window.PoolPilotPartner;
  var CFG = L.CFG;
  var read = L.getProvider();
  var $ = function (id) { return document.getElementById(id); };
  var PRICE = 100;
  var S = { wallet: { addr: null, provider: null, chainOk: false }, ethUsd: null, busy: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function short(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : '—'; }
  function apiBase() { return P && P.apiBase ? P.apiBase() : location.origin; }
  function showErr(msg) {
    var b = $('errBanner');
    if (!msg) { b.classList.add('hidden'); b.textContent = ''; return; }
    b.textContent = msg; b.classList.remove('hidden');
  }
  function explorerTx(h) { return CFG.EXPLORER + '/tx/' + h; }

  function connect() {
    var eth = window.ethereum;
    if (!eth) { showErr('No wallet found.'); return Promise.reject(new Error('No wallet')); }
    var p = eth.providers && eth.providers.length
      ? (eth.providers.find(function (x) { return x.isRabby; }) || eth.providers[0])
      : eth;
    var wp = new ethers.providers.Web3Provider(p, 'any');
    return wp.send('eth_requestAccounts', []).then(function (accs) {
      S.wallet.provider = wp;
      S.wallet.addr = accs && accs[0] ? ethers.utils.getAddress(accs[0]) : null;
      $('walletBtn').textContent = short(S.wallet.addr);
      return wp.getNetwork().then(function (n) {
        S.wallet.chainOk = Number(n.chainId) === CFG.CHAIN_ID;
        if (!S.wallet.chainOk) {
          return p.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x' + CFG.CHAIN_ID.toString(16) }]
          }).then(function () { S.wallet.chainOk = true; });
        }
      });
    });
  }

  function refreshPrice() {
    var line = $('priceLine');
    if (!line) return;
    if (!S.ethUsd) {
      line.innerHTML = 'Arm · <strong>$' + PRICE + '</strong> · loading ETH price…';
      return;
    }
    var eth = PRICE / S.ethUsd;
    line.innerHTML = 'Arm · <strong>$' + PRICE + '</strong> ≈ ' + eth.toFixed(5) + ' ETH or ' + PRICE + ' USDG → buy MCFL for treasury';
  }

  function loadList() {
    return fetch(apiBase() + '/api/shepherds', { headers: { Accept: 'application/json' }, mode: 'cors' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.armPriceUsd) PRICE = j.armPriceUsd;
        refreshPrice();
        var box = $('list');
        if (!box) return;
        var rows = (j && j.shepherds) || [];
        if (!rows.length) {
          box.innerHTML = '<p class="muted">No shepherds armed yet.</p>';
          return;
        }
        box.innerHTML = rows.map(function (r) {
          return '<div class="shepherd-row" data-testid="shepherd-row">' +
            '<strong>' + esc(r.symbol) + '</strong> · ' + esc(r.status) +
            '<div class="mono" style="font-size:var(--text-xs);color:var(--text-muted)">' + esc(short(r.token)) + '</div>' +
            '<div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px">' +
            (r.fairOpen ? 'Fair open · ' : '') +
            (r.sniperSoak ? 'Sniper soak · ' : '') +
            (r.floorNurse ? 'Floor nurse · ' : '') +
            'guard ~$' + esc(r.guardUsd) + ' · ' + esc(r.hours) + 'h' +
            '</div></div>';
        }).join('');
      })
      .catch(function () { /* offline */ });
  }

  function arm(payWith) {
    showErr('');
    if (S.busy) return;
    if (!$('riskAck').checked) {
      showErr('Check the risk box first.');
      return;
    }
    var symbol = String($('sym').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    var address = String($('addr').value || '').trim();
    if (!symbol) { showErr('Enter a ticker.'); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { showErr('Paste a valid token address.'); return; }
    try { address = ethers.utils.getAddress(address); } catch (e) { showErr('Bad address.'); return; }

    var go = function () {
      if (!S.wallet.chainOk) { showErr('Switch to Robinhood Chain (4663).'); return; }
      S.busy = true;
      $('armEth').disabled = true;
      $('armUsdg').disabled = true;
      $('execBox').classList.remove('hidden');
      $('execBox').textContent = 'Building $' + PRICE + ' ' + payWith + ' → MCFL…';
      L.planListingPayment(read, {
        payWith: payWith,
        usdAmount: PRICE,
        ethUsd: S.ethUsd
      }).then(function (plan) {
        var txs = plan.buildTxs();
        var signer = S.wallet.provider.getSigner();
        var lastHash = null;
        var chain = Promise.resolve();
        txs.forEach(function (tx, i) {
          chain = chain.then(function () {
            $('execBox').textContent = 'Confirm step ' + (i + 1) + '/' + txs.length + '…';
            return signer.sendTransaction({
              to: tx.to,
              data: tx.data || '0x',
              value: tx.value || '0x0'
            }).then(function (resp) {
              lastHash = resp.hash;
              return read.waitForTransaction(resp.hash, 1, 180000).then(function (rc) {
                if (!rc || rc.status !== 1) throw new Error('Transaction reverted.');
              });
            });
          });
        });
        return chain.then(function () {
          $('execBox').textContent = 'Registering Shepherd…';
          return fetch(apiBase() + '/api/shepherds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              symbol: symbol,
              token: address,
              wallet: S.wallet.addr,
              hash: lastHash,
              usd: PRICE,
              guardUsd: Number($('guardUsd').value) || 500,
              hours: Number($('hours').value) || 24,
              fairOpen: $('fairOpen').checked,
              sniperSoak: $('sniperSoak').checked,
              floorNurse: $('floorNurse').checked,
              note: 'shepherd-arm'
            }),
            mode: 'cors'
          }).then(function (r) { return r.json(); });
        }).then(function (j) {
          if (!j || !j.ok) throw new Error((j && j.error) || 'API failed');
          $('execBox').innerHTML =
            '<strong>Shepherd armed.</strong> ' + esc(symbol) + ' · ' +
            '<a href="' + esc(explorerTx(lastHash)) + '" target="_blank" rel="noopener">' + esc(short(lastHash)) + '</a>';
          return loadList();
        });
      }).catch(function (e) {
        showErr((e && e.message) || String(e));
      }).then(function () {
        S.busy = false;
        $('armEth').disabled = false;
        $('armUsdg').disabled = false;
      });
    };

    if (!S.wallet.addr) connect().then(go).catch(function (e) { showErr((e && e.message) || e); });
    else go();
  }

  $('walletBtn').addEventListener('click', function () {
    connect().catch(function (e) { showErr((e && e.message) || e); });
  });
  $('armEth').addEventListener('click', function () { arm('ETH'); });
  $('armUsdg').addEventListener('click', function () { arm('USDG'); });

  L.fetchEthUsd().then(function (u) { S.ethUsd = u; refreshPrice(); }).catch(function () {});
  loadList();

  try {
    var q = new URLSearchParams(location.search);
    if (q.get('token')) $('addr').value = q.get('token');
    if (q.get('symbol')) $('sym').value = q.get('symbol');
  } catch (e) { /* ignore */ }
})();
