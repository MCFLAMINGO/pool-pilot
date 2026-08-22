/* Embeddable CTA — framed on partner sites */
(function () {
  'use strict';
  var P = window.PoolPilotPartner;
  P.captureRefFromUrl();
  var q = new URLSearchParams(location.search);
  var links = P.buildLinks({
    token: q.get('out') || q.get('token') || '',
    symbol: q.get('symbol') || 'TOKEN',
    usd: q.get('usd') || '25',
    ref: q.get('ref') || P.getRef()
  });
  var title = document.getElementById('title');
  var blurb = document.getElementById('blurb');
  var cta = document.getElementById('cta');
  var swap = document.getElementById('swapOnly');
  title.textContent = 'Trade ' + links.symbol + ' on Robinhood';
  blurb.textContent = 'Bridge with Relay, then swap on Pool Pilot. Non-custodial.';
  cta.href = links.arrive;
  cta.textContent = 'Arrive · Swap ' + links.symbol;
  swap.href = links.swap;
})();
