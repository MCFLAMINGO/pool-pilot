'use strict';

/** Copy rotations for fee-swap + RH fund loops. Keep under ~240 chars for X. */
const SWAP = 'https://poolpilot.xyz/swap?out=0x21a91215fbfc4fc002b07cc87698a6fc01aed523';
const FUND = 'https://poolpilot.xyz/#fundCard';
const HOME = 'https://poolpilot.xyz/';
const START = 'https://poolpilot.xyz/start';

const X_POSTS = [
  `Robinhood Chain swap without the maze: ETH ↔ token, one amount, one button. 0.30% protocol fee. You sign — we custody nothing.\n${SWAP}`,
  `Landed on chain 4663? Buy MCFL (or any WETH-pool token) here:\n${SWAP}`,
  `Pool Pilot now has a no-thinking swap on Robinhood Chain. Same product family as the LP copilot.\n${SWAP}`,
  `Orphan Sol bag → sell on Jupiter → bridge ETH → trade on RH.\nFund path: ${FUND}\nSwap: ${SWAP}`,
  `Check your RH Uniswap book, then fund the next move with a fee swap that pays the treasury in the open.\n${HOME}`
];

const TG_BROADCAST = [
  `*Pool Pilot Swap is live on Robinhood Chain*\nETH ↔ token · 0.30% protocol fee · you sign every tx\n${SWAP}`,
  `Need MCFL for desk / LP fees? One tap:\n${SWAP}\nLiquidity tools stay at ${HOME}`,
  `Bring value to RH: bridge ETH, or cash out orphan Sol then bridge.\n${FUND}\nThen swap: ${SWAP}`,
  `Start desk for serious launches (Stage + MCFL rails):\n${START}\nSwap for gas/token: ${SWAP}`
];

const TG_OUTREACH = [
  `Hey — we shipped a simple Robinhood Chain swap (ETH ↔ your token if it has a WETH pool). Prefill link if useful:\n${SWAP}\nHappy to wire your TG buy button to it.`,
  `Quick note from Pool Pilot: LP copilot + fee swap on chain 4663. If your book is thin we can check it live:\n${HOME}`,
  `If you're moving value onto Robinhood Chain, this is the no-thinking path we use:\n${FUND}\nSwap when you're there: ${SWAP}`
];

function pick(list, salt) {
  const i = Math.abs(hash(salt)) % list.length;
  return list[i];
}

function hash(s) {
  let h = 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h;
}

module.exports = {
  SWAP,
  FUND,
  HOME,
  START,
  X_POSTS,
  TG_BROADCAST,
  TG_OUTREACH,
  pick
};
