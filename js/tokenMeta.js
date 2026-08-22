/* Token icons + lookup — letter-mark SVGs (CSP: img-src data:). */
(function (root) {
  'use strict';

  var PALETTE = [
    '#c45c32', '#2a6f6b', '#3d5a80', '#6b4c7a', '#b5651d',
    '#1b4332', '#9b2226', '#0077b6', '#5c4d3c', '#4a5568'
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cleanAddr(a) {
    var s = String(a || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(s)) return '';
    return s;
  }

  function colorFor(symbol) {
    var s = String(symbol || 'T').toUpperCase();
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function letters(symbol) {
    var s = String(symbol || '?').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (s.length >= 2) return s.slice(0, 2);
    return (s + '?').slice(0, 2);
  }

  /** data: SVG icon — uses custom iconUrl when provided. */
  function iconUrl(token) {
    if (token && token.iconUrl && /^data:image\//.test(token.iconUrl)) return token.iconUrl;
    var sym = (token && token.symbol) || '?';
    var bg = (token && token.color) || colorFor(sym);
    var text = letters(sym);
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="16" fill="' + bg + '"/>' +
      '<text x="32" y="38" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#fff">' +
      text +
      '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function allTokens() {
    return Array.isArray(root.RH_TOKENS) ? root.RH_TOKENS.slice() : [];
  }

  function byAddress(addr) {
    addr = cleanAddr(addr);
    if (!addr) return null;
    var list = allTokens();
    for (var i = 0; i < list.length; i++) {
      if (cleanAddr(list[i].address) === addr) return list[i];
    }
    return null;
  }

  function bySymbol(sym) {
    sym = String(sym || '').trim().toUpperCase();
    if (!sym) return null;
    var list = allTokens();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].symbol || '').toUpperCase() === sym) return list[i];
    }
    return null;
  }

  function featuredTokens(extra, routeExtra) {
    var map = Object.create(null);
    var out = [];
    function add(t) {
      if (!t || !t.address) return;
      var k = cleanAddr(t.address);
      if (!k || map[k]) return;
      map[k] = true;
      out.push(t);
    }
    var curated = allTokens().filter(function (t) { return t.featured; });
    var mcfl = curated.filter(function (t) { return String(t.symbol).toUpperCase() === 'MCFL'; });
    var otherFeat = curated.filter(function (t) { return String(t.symbol).toUpperCase() !== 'MCFL'; });
    mcfl.forEach(add);
    (routeExtra || []).forEach(function (c) {
      add({
        symbol: c.symbol,
        address: c.address,
        iconUrl: c.iconUrl || '',
        routeOnly: true,
        community: true
      });
    });
    otherFeat.forEach(add);
    (extra || []).forEach(add);
    return out;
  }

  function communityTokens() {
    return allTokens().filter(function (t) { return t.community && !t.featured; });
  }

  function chipHtml(t, opts) {
    opts = opts || {};
    var url = iconUrl(t);
    var badge = '';
    if (t.featured) badge = '<span class="chip-badge" title="Featured listing">★</span>';
    else if (t.routeOnly || opts.route) badge = '<span class="chip-badge route" title="Your community route">◎</span>';
    else if (t.community) badge = '<span class="chip-badge community" title="Community using Pool Pilot">●</span>';
    return (
      '<button type="button" class="chip chip-icon' + (opts.active ? ' is-active' : '') + '" data-addr="' +
      esc(t.address) + '" data-sym="' + esc(t.symbol) + '" data-testid="chip-' + esc(String(t.symbol).toLowerCase()) + '">' +
      '<img class="chip-img" src="' + url + '" alt="" width="20" height="20" loading="lazy">' +
      '<span class="chip-sym">' + esc(t.symbol) + '</span>' + badge +
      '</button>'
    );
  }

  function confirmHtml(t) {
    if (!t) return '';
    var tag = t.featured ? 'Featured' : (t.community ? 'Community' : 'Known');
    return (
      '<button type="button" class="token-confirm" data-addr="' + esc(t.address) + '" data-testid="button-token-confirm">' +
      '<img class="chip-img" src="' + iconUrl(t) + '" alt="" width="28" height="28">' +
      '<span class="token-confirm-body">' +
      '<strong>' + esc(t.symbol) + '</strong>' +
      '<span class="token-confirm-meta">Confirmed · ' + tag + ' · tap to open</span>' +
      '</span></button>'
    );
  }

  root.PoolPilotTokens = {
    iconUrl: iconUrl,
    colorFor: colorFor,
    byAddress: byAddress,
    bySymbol: bySymbol,
    featuredTokens: featuredTokens,
    communityTokens: communityTokens,
    allTokens: allTokens,
    chipHtml: chipHtml,
    confirmHtml: confirmHtml,
    cleanAddr: cleanAddr,
    listingPriceUsd: function () {
      return root.RH_LISTING_PRICE_USD || 500;
    }
  };
})(typeof self !== 'undefined' ? self : this);
