/* Case study one-pager */
(function () {
  'use strict';
  var P = window.PoolPilotPartner;
  var $ = function (id) { return document.getElementById(id); };
  var GT = 'https://api.geckoterminal.com/api/v2/networks/robinhood-chain/tokens/';

  function boot() {
    var q = new URLSearchParams(location.search);
    if (q.get('symbol')) $('sym').value = q.get('symbol');
    if (q.get('token')) $('token').value = q.get('token');
    if (q.get('ref')) $('ref').value = q.get('ref');
    P.captureRefFromUrl();
  }

  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n < 10) return '$' + n.toFixed(2);
    return '$' + Math.round(n).toLocaleString();
  }

  function render() {
    var links = P.buildLinks({
      symbol: $('sym').value,
      token: $('token').value,
      ref: $('ref').value,
      usd: 25
    });
    $('caseTitle').textContent = links.symbol + ' × Pool Pilot';
    $('caseKicker').textContent = links.ref ? ('Partner · ' + links.ref) : 'Community case study';
    $('arriveLink').href = links.arrive;
    $('packLink').href = links.pack;
    var sum = P.summarizeRef(links.ref);
    $('cLocal').textContent = String(sum.swaps);

    var story =
      links.symbol + ' routed holders to Pool Pilot on Robinhood Chain.\n\n' +
      'Setup\n' +
      '• Arrive link: ' + links.arrive + '\n' +
      '• Telegram Mini App: ' + links.mini + '\n' +
      (links.ref ? ('• Partner ref: ' + links.ref + '\n') : '') +
      '\nWhat holders do\n' +
      '1. Bridge ETH with Relay\n' +
      '2. Swap on Pool Pilot (they sign — nothing custodied)\n' +
      '3. Optional: deepen liquidity with the LP desk\n\n' +
      'Proof (fill after 7 days)\n' +
      '• Local attributed swaps (this browser): ' + sum.swaps + '\n' +
      '• Live 24h volume: (auto below)\n' +
      '• Blockscout treasury / pool links: robinhoodchain.blockscout.com\n\n' +
      'Quote for PR\n' +
      '“Bridge with Relay. Swap and LP with Pool Pilot.” — poolpilot.xyz';
    $('story').value = story;

    var token = links.token;
    if (!token) {
      $('cVol').textContent = '—';
      $('cLiq').textContent = '—';
      return;
    }
    $('cVol').textContent = '…';
    $('cLiq').textContent = '…';
    fetch(GT + token, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var a = j && j.data && j.data.attributes;
        if (!a) { $('cVol').textContent = 'n/a'; $('cLiq').textContent = 'n/a'; return; }
        var vol = Number(a.volume_usd && a.volume_usd.h24);
        var liq = Number(a.total_reserve_in_usd);
        $('cVol').textContent = isFinite(vol) ? fmtUsd(vol) : '—';
        $('cLiq').textContent = isFinite(liq) ? fmtUsd(liq) : '—';
        $('story').value = $('story').value.replace('(auto below)', isFinite(vol) ? fmtUsd(vol) : 'n/a');
      })
      .catch(function () {
        $('cVol').textContent = 'err';
        $('cLiq').textContent = 'err';
      });
  }

  $('genBtn').addEventListener('click', render);
  $('copyBtn').addEventListener('click', function () {
    var t = $('story').value;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t);
  });
  boot();
  render();
})();
