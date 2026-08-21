'use strict';

/**
 * Paste-ready blurbs for Robinhood token Telegram communities.
 * Used by the share bot and CLI: node agents/outreach/shareKit.js MCFL
 */

const path = require('path');
const fs = require('fs');

const SWAP_BASE = 'https://poolpilot.xyz/swap';
const TG_APP = 'https://poolpilot.xyz/tg-swap';
/** After BotFather Main Mini App points at tg-swap — communities open this. */
const TG_MINI = 'https://t.me/poolpilotswapbot';
const HOME = 'https://poolpilot.xyz/';
const CHANNEL = 'https://t.me/poolpilot';
const BOT = 'https://t.me/poolpilotswapbot';

function loadTokens() {
  const p = path.join(__dirname, '../../js/rhTokens.js');
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(/RH_TOKENS\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  try { return Function('"use strict"; return (' + m[1] + ')')(); }
  catch (e) { return []; }
}

const TOKENS = loadTokens();

function resolveToken(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) {
    const known = TOKENS.find((t) => t.address.toLowerCase() === s.toLowerCase());
    return {
      symbol: known ? known.symbol : 'TOKEN',
      address: s.toLowerCase()
    };
  }
  const sym = s.replace(/^\$/, '').toUpperCase();
  const known = TOKENS.find((t) => t.symbol.toUpperCase() === sym);
  if (known) return { symbol: known.symbol, address: known.address };
  return null;
}

function links(token, usd) {
  const u = usd || 25;
  const out = token.address;
  const start = `${token.symbol}_${u}`;
  const startUsdg = `USDG_${token.symbol}_${u}`;
  return {
    buyEth: `${SWAP_BASE}?usd=${u}&out=${out}`,
    buyUsdg: `${SWAP_BASE}?in=usdg&to=token&usd=${u}&out=${out}`,
    sell: `${SWAP_BASE}?side=sell&out=${out}`,
    desk: SWAP_BASE,
    /** Telegram Mini App — what guys send to other communities */
    mini: `${TG_MINI}?startapp=${start}`,
    miniUsdg: `${TG_MINI}?startapp=${startUsdg}`,
    tgWeb: `${TG_APP}?out=${out}&usd=${u}`
  };
}

/** Short blurbs guys can paste into other RH token chats. */
function communityPack(token, usd) {
  const t = resolveToken(token);
  if (!t) {
    return {
      ok: false,
      text: 'Unknown token. Try a symbol from the seed list (MCFL, ANSEM, …) or a 0x address.\nExample: /share MCFL'
    };
  }
  const L = links(t, usd);
  const u = usd || 25;
  const blurbs = [
    `${t.symbol} swap inside Telegram (Pool Pilot Mini App):\n${L.mini}\nETH · USDG · Token on Robinhood Chain. You sign — nothing custodied.`,
    `Buy $${u} of ${t.symbol} with USDG — open in TG:\n${L.miniUsdg}`,
    `${t.symbol} on Robinhood Chain (web desk):\n$${u} → ${t.symbol}: ${L.buyEth}\nYou sign. Nothing custodied.`
  ];
  return {
    ok: true,
    token: t,
    links: L,
    text:
      `📋 *Send this to ${t.symbol} communities*\n\n` +
      `*Best (Telegram Mini App)*\n\`\`\`\n${blurbs[0]}\n\`\`\`\n\n` +
      `*USDG cash leg*\n\`\`\`\n${blurbs[1]}\n\`\`\`\n\n` +
      `*Web fallback*\n\`\`\`\n${blurbs[2]}\n\`\`\`\n\n` +
      `Links:\n• Mini App: ${L.mini}\n• USDG Mini: ${L.miniUsdg}\n• Web: ${L.buyEth}`
  };
}

function generalKit() {
  return (
    `📋 *Pool Pilot Mini App — for RH token communities*\n\n` +
    `Your guys send a *Telegram link*. Traders open the swap *inside TG*. Every swap pays *0.30%* to the desk treasury.\n\n` +
    `*Generic*\n` +
    `\`\`\`\n` +
    `Bridge with Relay. Swap with Pool Pilot on Robinhood Chain.\n` +
    `${TG_MINI}\n` +
    `Web: ${SWAP_BASE}\n` +
    `Tell your AI: https://poolpilot.xyz/llms.txt\n` +
    `\`\`\`\n\n` +
    `*Per-token Mini App*\n` +
    `DM bot: /share MCFL\n` +
    `Or: /share ANSEM 50\n\n` +
    `*Web desk*\n${SWAP_BASE}\n` +
    `*Channel*\n${CHANNEL}`
  );
}

function startText() {
  return (
    `*Pool Pilot Mini App*\n\n` +
    `Give RH token communities a swap *inside Telegram*.\n` +
    `You earn via the *0.30% protocol fee* on every swap through the desk.\n\n` +
    `Commands:\n` +
    `/share MCFL — Mini App link + blurbs for that community\n` +
    `/kit — generic pack\n` +
    `/swap — open web desk\n` +
    `/usdg — $25 USDG → MCFL Mini link\n\n` +
    `Open Mini App: ${TG_MINI}\n` +
    `Web: ${SWAP_BASE}`
  );
}

function helpText() {
  return startText();
}

function swapText() {
  return `Open the desk:\n${SWAP_BASE}\n\nOr get a community blurb: /share MCFL`;
}

function usdgText() {
  const L = links({ symbol: 'MCFL', address: '0x21a91215fbfc4fc002b07cc87698a6fc01aed523' }, 25);
  return (
    `$25 USDG → MCFL (Mini App):\n${L.miniUsdg}\n\n` +
    `Paste for communities:\n\`\`\`\nBuy $25 MCFL with USDG in Telegram:\n${L.miniUsdg}\n\`\`\``
  );
}

if (require.main === module) {
  const arg = process.argv[2] || 'MCFL';
  const usd = Number(process.argv[3]) || 25;
  if (arg === 'kit') {
    console.log(generalKit().replace(/\*/g, '').replace(/```/g, ''));
  } else {
    const pack = communityPack(arg, usd);
    console.log(pack.text.replace(/\*/g, '').replace(/```/g, ''));
  }
}

module.exports = {
  SWAP_BASE,
  TG_APP,
  TG_MINI,
  HOME,
  CHANNEL,
  BOT,
  TOKENS,
  resolveToken,
  links,
  communityPack,
  generalKit,
  startText,
  helpText,
  swapText,
  usdgText
};
