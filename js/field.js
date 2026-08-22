/* Jockey field — side-by-side seat progression + attribution */
(function () {
  'use strict';
  var P = window.PoolPilotPartner;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function short(a) {
    if (!a) return '—';
    return a.slice(0, 6) + '…' + a.slice(-4);
  }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n < 10) return '$' + n.toFixed(2);
    return '$' + Math.round(n).toLocaleString();
  }
  function fmtVol(n) {
    if (n == null || !isFinite(n) || n <= 0) return '$0';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'k';
    return fmtUsd(n);
  }
  function apiBase() {
    return P && P.apiBase ? P.apiBase() : location.origin;
  }

  function render(board) {
    var r = board.round || {};
    var max = r.maxSeats || 12;
    var rows = board.board || [];
    var myRef = P && P.getRef ? P.getRef() : '';
    var earnerAt = (board.economics && board.economics.earnerVolumeUsd) || 25000;

    $('fieldKicker').textContent =
      'Round ' + (board.activeRound || 1) + ' · ' + max + ' lanes · Earner @ ' + fmtVol(earnerAt);

    var earners = rows.filter(function (s) { return s.path && s.path.earner; }).length;
    $('fieldMeta').textContent =
      rows.length + ' / ' + max + ' seated · ' + earners + ' earner' + (earners === 1 ? '' : 's') +
      ' · partner vol ' + fmtUsd(board.totalAttributedVolumeUsd);

    var lanes = [];
    for (var i = 0; i < max; i++) {
      lanes.push(rows[i] || null);
    }

    $('fieldTrack').innerHTML = lanes.map(function (s, idx) {
      var n = idx + 1;
      if (!s) {
        return (
          '<div class="jockey open" data-testid="jockey-open-' + n + '">' +
          '<div class="jockey-num">GATE ' + n + '</div>' +
          '<div class="jockey-ref">Open</div>' +
          '<div class="jockey-stage">Unclaimed</div>' +
          '<div class="jockey-rail"><div class="jockey-fill" style="height:0%"></div></div>' +
          '<div class="jockey-stats"><strong>—</strong>Buy a seat to claim</div>' +
          '</div>'
        );
      }
      var path = s.path || {};
      var stage = path.stage || {};
      var pct = Math.round((path.overallProgress != null ? path.overallProgress : 0) * 100);
      var earner = !!path.earner;
      var mine = myRef && s.ref === myRef;
      var cls = 'jockey' + (earner ? ' earner' : '') + (mine ? ' mine' : '');
      var badge = earner
        ? '<span class="jockey-badge">Earner · skim live</span>'
        : '<span class="jockey-badge queued">Queued · ' + esc(fmtVol(path.needToEarnUsd)) + ' to unlock</span>';
      var skimLine = earner
        ? 'Live skim ' + fmtUsd(path.liveSkimLifetimeUsd != null ? path.liveSkimLifetimeUsd : path.skimLifetimeUsd)
        : 'Cleared to treasury ' + fmtUsd(path.treasuryClearedSkimUsd != null ? path.treasuryClearedSkimUsd : path.skimLifetimeUsd);

      return (
        '<div class="' + cls + '" data-testid="jockey-' + esc(s.ref) + '">' +
        '<div class="jockey-num">LANE ' + n + (mine ? ' · YOU' : '') + '</div>' +
        '<div class="jockey-ref">' + esc(s.ref) + '</div>' +
        '<div class="jockey-stage">' + esc(stage.name || 'Seated') + ' · R' + (Number(s.round) === 2 ? '2' : '1') + '</div>' +
        '<div class="jockey-rail">' +
        '<div class="jockey-fill" style="height:' + pct + '%"></div>' +
        '<div class="jockey-marker" style="bottom:' + pct + '%"></div>' +
        '</div>' +
        '<div class="jockey-stats">' +
        '<strong>' + esc(fmtVol(s.workUsd)) + ' vol</strong>' +
        esc(short(s.wallet)) + '<br>' +
        esc(skimLine) + '<br>' +
        'MTD ' + fmtUsd(s.monthUsd) +
        '</div>' +
        badge +
        '</div>'
      );
    }).join('');

    // Stagger fill animation
    requestAnimationFrame(function () {
      var fills = document.querySelectorAll('.jockey-fill');
      fills.forEach(function (el, i) {
        var h = el.style.height;
        el.style.height = '0%';
        setTimeout(function () { el.style.height = h; }, 40 + i * 35);
      });
    });
  }

  function load() {
    return fetch(apiBase() + '/api/seats', { headers: { Accept: 'application/json' }, mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok) {
          $('fieldTrack').innerHTML = '<p class="bd-lead">Field unavailable — partner API offline?</p>';
          return;
        }
        render(j);
      })
      .catch(function () {
        $('fieldTrack').innerHTML = '<p class="bd-lead">Could not reach partner API.</p>';
      });
  }

  if (P) P.captureRefFromUrl();
  $('refreshBtn').addEventListener('click', load);
  load();
})();
