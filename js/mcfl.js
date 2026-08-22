/* MCFL Solana → Robinhood OFT helper */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function cleanTo(raw) {
    var s = String(raw || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return '';
    return s;
  }

  function cleanAmount(raw) {
    var s = String(raw || '').trim().replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return '';
    return s;
  }

  function buildCmd() {
    var amount = cleanAmount($('amount').value) || '100';
    var to = cleanTo($('to').value) || '0xYOUR_ROBINHOOD_WALLET';
    var npm = 'npm run bridge:rh -- ' + amount + ' ' + to;
    var sh = './scripts/bridge-sol-to-rh.sh ' + amount + ' ' + to;
    $('cmd').value =
      '# from mcfl-oft repo (Solana key in .env)\n' +
      npm + '\n' +
      '# or: ' + sh;
    return { amount: amount, to: to, npm: npm };
  }

  function bootQuery() {
    var q = new URLSearchParams(location.search);
    if (q.get('amount')) $('amount').value = q.get('amount');
    if (q.get('to')) $('to').value = q.get('to');
  }

  $('amount').addEventListener('input', buildCmd);
  $('to').addEventListener('input', buildCmd);
  $('copyBtn').addEventListener('click', function () {
    var c = buildCmd();
    var text = c.npm;
    function done() {
      $('copyNote').textContent =
        cleanTo(c.to)
          ? 'Copied. Run it in mcfl-oft, then watch LayerZero Scan.'
          : 'Copied template — paste your 0x Robinhood address before running.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        $('cmd').select();
        document.execCommand('copy');
        done();
      });
    } else {
      $('cmd').select();
      document.execCommand('copy');
      done();
    }
  });

  bootQuery();
  buildCmd();
})();
