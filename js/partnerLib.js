/* Pool Pilot partner / BD helpers — links, refs, local swap receipts. */
(function (root) {
  'use strict';

  var ORIGIN = 'https://poolpilot.xyz';
  var REF_KEY = 'pp_ref';
  var EVENTS_KEY = 'pp_partner_events';
  var MAX_EVENTS = 200;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cleanRef(raw) {
    var s = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (s.length > 32) s = s.slice(0, 32);
    return s;
  }

  function cleanSymbol(raw) {
    return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'TOKEN';
  }

  function cleanToken(raw) {
    var s = String(raw || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return '';
    return s.toLowerCase();
  }

  function cleanUsd(raw) {
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) return '25';
    return String(Math.round(n));
  }

  function setRef(ref) {
    ref = cleanRef(ref);
    if (!ref) return '';
    try {
      localStorage.setItem(REF_KEY, ref);
      sessionStorage.setItem(REF_KEY, ref);
    } catch (e) { /* ignore */ }
    return ref;
  }

  function getRef() {
    try {
      return cleanRef(sessionStorage.getItem(REF_KEY) || localStorage.getItem(REF_KEY) || '');
    } catch (e) {
      return '';
    }
  }

  /** Capture ?ref= from URL (and keep other query intact). */
  function captureRefFromUrl() {
    try {
      var q = new URLSearchParams(location.search);
      var r = cleanRef(q.get('ref') || q.get('partner') || '');
      if (r) setRef(r);
      return r || getRef();
    } catch (e) {
      return getRef();
    }
  }

  function withRef(url, ref) {
    ref = cleanRef(ref || getRef());
    if (!ref) return url;
    var u = new URL(url, ORIGIN);
    u.searchParams.set('ref', ref);
    return u.toString();
  }

  function tgStartParam(opts) {
    opts = opts || {};
    var sym = cleanSymbol(opts.symbol);
    var usd = cleanUsd(opts.usd);
    var token = cleanToken(opts.token);
    var ref = cleanRef(opts.ref);
    var body;
    if (token) body = 'a_' + token.slice(2) + '_' + usd;
    else body = sym + '_' + usd;
    if (opts.usdg) body = 'USDG_' + (token ? ('a_' + token.slice(2)) : sym) + '_' + usd;
    if (ref) return 'ref_' + ref + '_' + body;
    return body;
  }

  function buildLinks(opts) {
    opts = opts || {};
    var token = cleanToken(opts.token);
    var symbol = cleanSymbol(opts.symbol);
    var usd = cleanUsd(opts.usd);
    var ref = cleanRef(opts.ref);
    var outQ = token ? ('out=' + token + '&usd=' + usd) : ('usd=' + usd);

    var arrive = ORIGIN + '/arrive?' + outQ + (token ? '' : '');
    if (token) arrive = ORIGIN + '/arrive?usd=' + usd + '&out=' + token;
    else arrive = ORIGIN + '/arrive?usd=' + usd;

    var swap = ORIGIN + '/swap?usd=' + usd + (token ? '&out=' + token : '') + '&from=relay';
    var swapUsdg = ORIGIN + '/swap?in=usdg&to=token&usd=' + usd + (token ? '&out=' + token : '');
    var embed = ORIGIN + '/embed?' + (token ? 'out=' + token + '&' : '') + 'usd=' + usd + '&symbol=' + encodeURIComponent(symbol);
    var caseUrl = ORIGIN + '/case?symbol=' + encodeURIComponent(symbol) + (token ? '&token=' + token : '') + (ref ? '&ref=' + ref : '');
    var pack = ORIGIN + '/pack?symbol=' + encodeURIComponent(symbol) + (token ? '&token=' + token : '') + '&usd=' + usd + (ref ? '&ref=' + ref : '');
    var partner = ORIGIN + '/partner?ref=' + (ref || symbol.toLowerCase()) + (token ? '&token=' + token : '') + '&symbol=' + encodeURIComponent(symbol);
    var startapp = tgStartParam({ symbol: symbol, token: token, usd: usd, ref: ref });
    var mini = 'https://t.me/poolpilotswapbot?startapp=' + startapp;

    return {
      symbol: symbol,
      token: token,
      usd: usd,
      ref: ref,
      arrive: withRef(arrive, ref),
      swap: withRef(swap, ref),
      swapUsdg: withRef(swapUsdg, ref),
      embed: withRef(embed, ref),
      caseUrl: caseUrl,
      pack: pack,
      partner: partner,
      mini: mini,
      startapp: startapp,
      home: withRef(ORIGIN + '/', ref),
      press: ORIGIN + '/press',
      qrTarget: withRef(arrive, ref)
    };
  }

  function siteCopy(links) {
    links = links || buildLinks({});
    var sym = links.symbol || 'TOKEN';
    return {
      oneLiner: 'Bridge with Relay. Swap and LP with Pool Pilot — poolpilot.xyz',
      tgPin:
        sym + ' on Robinhood Chain\n' +
        'Arrive (bridge → swap): ' + links.arrive + '\n' +
        'TG Mini App: ' + links.mini + '\n' +
        'You sign — nothing custodied.',
      xPost:
        'Trading ' + sym + ' on Robinhood Chain?\n' +
        'Bridge → Swap with Pool Pilot.\n' +
        links.arrive,
      websiteBlurb:
        'Trade ' + sym + ' on Robinhood Chain with Pool Pilot (non-custodial).\n' +
        links.swap,
      launchGuide:
        '1. Open ' + links.arrive + '\n' +
        '2. Bridge ETH with Relay\n' +
        '3. Come back and swap ' + sym + '\n' +
        '4. Optional TG: ' + links.mini,
      embedSnippet:
        '<iframe src="' + links.embed + '" title="Pool Pilot" width="360" height="220" style="border:0;border-radius:16px;max-width:100%" loading="lazy"></iframe>'
    };
  }

  function qrImgUrl(data, size) {
    size = size || 220;
    return 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size + '&data=' + encodeURIComponent(data);
  }

  function readEvents() {
    try {
      var raw = localStorage.getItem(EVENTS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function writeEvents(arr) {
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(arr.slice(-MAX_EVENTS)));
    } catch (e) { /* ignore */ }
  }

  /** Local receipt log for partner demos (same-browser / shared machine). */
  function logEvent(ev) {
    ev = ev || {};
    var row = {
      t: Date.now(),
      kind: ev.kind || 'swap',
      ref: cleanRef(ev.ref || getRef()),
      token: cleanToken(ev.token) || '',
      symbol: cleanSymbol(ev.symbol || ''),
      usd: ev.usd != null ? Number(ev.usd) : null,
      hash: ev.hash || '',
      note: String(ev.note || '').slice(0, 120)
    };
    var arr = readEvents();
    arr.push(row);
    writeEvents(arr);
    return row;
  }

  function eventsForRef(ref) {
    ref = cleanRef(ref);
    return readEvents().filter(function (e) { return !ref || e.ref === ref; });
  }

  function summarizeRef(ref) {
    var rows = eventsForRef(ref);
    var swaps = rows.filter(function (e) { return e.kind === 'swap'; });
    var usd = 0;
    swaps.forEach(function (e) { if (e.usd && isFinite(e.usd)) usd += e.usd; });
    return { events: rows.length, swaps: swaps.length, usd: usd, rows: rows };
  }

  root.PoolPilotPartner = {
    ORIGIN: ORIGIN,
    esc: esc,
    cleanRef: cleanRef,
    cleanSymbol: cleanSymbol,
    cleanToken: cleanToken,
    cleanUsd: cleanUsd,
    setRef: setRef,
    getRef: getRef,
    captureRefFromUrl: captureRefFromUrl,
    withRef: withRef,
    tgStartParam: tgStartParam,
    buildLinks: buildLinks,
    siteCopy: siteCopy,
    qrImgUrl: qrImgUrl,
    logEvent: logEvent,
    readEvents: readEvents,
    eventsForRef: eventsForRef,
    summarizeRef: summarizeRef
  };
})(window);
