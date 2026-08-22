/* Partner pack generator */
(function () {
  'use strict';
  var P = window.PoolPilotPartner;
  var $ = function (id) { return document.getElementById(id); };

  function bootFromQuery() {
    var q = new URLSearchParams(location.search);
    if (q.get('symbol')) $('sym').value = q.get('symbol');
    if (q.get('token')) $('token').value = q.get('token');
    if (q.get('usd')) $('usd').value = q.get('usd');
    if (q.get('ref')) $('ref').value = q.get('ref');
    P.captureRefFromUrl();
    if (!$('ref').value && P.getRef()) $('ref').value = P.getRef();
  }

  function currentOpts() {
    return {
      symbol: $('sym').value,
      token: $('token').value,
      usd: $('usd').value,
      ref: $('ref').value
    };
  }

  function row(label, url, testid) {
    return (
      '<div class="bd-link-row">' +
        '<div><div class="bd-kicker">' + P.esc(label) + '</div>' +
        '<div class="mono bd-url" data-testid="' + testid + '">' + P.esc(url) + '</div></div>' +
        '<button type="button" class="btn btn-ghost bd-copy" data-copy="' + P.esc(url) + '">Copy</button>' +
      '</div>'
    );
  }

  function render() {
    var links = P.buildLinks(currentOpts());
    if (links.ref) P.setRef(links.ref);
    var copy = P.siteCopy(links);
    $('packOut').classList.remove('hidden');
    $('qrImg').src = P.qrImgUrl(links.qrTarget);
    $('qrUrl').textContent = links.arrive;
    $('linkList').innerHTML =
      row('Arrive (bridge → swap)', links.arrive, 'text-pack-arrive') +
      row('Swap desk', links.swap, 'text-pack-swap') +
      row('USDG → token', links.swapUsdg, 'text-pack-usdg') +
      row('Telegram Mini App', links.mini, 'text-pack-mini') +
      row('Embed URL', links.embed, 'text-pack-embed') +
      row('Partner stats', links.partner, 'text-pack-partner');
    $('copyBox').value = [copy.tgPin, '', copy.xPost, '', copy.launchGuide].join('\n');
    $('embedBox').value = copy.embedSnippet;
    $('caseLink').href = links.caseUrl;
    $('partnerLink').href = links.partner;

    var u = new URL(location.href);
    u.searchParams.set('symbol', links.symbol);
    if (links.token) u.searchParams.set('token', links.token);
    else u.searchParams.delete('token');
    u.searchParams.set('usd', links.usd);
    if (links.ref) u.searchParams.set('ref', links.ref);
    else u.searchParams.delete('ref');
    history.replaceState(null, '', u.pathname + u.search);
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t);
    }
    var ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  $('genBtn').addEventListener('click', render);
  $('copyAllBtn').addEventListener('click', function () {
    var links = P.buildLinks(currentOpts());
    copyText([links.arrive, links.swap, links.mini, links.embed].join('\n'));
  });
  $('copyTextBtn').addEventListener('click', function () {
    copyText($('copyBox').value);
  });
  $('linkList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    copyText(btn.getAttribute('data-copy'));
  });

  bootFromQuery();
  render();
})();
