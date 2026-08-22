/* /mcfl — Phantom modal to deepen RH LP with Solana MCFL */
(function () {
  'use strict';

  var CFG = null;
  var S = { pubkey: null, bal: null };

  var $ = function (id) { return document.getElementById(id); };

  function short(a) {
    if (!a) return '—';
    return a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a;
  }

  function cleanAmount(raw) {
    var s = String(raw || '').trim().replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return '';
    return s;
  }

  function setErr(msg) {
    $('mErr').textContent = msg || '';
    $('mOk').textContent = '';
  }
  function setOk(msg) {
    $('mOk').textContent = msg || '';
    $('mErr').textContent = '';
  }

  function phantom() {
    var p = window.solana;
    if (p && p.isPhantom) return p;
    return null;
  }

  function openModal() {
    $('mAmount').value = cleanAmount($('amount').value) || '50000';
    $('mTo').value = CFG.desk;
    $('overlay').classList.add('open');
    setErr('');
    refreshBalUi();
  }

  function closeModal() {
    $('overlay').classList.remove('open');
  }

  function refreshBalUi() {
    $('phantomStatus').textContent = S.pubkey ? S.pubkey : 'Not connected';
    $('mFrom').value = S.pubkey || '';
    if (S.bal != null) {
      var t = S.bal.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' MCFL';
      $('phantomBal').textContent = 'Balance: ' + t;
      $('mBal').textContent = 'Balance: ' + t;
    } else if (S.pubkey) {
      $('phantomBal').textContent = 'Loading MCFL balance…';
      $('mBal').textContent = 'Loading…';
    } else {
      $('phantomBal').textContent = 'Connect Phantom to see your MCFL balance.';
      $('mBal').textContent = 'Balance: —';
    }
    $('bridgeBtn').disabled = !(S.pubkey && cleanAmount($('mAmount').value));
    $('connectPhantomBtn').textContent = S.pubkey ? 'Phantom connected · ' + short(S.pubkey) : 'Connect Phantom';
  }

  function rpc(method, params) {
    return fetch(CFG.solRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) throw new Error(j.error.message || 'RPC error');
      return j.result;
    });
  }

  function loadBalance() {
    if (!S.pubkey || !CFG) return Promise.resolve();
    return rpc('getTokenAccountsByOwner', [
      S.pubkey,
      { mint: CFG.mint },
      { encoding: 'jsonParsed' }
    ]).then(function (res) {
      var total = 0;
      var list = (res && res.value) || [];
      list.forEach(function (acc) {
        var info = acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info;
        var amt = info && info.tokenAmount && info.tokenAmount.uiAmount;
        if (typeof amt === 'number') total += amt;
      });
      S.bal = total;
      refreshBalUi();
    }).catch(function (e) {
      S.bal = null;
      refreshBalUi();
      setErr((e && e.message) || 'Could not read MCFL balance');
    });
  }

  function connectPhantom() {
    setErr('');
    var p = phantom();
    if (!p) {
      setErr('Install the Phantom extension, then refresh.');
      window.open('https://phantom.app/', '_blank', 'noopener');
      return Promise.reject(new Error('No Phantom'));
    }
    return p.connect().then(function (res) {
      S.pubkey = (res && res.publicKey && res.publicKey.toString()) || (p.publicKey && p.publicKey.toString());
      refreshBalUi();
      return loadBalance();
    }).catch(function (e) {
      setErr((e && e.message) || 'Phantom connect cancelled');
    });
  }

  function bridge() {
    setErr('');
    var amount = cleanAmount($('mAmount').value);
    if (!amount) { setErr('Enter an amount.'); return; }
    if (!S.pubkey) { setErr('Connect Phantom first.'); return; }
    if (S.bal != null && Number(amount) > S.bal) {
      setErr('Amount is higher than your Solana MCFL balance.');
      return;
    }

    // Phantom can connect + we have OFT IDs; full OFT send ix still needs the
    // LayerZero Solana SDK bundle. Until that ships, give a one-line local cmd
    // that uses the committed deployments/solana-mainnet/OFT.json.
    var cmd = 'npm run deepen-lp -- ' + amount;
    setOk(
      'Phantom connected as ' + short(S.pubkey) + '. ' +
      'In-browser OFT sign is next (program ' + short(CFG.programId) + '). ' +
      'For now run once in mcfl-oft: ' + cmd
    );
    $('pageNote').textContent =
      'Desk destination + OFT IDs are wired. Bridge button will sign in Phantom once the OFT send bundle lands — until then: ' + cmd;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd).catch(function () {});
    }
  }

  function boot() {
    fetch('js/mcfl-oft.json')
      .then(function (r) { return r.json(); })
      .then(function (c) {
        CFG = c;
        $('destLabel').textContent = CFG.desk;
        $('mTo').value = CFG.desk;
        $('amount').addEventListener('input', function () {
          if ($('overlay').classList.contains('open')) {
            $('mAmount').value = cleanAmount($('amount').value) || '';
            refreshBalUi();
          }
        });
        $('mAmount').addEventListener('input', refreshBalUi);
        $('openBridgeBtn').addEventListener('click', openModal);
        $('closeModalBtn').addEventListener('click', closeModal);
        $('overlay').addEventListener('click', function (e) {
          if (e.target === $('overlay')) closeModal();
        });
        $('connectPhantomBtn').addEventListener('click', connectPhantom);
        $('bridgeBtn').addEventListener('click', bridge);

        var p = phantom();
        if (p && p.isConnected && p.publicKey) {
          S.pubkey = p.publicKey.toString();
          refreshBalUi();
          loadBalance();
        }
      })
      .catch(function () {
        $('pageNote').textContent = 'Could not load OFT config (js/mcfl-oft.json).';
      });
  }

  boot();
})();
