/* Ops-only natural reach vs partners — gated by HOUSE_VIEW_KEY */
(function () {
  'use strict';
  var KEY = 'pp_ops_key';
  var P = window.PoolPilotPartner;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n < 10) return '$' + n.toFixed(2);
    return '$' + Math.round(n).toLocaleString();
  }
  function pct(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n * 100).toFixed(1) + '%';
  }
  function apiBase() {
    return P && P.apiBase ? P.apiBase() : location.origin;
  }
  function errText(x, status) {
    if (x == null || x === '') {
      if (status === 404) return 'Reach API not deployed yet — merge/redeploy, then retry.';
      if (status === 401) return 'Wrong ops key.';
      if (status === 503) return 'Set HOUSE_VIEW_KEY in Vercel and redeploy.';
      return status ? ('HTTP ' + status) : 'Request failed';
    }
    if (typeof x === 'string') return x;
    if (typeof x === 'object') {
      if (typeof x.message === 'string') return x.message;
      if (x.error != null) return errText(x.error, status);
      try {
        return JSON.stringify(x);
      } catch (e) {
        return 'Request failed';
      }
    }
    return String(x);
  }
  function showErr(msg) {
    var b = $('errBanner');
    if (!msg) {
      b.classList.add('hidden');
      b.textContent = '';
      return;
    }
    b.textContent = msg;
    b.classList.remove('hidden');
  }
  function readKey() {
    try {
      var q = new URLSearchParams(location.search).get('key');
      if (q) {
        localStorage.setItem(KEY, q);
        return q;
      }
      return localStorage.getItem(KEY) || '';
    } catch (e) {
      return '';
    }
  }
  function saveKey(k) {
    try {
      if (k) localStorage.setItem(KEY, k);
      else localStorage.removeItem(KEY);
    } catch (e) { /* ignore */ }
  }

  function render(j) {
    $('reportCard').classList.remove('hidden');
    $('natVol').textContent = fmtUsd(j.house && j.house.volumeUsd);
    $('partVol').textContent = fmtUsd(j.partners && j.partners.volumeUsd);
    $('natShare').textContent = pct(j.naturalShare);
    $('mtdLine').textContent =
      'MTD · house ' + fmtUsd(j.house && j.house.monthUsd) +
      ' · partners ' + fmtUsd(j.partners && j.partners.monthUsd) +
      ' · total ' + fmtUsd(j.totalVolumeUsd);
    $('houseNote').textContent = (j.house && j.house.note) || '';
    var rows = (j.partners && j.partners.byRef) || [];
    if (!rows.length) {
      $('partnerList').textContent = 'No partner-attributed volume yet.';
      return;
    }
    $('partnerList').innerHTML = rows.map(function (r) {
      return (
        '<div class="seat-lane">' +
        '<div class="seat-lane-top">' +
        '<div><strong class="mono">' + esc(r.ref) + '</strong></div>' +
        '<div style="text-align:right">' + fmtUsd(r.volumeUsd) +
        '<div class="mono" style="font-size:0.75rem">MTD ' + fmtUsd(r.monthUsd) + '</div></div>' +
        '</div></div>'
      );
    }).join('');
  }

  function load() {
    showErr('');
    var key = ($('opsKey').value || '').trim() || readKey();
    if (!key) {
      showErr('Paste your HOUSE_VIEW_KEY (or PARTNER_INGEST_KEY).');
      return;
    }
    saveKey(key);
    $('opsKey').value = key;
    $('loadBtn').disabled = true;
    // Single-segment /api/reach — nested /api/ops/reach 404s on this Vercel setup.
    fetch(apiBase() + '/api/reach', {
      headers: { Accept: 'application/json', 'X-Ops-Key': key },
      mode: 'cors'
    })
      .then(function (r) {
        return r.text().then(function (raw) {
          var j = null;
          try {
            j = raw ? JSON.parse(raw) : null;
          } catch (e) {
            j = null;
          }
          return { status: r.status, j: j, raw: raw };
        });
      })
      .then(function (res) {
        if (!res.j || !res.j.ok) {
          throw new Error(errText((res.j && res.j.error) || res.j, res.status));
        }
        render(res.j);
      })
      .catch(function (e) {
        $('reportCard').classList.add('hidden');
        showErr(errText(e && e.message ? e.message : e));
      })
      .then(function () {
        $('loadBtn').disabled = false;
      });
  }

  $('loadBtn').addEventListener('click', load);
  $('clearBtn').addEventListener('click', function () {
    saveKey('');
    $('opsKey').value = '';
    $('reportCard').classList.add('hidden');
    showErr('');
  });
  $('opsKey').value = readKey();
  if ($('opsKey').value) load();
})();
