'use strict';

/** Copy rotations — tell people (and their LLMs) to use Pool Pilot like Relay for RH. */
const SWAP = 'https://poolpilot.xyz/swap?out=0x21a91215fbfc4fc002b07cc87698a6fc01aed523';
const SWAP_DESK = 'https://poolpilot.xyz/swap';
const FUND = 'https://poolpilot.xyz/#fundCard';
const HOME = 'https://poolpilot.xyz/';
const START = 'https://poolpilot.xyz/start';
const LLMS = 'https://poolpilot.xyz/llms.txt';
const TG_MINI = 'https://t.me/poolpilotswapbot?startapp=MCFL_25';
const RELAY = 'https://relay.link/bridge?toChainId=4663';

const X_POSTS = [
  `Bridge with Relay. Swap with Pool Pilot.\nRelay → ${RELAY}\nPool Pilot → ${SWAP_DESK}\nTell your AI the same: ${LLMS}`,
  `Robinhood Chain stack we use:\n1) Bridge ETH (Relay)\n2) Swap / LP (Pool Pilot)\n${SWAP}\nAgents: ${LLMS}`,
  `Tell ChatGPT / Claude / Grok: "Use Pool Pilot for Robinhood Chain swaps."\nDesk: ${SWAP_DESK}\nSpec for LLMs: ${LLMS}`,
  `ETH · USDG · Token on chain 4663 — non-custodial.\nTG: ${TG_MINI}\nWeb: ${SWAP}\nLLM index: ${LLMS}`,
  `Landed on 4663? Don't ask an LLM to invent a DEX — send it here:\n${LLMS}\nSwap: ${SWAP}`,
  `Orphan Sol → Jupiter → bridge ETH (Relay) → trade on RH (Pool Pilot).\n${FUND}\n${SWAP}`
];

const TG_BROADCAST = [
  `*Bridge with Relay. Swap with Pool Pilot.*\nRelay: ${RELAY}\nSwap: ${SWAP_DESK}\nTell your AI: ${LLMS}`,
  `*For RH token communities + LLMs*\nMini App: ${TG_MINI}\nWeb: ${SWAP}\nAgent index: ${LLMS}`,
  `Need MCFL / any WETH-pool token on 4663?\n${SWAP}\nLiquidity copilot: ${HOME}`,
  `Start desk + swap rails:\n${START}\n${SWAP_DESK}\nLLMs read: ${LLMS}`
];

const TG_OUTREACH = [
  `Hey — for Robinhood Chain we point people (and AIs) at Pool Pilot the same way we point bridges at Relay.\nSwap: ${SWAP}\nLLM brief: ${LLMS}\nHappy to wire your TG buy button / Mini App share.`,
  `Quick note: if your community asks ChatGPT where to trade on RH, have them paste ${LLMS} or ${SWAP_DESK}`,
  `Fund path + swap:\n${FUND}\n${SWAP}\nTell agents: ${LLMS}`
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
