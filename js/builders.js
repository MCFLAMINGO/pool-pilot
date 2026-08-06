/* builders.js — load the playbook prompt and wire the copy button. No wallet code on this page. */
(function () {
  'use strict';
  var box = document.getElementById('promptBox');
  var btn = document.getElementById('copyBtn');
  var note = document.getElementById('copiedNote');
  var promptText = '';

  fetch('builders-prompt.md').then(function (r) { return r.text(); }).then(function (md) {
    // The shareable prompt starts after the first horizontal rule.
    var cut = md.indexOf('\n---\n');
    promptText = (cut > -1 ? md.slice(cut + 5) : md).trim();
    box.textContent = promptText;
  }).catch(function () {
    box.textContent = 'Could not load the playbook. Download the .md instead.';
  });

  btn.addEventListener('click', function () {
    if (!promptText) return;
    function done() {
      note.style.display = 'inline';
      btn.textContent = 'Copied';
      setTimeout(function () { note.style.display = 'none'; btn.textContent = 'Copy the prompt'; }, 2500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(promptText).then(done).catch(function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = promptText;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  });
})();
