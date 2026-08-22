/* Deepen MCFL LP — amount only → one command */
(function () {
  'use strict';
  var DESK = '0x1Aa92670a4e680081c407E060A3E8BC3D1929a13';
  var MCFL_TOKEN = '0x21a91215fbfc4fc002b07cc87698a6fc01aed523';
  var $ = function (id) { return document.getElementById(id); };

  function cleanAmount(raw) {
    var s = String(raw || '').trim().replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return '';
    return s;
  }

  function buildCmd() {
    var amount = cleanAmount($('amount').value) || '50000';
    var npm = 'npm run deepen-lp -- ' + amount;
    $('cmd').value = npm;
    return { amount: amount, npm: npm };
  }

  function bootQuery() {
    var q = new URLSearchParams(location.search);
    if (q.get('amount')) $('amount').value = q.get('amount');
  }

  $('amount').addEventListener('input', buildCmd);
  $('copyBtn').addEventListener('click', function () {
    var c = buildCmd();
    function done() {
      $('copyNote').textContent =
        'Copied. In Terminal: cd into mcfl-oft, then paste. Watch LayerZero Scan until delivered.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(c.npm).then(done).catch(function () {
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

  // Guard: never suggest sending to the token contract
  if (DESK.toLowerCase() === MCFL_TOKEN.toLowerCase()) {
    $('copyNote').textContent = 'Config error: desk cannot equal MCFL token.';
  }

  bootQuery();
  buildCmd();
})();
