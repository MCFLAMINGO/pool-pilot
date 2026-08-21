/* Arrive funnel — Relay (prefilled RH) → Pool Pilot swap (prefilled). */
(function () {
  'use strict';

  var MCFL = '0x21a91215fbfc4fc002b07cc87698a6fc01aed523';
  /** Relay deep link: slug = chain name from api.relay.link/chains */
  var RELAY_RH = 'https://relay.link/bridge/robinhood';

  var q = new URLSearchParams(location.search);
  var out = q.get('out') || q.get('token') || MCFL;
  var usd = q.get('usd') || q.get('amountUsd') || '25';
  var amountEth = q.get('eth') || q.get('amount') || '';
  var fromChain = q.get('fromChainId') || '1';

  function relayHref() {
    var u = new URL(RELAY_RH);
    u.searchParams.set('fromChainId', fromChain);
    if (amountEth) u.searchParams.set('amount', amountEth);
    // Native ETH on destination (omit toCurrency = ETH on RH)
    return u.toString();
  }

  function swapHref(extra) {
    var u = new URL('/swap', location.origin);
    u.searchParams.set('from', 'relay');
    u.searchParams.set('out', out);
    u.searchParams.set('usd', usd);
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
  if (swapUsdgBtn) swapUsdgBtn.href = swapHref({ in: 'usdg', to: 'token' });
})();
