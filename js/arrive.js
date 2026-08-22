/* Arrive funnel — Relay (prefilled RH) → Pool Pilot swap (prefilled) + readiness checks. */
(function () {
  'use strict';

  var P = window.PoolPilotPartner;
  var MCFL = '0x21a91215fbfc4fc002b07cc87698a6fc01aed523';
  var RELAY_RH = 'https://relay.link/bridge/robinhood';
  var RH_HEX = '0x1237'; // 4663

  if (P) P.captureRefFromUrl();

  var q = new URLSearchParams(location.search);
  var out = q.get('out') || q.get('token') || MCFL;
  var usd = q.get('usd') || q.get('amountUsd') || '25';
  var amountEth = q.get('eth') || q.get('amount') || '';
  var fromChain = q.get('fromChainId') || '1';
  var ref = (P && P.getRef()) || '';

  function relayHref() {
    var u = new URL(RELAY_RH);
    u.searchParams.set('fromChainId', fromChain);
    if (amountEth) u.searchParams.set('amount', amountEth);
    return u.toString();
  }

  function swapHref(extra) {
    var u = new URL('/swap', location.origin);
    u.searchParams.set('from', 'relay');
    u.searchParams.set('out', out);
    u.searchParams.set('usd', usd);
    if (ref) u.searchParams.set('ref', ref);
    if (extra) {
      Object.keys(extra).forEach(function (k) { u.searchParams.set(k, extra[k]); });
    }
    return u.pathname + u.search;
  }

  var relayBtn = document.getElementById('relayBtn');
  var swapBtn = document.getElementById('swapBtn');
  var swapUsdgBtn = document.getElementById('swapUsdgBtn');
  if (relayBtn) relayBtn.href = relayHref();
  if (swapBtn) swapBtn.href = swapHref({});
  if (swapUsdgBtn) swapUsdgBtn.href = swapHref({ fund: 'usdg', in: 'eth', to: 'usdg' });

  function setCheck(id, state, text) {
    var li = document.getElementById(id);
    if (!li) return;
    li.className = state || '';
    var mark = li.querySelector('.mark');
    var body = li.querySelector('.body');
    if (mark) mark.textContent = state === 'ok' ? '✓' : state === 'bad' ? '!' : state === 'warn' ? '?' : '·';
    if (body && text) body.textContent = text;
  }

  function refreshChecks() {
    var eth = window.ethereum;
    if (!eth || typeof eth.request !== 'function') {
      setCheck('chkWallet', 'warn', 'No browser wallet detected yet — install Rabby / MetaMask, then refresh.');
      setCheck('chkNetwork', 'warn', 'Connect a wallet to verify Robinhood Chain (4663).');
      setCheck('chkGas', 'warn', 'You’ll need a little ETH on Robinhood for gas after you bridge.');
      return;
    }
    setCheck('chkWallet', 'ok', 'Wallet extension found. Use the same 0x on Relay and Pool Pilot.');

    Promise.resolve()
      .then(function () { return eth.request({ method: 'eth_chainId' }); })
      .then(function (cid) {
        var ok = String(cid).toLowerCase() === RH_HEX;
        if (ok) {
          setCheck('chkNetwork', 'ok', 'You’re on Robinhood Chain (4663). Skip Relay if you already have ETH here.');
        } else {
          setCheck('chkNetwork', 'warn', 'Wallet is not on 4663 yet — bridge with Relay, then switch Rabby to Robinhood Chain.');
        }
      })
      .catch(function () {
        setCheck('chkNetwork', 'warn', 'Could not read chain — open your wallet and switch to Robinhood (4663) after bridging.');
      });

    Promise.resolve()
      .then(function () { return eth.request({ method: 'eth_accounts' }); })
      .then(function (accs) {
        if (!accs || !accs.length) {
          setCheck('chkGas', 'warn', 'Connect your wallet in Rabby, then re-check. Need ETH on 4663 for swap gas.');
          return null;
        }
        return eth.request({
          method: 'eth_getBalance',
          params: [accs[0], 'latest']
        }).then(function (balHex) {
          var wei = parseInt(balHex, 16);
          if (!isFinite(wei)) {
            setCheck('chkGas', 'warn', 'Could not read ETH balance.');
            return;
          }
          var ethBal = wei / 1e18;
          if (ethBal >= 0.0003) {
            setCheck('chkGas', 'ok', 'ETH on this network: ~' + ethBal.toFixed(4) + ' — enough to try a small swap.');
          } else {
            setCheck('chkGas', 'bad', 'ETH balance looks empty on the active network. Bridge first (Step 1), then switch to 4663.');
          }
        });
      })
      .catch(function () {
        setCheck('chkGas', 'warn', 'Unlock / connect your wallet to check gas.');
      });
  }

  var stuck = document.getElementById('stuckBox');
  var stuckBtn = document.getElementById('stuckBtn');
  if (stuckBtn && stuck) {
    stuckBtn.addEventListener('click', function () {
      stuck.classList.toggle('hidden');
    });
  }
  var recheck = document.getElementById('recheckBtn');
  if (recheck) recheck.addEventListener('click', refreshChecks);

  refreshChecks();
  try {
    if (window.ethereum && window.ethereum.on) {
      window.ethereum.on('chainChanged', refreshChecks);
      window.ethereum.on('accountsChanged', refreshChecks);
    }
  } catch (e) { /* ignore */ }
})();
