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
    fetch(apiBase() + '/api/ops/reach', {
      headers: { Accept: 'application/json', 'X-Ops-Key': key },
      mode: 'cors'
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { status: r.status, j: j };
        });
      })
      .then(function (res) {
        if (!res.j || !res.j.ok) {
          throw new Error((res.j && res.j.error) || ('HTTP ' + res.status));
        }
        render(res.j);
      })
      .catch(function (e) {
        $('reportCard').classList.add('hidden');
        showErr((e && e.message) || String(e));
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
