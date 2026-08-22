/* Partner stats — refs + server/local receipts + live pool read */
(function () {
  'use strict';
  var P = window.PoolPilotPartner;
  var $ = function (id) { return document.getElementById(id); };
  var GT = 'https://api.geckoterminal.com/api/v2/networks/robinhood-chain/tokens/';

  function bootQuery() {
    var q = new URLSearchParams(location.search);
    if (q.get('ref')) $('ref').value = q.get('ref');
    if (q.get('symbol')) $('sym').value = q.get('symbol');
    if (q.get('token')) $('token').value = q.get('token');
    P.captureRefFromUrl();
    if (!$('ref').value && P.getRef()) $('ref').value = P.getRef();
  }

  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n < 10) return '$' + n.toFixed(2);
    return '$' + Math.round(n).toLocaleString();
  }

  function renderStats(sum) {
    $('statSwaps').textContent = String(sum.swaps);
    $('statUsd').textContent = sum.usd > 0 ? fmtUsd(sum.usd) : '—';
    var src = sum.store === 'local' ? 'local' : (sum.store || 'server');
    if ($('statSource')) $('statSource').textContent = src;
    var rows = (sum.rows || []).slice().slice(0, 12);
    if (!rows.length) {
      $('eventList').textContent = 'No attributed receipts yet for ref “' + (sum.ref || P.cleanRef($('ref').value) || 'any') + '”.';
      return;
    }
    $('eventList').innerHTML = rows.map(function (e) {
      var when = new Date(e.t).toLocaleString();
      return '<div class="bd-link-row"><div><div class="bd-kicker">' + P.esc(e.kind) + (e.ref ? ' · ' + P.esc(e.ref) : '') + '</div>' +
        '<div>' + P.esc(when) + (e.usd != null ? ' · ' + fmtUsd(e.usd) : '') + (e.symbol ? ' · ' + P.esc(e.symbol) : '') + '</div>' +
        (e.hash ? '<div class="mono bd-url">' + P.esc(e.hash) + '</div>' : '') +
        '</div></div>';
    }).join('');
  }

  function loadPool() {
    var token = P.cleanToken($('token').value);
    $('statPool').textContent = '…';
    $('poolLine').textContent = '';
    if (!token) {
      $('statPool').textContent = '—';
      $('poolLine').textContent = 'Add a token address to pull live Robinhood pool stats.';
      return Promise.resolve();
    }
    return fetch(GT + token, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var a = j && j.data && j.data.attributes;
        if (!a) {
          $('statPool').textContent = 'n/a';
          $('poolLine').textContent = 'No GeckoTerminal row yet for this token on Robinhood Chain.';
          return;
        }
        var vol = Number(a.volume_usd && a.volume_usd.h24);
        var liq = Number(a.total_reserve_in_usd);
        $('statPool').textContent = isFinite(vol) ? fmtUsd(vol) + '/24h' : 'listed';
        $('poolLine').textContent =
          (a.name || 'Token') + ' · liquidity ' + (isFinite(liq) ? fmtUsd(liq) : '—') +
          ' · price ' + (a.price_usd != null ? ('$' + Number(a.price_usd).toPrecision(4)) : '—');
      })
      .catch(function () {
        $('statPool').textContent = 'err';
        $('poolLine').textContent = 'Could not reach GeckoTerminal.';
      });
  }

  function load() {
    var links = P.buildLinks({
      ref: $('ref').value,
      symbol: $('sym').value,
      token: $('token').value
    });
    if (links.ref) P.setRef(links.ref);
    $('linkLine').textContent = links.arrive;
    $('packLink').href = links.pack;
    $('caseLink').href = links.caseUrl;
    var u = new URL(location.href);
    if (links.ref) u.searchParams.set('ref', links.ref);
    if (links.symbol) u.searchParams.set('symbol', links.symbol);
    if (links.token) u.searchParams.set('token', links.token);
    history.replaceState(null, '', u.pathname + u.search);
    $('statSwaps').textContent = '…';
    $('statUsd').textContent = '…';
    return P.fetchStats(links.ref, 50).then(function (sum) {
      renderStats(sum);
      return loadPool();
    });
  }

  $('loadBtn').addEventListener('click', load);
  bootQuery();
  load();
})();
