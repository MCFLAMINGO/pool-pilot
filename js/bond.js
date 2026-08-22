/* Pool Pilot USDG Bond desk */
(function () {
  'use strict';
  var L = window.ChainLib;
  var P = window.PoolPilotPartner;
  var CFG = L.CFG;
  var read = L.getProvider();
  var $ = function (id) { return document.getElementById(id); };
  var CREATE_USD = 50;
  var S = {
    wallet: { addr: null, provider: null, chainOk: false },
    ethUsd: null,
    busy: false,
    active: null
  };

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

  function payFee(usd, payWith) {
    return L.planListingPayment(read, {
      payWith: payWith,
      usdAmount: usd,
      ethUsd: S.ethUsd
    }).then(function (plan) {
      var txs = plan.buildTxs();
      var signer = S.wallet.provider.getSigner();
      var lastHash = null;
      var chain = Promise.resolve();
      txs.forEach(function (tx) {
        chain = chain.then(function () {
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
      return chain.then(function () { return { hash: lastHash, plan: plan }; });
    });
  }

  function transferUsdg(amountF) {
    var c = new ethers.Contract(CFG.USDG, [
      'function decimals() view returns (uint8)',
      'function transfer(address to,uint256 amount) returns (bool)'
    ], S.wallet.provider.getSigner());
    return c.decimals().then(function (d) {
      var amt = ethers.utils.parseUnits(Number(amountF).toFixed(Math.min(d, 6)), d);
      return c.transfer(CFG.TREASURY, amt).then(function (resp) {
        return read.waitForTransaction(resp.hash, 1, 180000).then(function (rc) {
          if (!rc || rc.status !== 1) throw new Error('USDG transfer reverted.');
          return resp.hash;
        });
      });
    });
  }

  function renderActive(b) {
    S.active = b;
    var card = $('activeCard');
    card.hidden = false;
    var pct = Math.round((b.progress || 0) * 100);
    $('activeBody').innerHTML =
      '<div><strong>' + esc(b.name) + '</strong> · ' + esc(b.symbol) + ' · ' + esc(b.status) + '</div>' +
      '<div class="mono" style="font-size:var(--text-xs);color:var(--text-muted)">/' + esc(b.id) +
      (b.ref ? ' · ref=' + esc(b.ref) : '') + '</div>' +
      '<div style="margin-top:8px">Raised <strong>$' + esc(b.raisedUsdg) + '</strong> / $' + esc(b.targetUsdg) + ' USDG · ' + esc(b.pledges) + ' pledges</div>' +
      '<div class="bond-bar"><span style="width:' + pct + '%"></span></div>' +
      (b.ref
        ? '<p class="muted" style="margin-top:10px">Share with community: <a class="mono" href="/swap?ref=' +
          esc(b.ref) + '">/swap?ref=' + esc(b.ref) + '</a> — they see your icon after MCFL. Global frontpage needs $500 featured.</p>'
        : '') +
      (b.superChainQueued ? '<div class="banner ok" style="margin-top:10px">Super Chain queued after graduate.</div>' : '');
    if ($('token') && b.token && !$('token').value) $('token').value = b.token;
    if ($('ref') && b.ref && !$('ref').value) $('ref').value = b.ref;
    var canGrad = (b.status === 'filled' || b.status === 'graduated') && S.wallet.addr &&
      S.wallet.addr.toLowerCase() === String(b.creator || '').toLowerCase();
    $('gradBtn').hidden = !(b.status === 'filled' && canGrad);
    if (b.status === 'graduated') $('gradBtn').hidden = true;
    try { history.replaceState(null, '', '/bond?id=' + encodeURIComponent(b.id)); } catch (e) { /* ignore */ }
  }

  function loadList() {
    return fetch(apiBase() + '/api/bonds', { headers: { Accept: 'application/json' }, mode: 'cors' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.createPriceUsd) CREATE_USD = j.createPriceUsd;
        $('priceLine').innerHTML = 'Create · <strong>$' + CREATE_USD + '</strong> ETH or USDG → MCFL';
        var box = $('list');
        var rows = (j && j.bonds) || [];
        if (!rows.length) {
          box.innerHTML = '<p class="muted">No bonds yet — create the first.</p>';
          return;
        }
        box.innerHTML = rows.map(function (b) {
          var pct = Math.round((b.progress || 0) * 100);
          return '<div class="bond-row" data-id="' + esc(b.id) + '">' +
            '<strong>' + esc(b.symbol) + '</strong> · ' + esc(b.name) + ' · ' + esc(b.status) +
            '<div style="font-size:var(--text-xs);color:var(--text-muted)">$' + esc(b.raisedUsdg) + ' / $' + esc(b.targetUsdg) + '</div>' +
            '<div class="bond-bar"><span style="width:' + pct + '%"></span></div></div>';
        }).join('');
        Array.prototype.forEach.call(box.querySelectorAll('.bond-row'), function (el) {
          el.addEventListener('click', function () { openBond(el.getAttribute('data-id')); });
        });
      })
      .catch(function () {});
  }

  function openBond(id) {
    return fetch(apiBase() + '/api/bonds/' + encodeURIComponent(id), {
      headers: { Accept: 'application/json' }, mode: 'cors'
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || 'Not found');
      renderActive(j.bond);
    }).catch(function (e) { showErr((e && e.message) || e); });
  }

  function createBond(payWith) {
    showErr('');
    if (!$('riskAck').checked) { showErr('Check the risk box first.'); return; }
    var name = String($('name').value || '').trim();
    var symbol = String($('sym').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    var target = Number($('target').value);
    var blurb = String($('blurb').value || '').trim();
    var ref = String(($('ref') && $('ref').value) || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    var token = String(($('token') && $('token').value) || '').trim();
    if (!name || !symbol) { showErr('Name and ticker required.'); return; }
    if (!isFinite(target) || target < 5000) {
      showErr('Target at least $5,000 USDG — enough for Uniswap seed + Super Chain.');
      return;
    }
    if (!ref) ref = symbol.toLowerCase();
    if (P && P.getRef && P.getRef() && !$('ref').value) ref = P.getRef();

    var go = function () {
      if (!S.wallet.chainOk) { showErr('Switch to Robinhood Chain (4663).'); return; }
      S.busy = true;
      $('createEth').disabled = true;
      $('createUsdg').disabled = true;
      $('execBox').classList.remove('hidden');
      $('execBox').textContent = 'Paying create fee…';
      payFee(CREATE_USD, payWith).then(function (paid) {
        $('execBox').textContent = 'Opening bond…';
        return fetch(apiBase() + '/api/bonds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            name: name,
            symbol: symbol,
            creator: S.wallet.addr,
            hash: paid.hash,
            usd: CREATE_USD,
            targetUsdg: target,
            blurb: blurb,
            ref: ref,
            token: token || undefined
          }),
          mode: 'cors'
        }).then(function (r) { return r.json(); });
      }).then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'Create failed');
        $('execBox').innerHTML = '<strong>Bond open.</strong> Share <span class="mono">/bond?id=' + esc(j.bond.id) + '</span>';
        renderActive(j.bond);
        return loadList();
      }).catch(function (e) {
        showErr((e && e.message) || String(e));
      }).then(function () {
        S.busy = false;
        $('createEth').disabled = false;
        $('createUsdg').disabled = false;
      });
    };
    if (!S.wallet.addr) connect().then(go).catch(function (e) { showErr((e && e.message) || e); });
    else go();
  }

  function pledge() {
    showErr('');
    if (!S.active) { showErr('Pick a bond first.'); return; }
    if (S.active.status !== 'open' && S.active.status !== 'filled') {
      showErr('Bond is not open for pledges.');
      return;
    }
    var amt = Number($('pledgeAmt').value);
    if (!isFinite(amt) || amt < 1) { showErr('Enter a USDG amount.'); return; }

    var go = function () {
      if (!S.wallet.chainOk) { showErr('Switch to Robinhood Chain (4663).'); return; }
      S.busy = true;
      $('pledgeBtn').disabled = true;
      $('pledgeBtn').textContent = 'Confirm USDG…';
      transferUsdg(amt).then(function (hash) {
        return fetch(apiBase() + '/api/bonds/' + encodeURIComponent(S.active.id) + '/pledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ wallet: S.wallet.addr, hash: hash, usdg: amt }),
          mode: 'cors'
        }).then(function (r) { return r.json(); });
      }).then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'Pledge failed');
        renderActive(j.bond);
        return loadList();
      }).catch(function (e) {
        showErr((e && e.message) || String(e));
      }).then(function () {
        S.busy = false;
        $('pledgeBtn').disabled = false;
        $('pledgeBtn').textContent = 'Pledge USDG';
      });
    };
    if (!S.wallet.addr) connect().then(go).catch(function (e) { showErr((e && e.message) || e); });
    else go();
  }

  function graduate() {
    showErr('');
    if (!S.active) return;
    var token = String(($('token') && $('token').value) || S.active.token || '').trim();
    var go = function () {
      fetch(apiBase() + '/api/bonds/' + encodeURIComponent(S.active.id) + '/graduate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ wallet: S.wallet.addr, note: 'graduate', token: token || undefined }),
        mode: 'cors'
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'Graduate failed');
        renderActive(j.bond);
        var ref = (j.bond && j.bond.ref) || '';
        $('execBox').classList.remove('hidden');
        $('execBox').innerHTML =
          '<strong>Graduated.</strong> Next: seed Uniswap on RH, then Super Chain is queued. ' +
          (ref
            ? 'Route chip: <a href="/swap?ref=' + esc(ref) + '">/swap?ref=' + esc(ref) + '</a> (community only). '
            : '') +
          'Global frontpage = <a href="/start#mod-featured">$500 featured</a>. ' +
          '<a href="/builders.html">Super Chain playbook</a>';
        return loadList();
      }).catch(function (e) { showErr((e && e.message) || e); });
    };
    if (!S.wallet.addr) connect().then(go).catch(function (e) { showErr((e && e.message) || e); });
    else go();
  }

  $('walletBtn').addEventListener('click', function () {
    connect().catch(function (e) { showErr((e && e.message) || e); });
  });
  $('createEth').addEventListener('click', function () { createBond('ETH'); });
  $('createUsdg').addEventListener('click', function () { createBond('USDG'); });
  $('pledgeBtn').addEventListener('click', pledge);
  $('gradBtn').addEventListener('click', graduate);

  L.fetchEthUsd().then(function (u) { S.ethUsd = u; }).catch(function () {});
  loadList().then(function () {
    try {
      var id = new URLSearchParams(location.search).get('id');
      if (id) openBond(id);
    } catch (e) { /* ignore */ }
  });
})();
