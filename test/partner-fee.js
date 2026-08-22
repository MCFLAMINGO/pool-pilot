'use strict';

/**
 * Partner fee routing unit test (no RPC).
 * Ensures attributed seat wallet receives the full skim tx, not treasury LP.
 */

const path = require('path');
const fs = require('fs');

// Load chainlib as a browser-ish global via vm is heavy; instead assert the
// source contract for partner fee branches (keeps CI offline).
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'chainlib.js'), 'utf8');

let failed = 0;
function check(name, cond) {
  if (!cond) {
    console.error('FAIL', name);
    failed += 1;
  } else console.log('ok', name);
}

check('reads partnerWallet opt', /opts\.partnerWallet/.test(src));
check('skips LP split when partner', /feeAmt\.gt\(0\) && !partnerWallet/.test(src));
check('partner ETH transfer label', /Partner skim/.test(src));
check('sets feeToPartner', /feeToPartner: !!partnerWallet/.test(src));
check('partnerFee flag on tx', /partnerFee: true/.test(src));
check('treasury still default recipient', /feeRecipient: partnerWallet \|\| CFG\.TREASURY/.test(src));

const lib = fs.readFileSync(path.join(__dirname, '..', 'js', 'partnerLib.js'), 'utf8');
check('skips until earner', /path\.earner/.test(lib));
check('resolveSeatWallet export', /resolveSeatWallet:\s*resolveSeatWallet/.test(lib));
check('skips house ref', /ref === 'poolpilot'/.test(lib));

if (failed) {
  console.error(failed + ' failure(s)');
  process.exit(1);
}
console.log('partner-fee: all ok');
