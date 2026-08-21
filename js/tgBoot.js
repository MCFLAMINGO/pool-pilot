/* Telegram Mini App bootstrap — maps start_param → swap query before swap.js boots. */
(function () {
  'use strict';

  var TOKENS = (window.RH_TOKENS || []).slice();

  function bySymbol(sym) {
    sym = String(sym || '').toUpperCase();
    for (var i = 0; i < TOKENS.length; i++) {
      if (TOKENS[i].symbol.toUpperCase() === sym) return TOKENS[i];
    }
    return null;
  }

  /**
   * start_param forms (A-Za-z0-9_):
   *   MCFL
   *   MCFL_25
   *   USDG_MCFL
   *   USDG_MCFL_25
   *   a_21a91215fbfc4fc002b07cc87698a6fc01aed523
   *   a_21a9…_25
   *   ref_COMMUNITY_MCFL_25   (ref stored; swap args applied)
   */
  function parseStartParam(sp) {
    sp = String(sp || '').trim();
    if (!sp) return {};
    var parts = sp.split('_').filter(Boolean);
    var out = {};
    var i = 0;
    if (parts[0] && parts[0].toLowerCase() === 'ref' && parts[1]) {
      out.ref = parts[1];
      try { sessionStorage.setItem('pp_ref', parts[1]); } catch (e) { /* ignore */ }
      i = 2;
    }
    var head = (parts[i] || '').toUpperCase();
    if (head === 'USDG' && parts[i + 1]) {
      out.in = 'usdg';
      out.to = 'token';
      var tok = bySymbol(parts[i + 1]);
      if (tok) out.out = tok.address;
      else if (/^[0-9a-fA-F]{40}$/.test(parts[i + 1])) out.out = '0x' + parts[i + 1];
      var u1 = Number(parts[i + 2]);
      if (u1 > 0) out.usd = String(u1);
      else out.usd = '25';
      return out;
    }
    if (head === 'A' || head === 'ADDR') {
      var hex = parts[i + 1] || '';
      if (/^[0-9a-fA-F]{40}$/.test(hex)) {
        out.out = '0x' + hex;
        var u2 = Number(parts[i + 2]);
        if (u2 > 0) out.usd = String(u2);
        else out.usd = '25';
      }
      return out;
    }
    var known = bySymbol(parts[i]);
    if (known) {
      out.out = known.address;
      var u3 = Number(parts[i + 1]);
      if (u3 > 0) out.usd = String(u3);
      else out.usd = '25';
      return out;
    }
    if (/^[0-9a-fA-F]{40}$/.test(parts[i])) {
      out.out = '0x' + parts[i];
      var u4 = Number(parts[i + 1]);
      if (u4 > 0) out.usd = String(u4);
      else out.usd = '25';
    }
    return out;
  }

  function applyParams(params) {
    if (!params || !Object.keys(params).length) return;
    var u = new URL(location.href);
    Object.keys(params).forEach(function (k) {
      if (k === 'ref') return;
      if (params[k] != null && params[k] !== '') u.searchParams.set(k, params[k]);
    });
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }

  function startParam() {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
      return tg.initDataUnsafe.start_param;
    }
    var q = typeof URLSearchParams !== 'undefined'
      ? new URLSearchParams(location.search)
      : { get: function () { return ''; } };
    return q.get('tgWebAppStartParam') || q.get('startapp') || '';
  }

  function bootTg() {
    var tg = window.Telegram && window.Telegram.WebApp;
    var banner = document.getElementById('tgBanner');
    if (!tg) {
      if (banner) {
        banner.classList.remove('hidden');
        banner.innerHTML = 'Open inside Telegram for the Mini App, or continue in browser.';
      }
      return;
    }
    try {
      tg.ready();
      tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor('secondary_bg_color');
      if (tg.setBackgroundColor) tg.setBackgroundColor('bg_color');
    } catch (e) { /* ignore */ }
    document.documentElement.setAttribute('data-tg', '1');
    if (banner) {
      banner.classList.remove('hidden');
      banner.innerHTML =
        'Telegram Mini App · 0.30% fee to treasury when they swap · ' +
        '<button type="button" class="linkish" id="tgOpenExt">Open in browser</button>';
      var btn = document.getElementById('tgOpenExt');
      if (btn) {
        btn.addEventListener('click', function () {
          var url = 'https://poolpilot.xyz/swap' + location.search;
          if (tg.openLink) tg.openLink(url);
          else window.open(url, '_blank');
        });
      }
    }
  }

  applyParams(parseStartParam(startParam()));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootTg);
  } else {
    bootTg();
  }

  window.PoolPilotTg = { parseStartParam: parseStartParam };
})();
