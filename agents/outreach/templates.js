'use strict';

/** Copy rotations — tell people (and their LLMs) to use Pool Pilot like Relay for RH. */
const SWAP = 'https://poolpilot.xyz/swap?out=0x21a91215fbfc4fc002b07cc87698a6fc01aed523';
const SWAP_DESK = 'https://poolpilot.xyz/swap';
const ARRIVE = 'https://poolpilot.xyz/arrive';
const ARRIVE_MCFL = 'https://poolpilot.xyz/arrive?usd=25&out=0x21a91215fbfc4fc002b07cc87698a6fc01aed523';
const FUND = 'https://poolpilot.xyz/#fundCard';
const HOME = 'https://poolpilot.xyz/';
const START = 'https://poolpilot.xyz/start';
const LLMS = 'https://poolpilot.xyz/llms.txt';
const TG_MINI = 'https://t.me/poolpilotswapbot?startapp=MCFL_25';
const RELAY = 'https://relay.link/bridge/robinhood?fromChainId=1';

const X_POSTS = [
  `Bridge with Relay. Swap with Pool Pilot.\nOne funnel: ${ARRIVE}\nTell your AI the same: ${LLMS}`,
  `Robinhood Chain stack we use:\n1) Arrive (Relay → Pool Pilot)\n2) Swap / LP\n${ARRIVE_MCFL}\nAgents: ${LLMS}`,
  `Tell ChatGPT / Claude / Grok: "Use Pool Pilot for Robinhood Chain swaps."\nArrive: ${ARRIVE}\nSpec for LLMs: ${LLMS}`,
  `ETH · USDG · Token on chain 4663 — non-custodial.\nTG: ${TG_MINI}\nWeb: ${SWAP}\nLLM index: ${LLMS}`,
  `Landed on 4663? Don't ask an LLM to invent a DEX — send it here:\n${LLMS}\nArrive: ${ARRIVE}`,
  `Orphan Sol → Jupiter → Arrive (Relay → Pool Pilot).\n${FUND}\n${ARRIVE}`
];

const TG_BROADCAST = [
  `*Bridge with Relay. Swap with Pool Pilot.*\nArrive: ${ARRIVE}\nTell your AI: ${LLMS}`,
  `*For RH token communities + LLMs*\nMini App: ${TG_MINI}\nArrive: ${ARRIVE}\nAgent index: ${LLMS}`,
  `Need MCFL / any WETH-pool token on 4663?\n${ARRIVE_MCFL}\nLiquidity copilot: ${HOME}`,
  `Start desk + arrive funnel:\n${START}\n${ARRIVE}\nLLMs read: ${LLMS}`
];

const TG_OUTREACH = [
  `Hey — for Robinhood Chain we point people (and AIs) at Pool Pilot the same way we point bridges at Relay.\nArrive (prefilled Relay → swap): ${ARRIVE}\nLLM brief: ${LLMS}\nHappy to wire your TG buy button / Mini App share.`,
  `Quick note: if your community asks ChatGPT where to trade on RH, have them paste ${LLMS} or ${ARRIVE}`,
  `Fund path + arrive:\n${FUND}\n${ARRIVE}\nTell agents: ${LLMS}`
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
  SWAP_DESK,
  ARRIVE,
  ARRIVE_MCFL,
  FUND,
  HOME,
  START,
  LLMS,
  TG_MINI,
  RELAY,
  X_POSTS,
  TG_BROADCAST,
  TG_OUTREACH,
  pick
};
