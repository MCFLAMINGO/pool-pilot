'use strict';

/**
 * USDG Bonding Desk — community funds a launch in USDG, then graduates to Uniswap + Super Chain queue.
 * File: data/bonds.json
 *
 * v1 = desk ledger (create / pledge / graduate). On-chain curve contracts can replace the ledger later
 * without changing the product story.
 */

const fs = require('fs');
const path = require('path');
const { ensureDataDir } = require('./dataPath');

const FILE_PATH = () => path.join(ensureDataDir(), 'bonds.json');
const MAX = 300;
const CREATE_PRICE_USD = 50;
/** Enough to seed a real RH Uniswap book and fund Super Chain OFT peers (Solana + Base + RH). */
const MIN_TARGET_USDG = 5000;
const DEFAULT_TARGET_USDG = 10000;
const MAX_TARGET_USDG = 500000;

function cleanWallet(raw) {
  const s = String(raw || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return '';
  return s.toLowerCase();
}

function cleanHash(raw) {
  const s = String(raw || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) return '';
  return s.toLowerCase();
}

function cleanSymbol(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16);
}

function cleanName(raw) {
  return String(raw || '')
    .trim()
    .replace(/[<>]/g, '')
    .slice(0, 48);
}

function cleanSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

function ensureFile() {
  const fp = FILE_PATH();
  if (!fs.existsSync(path.dirname(fp))) fs.mkdirSync(path.dirname(fp), { recursive: true });
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, '[]\n', 'utf8');
}

function readAll() {
  ensureFile();
  try {
    const arr = JSON.parse(fs.readFileSync(FILE_PATH(), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(arr) {
  ensureFile();
  fs.writeFileSync(FILE_PATH(), JSON.stringify(arr.slice(-MAX), null, 0) + '\n', 'utf8');
}

function raisedOf(b) {
  return (b.pledges || []).reduce((s, p) => s + (Number(p.usdg) || 0), 0);
}

function publicBond(b) {
  const raised = raisedOf(b);
  const target = Number(b.targetUsdg) || 0;
  return {
    id: b.id,
    name: b.name,
    symbol: b.symbol,
    creator: b.creator,
    targetUsdg: target,
    raisedUsdg: Math.round(raised * 100) / 100,
    progress: target > 0 ? Math.min(1, raised / target) : 0,
    status: b.status || 'open',
    pledges: (b.pledges || []).length,
    t: b.t,
    graduatedAt: b.graduatedAt || null,
    superChainQueued: !!b.superChainQueued,
    blurb: b.blurb || ''
  };
}

async function listBonds(q) {
  let rows = readAll().map(publicBond).sort((a, b) => (b.t || 0) - (a.t || 0));
  const status = String((q && q.status) || '').toLowerCase();
  if (status) rows = rows.filter((r) => r.status === status);
  const id = cleanSlug(q && q.id);
  if (id) rows = rows.filter((r) => r.id === id);
  return { ok: true, createPriceUsd: CREATE_PRICE_USD, minTargetUsdg: MIN_TARGET_USDG, defaultTargetUsdg: DEFAULT_TARGET_USDG, count: rows.length, bonds: rows };
}

async function getBond(id) {
  const slug = cleanSlug(id);
  const b = readAll().find((r) => r.id === slug);
  if (!b) {
    const err = new Error('Bond not found');
    err.status = 404;
    throw err;
  }
  return { ok: true, bond: publicBond(b), createPriceUsd: CREATE_PRICE_USD, minTargetUsdg: MIN_TARGET_USDG };
}

async function createBond(input) {
  const name = cleanName(input && input.name);
  const symbol = cleanSymbol(input && input.symbol);
  const creator = cleanWallet(input && input.creator);
  const hash = cleanHash(input && input.hash);
  const targetUsdg = Number(input && input.targetUsdg);
  const usd = Number(input && input.usd);
  const blurb = cleanName(input && input.blurb);

  if (!name || !symbol) {
    const err = new Error('Name and ticker required');
    err.status = 400;
    throw err;
  }
  if (!creator) {
    const err = new Error('Creator wallet required');
    err.status = 400;
    throw err;
  }
  if (!hash) {
    const err = new Error('Create fee tx hash required');
    err.status = 400;
    throw err;
  }
  if (!isFinite(targetUsdg) || targetUsdg < MIN_TARGET_USDG || targetUsdg > MAX_TARGET_USDG) {
    const err = new Error(
      'Target must be $' +
        MIN_TARGET_USDG.toLocaleString() +
        '–$' +
        MAX_TARGET_USDG.toLocaleString() +
        ' USDG (enough for Uniswap seed + Super Chain)'
    );
    err.status = 400;
    throw err;
  }
  if (!isFinite(usd) || usd < CREATE_PRICE_USD * 0.9 || usd > CREATE_PRICE_USD * 1.1) {
    const err = new Error('Create fee is $' + CREATE_PRICE_USD);
    err.status = 400;
    throw err;
  }

  const all = readAll();
  if (all.some((r) => r.hash === hash)) {
    return { ok: true, deduped: true, bond: publicBond(all.find((r) => r.hash === hash)) };
  }

  let id = cleanSlug(symbol) || 'bond';
  if (all.some((r) => r.id === id)) id = id + '-' + String(Date.now()).slice(-4);

  const row = {
    id,
    t: Date.now(),
    name,
    symbol,
    creator,
    hash,
    targetUsdg,
    blurb,
    status: 'open',
    pledges: [],
    superChainQueued: false,
    graduatedAt: null
  };
  all.push(row);
  writeAll(all);
  return { ok: true, deduped: false, bond: publicBond(row), createPriceUsd: CREATE_PRICE_USD };
}

async function pledgeBond(id, input) {
  const slug = cleanSlug(id);
  const wallet = cleanWallet(input && input.wallet);
  const hash = cleanHash(input && input.hash);
  const usdg = Number(input && input.usdg);

  if (!wallet) {
    const err = new Error('Wallet required');
    err.status = 400;
    throw err;
  }
  if (!hash) {
    const err = new Error('Pledge tx hash required');
    err.status = 400;
    throw err;
  }
  if (!isFinite(usdg) || usdg < 1 || usdg > 100000) {
    const err = new Error('Pledge $1–$100,000 USDG');
    err.status = 400;
    throw err;
  }

  const all = readAll();
  const idx = all.findIndex((r) => r.id === slug);
  if (idx < 0) {
    const err = new Error('Bond not found');
    err.status = 404;
    throw err;
  }
  const b = all[idx];
  if (b.status !== 'open') {
    const err = new Error('Bond is not open');
    err.status = 409;
    throw err;
  }
  if ((b.pledges || []).some((p) => p.hash === hash)) {
    return { ok: true, deduped: true, bond: publicBond(b) };
  }

  b.pledges = b.pledges || [];
  b.pledges.push({ t: Date.now(), wallet, hash, usdg });
  const raised = raisedOf(b);
  if (raised >= Number(b.targetUsdg)) {
    b.status = 'filled';
  }
  all[idx] = b;
  writeAll(all);
  return { ok: true, deduped: false, bond: publicBond(b) };
}

async function graduateBond(id, input) {
  const slug = cleanSlug(id);
  const wallet = cleanWallet(input && input.wallet);
  const all = readAll();
  const idx = all.findIndex((r) => r.id === slug);
  if (idx < 0) {
    const err = new Error('Bond not found');
    err.status = 404;
    throw err;
  }
  const b = all[idx];
  if (wallet && wallet !== b.creator) {
    const err = new Error('Only the creator can graduate');
    err.status = 403;
    throw err;
  }
  const raised = raisedOf(b);
  if (raised < Number(b.targetUsdg) * 0.95 && b.status !== 'filled') {
    const err = new Error('Bond not filled yet');
    err.status = 409;
    throw err;
  }
  b.status = 'graduated';
  b.graduatedAt = Date.now();
  b.superChainQueued = true;
  b.graduateNote = String((input && input.note) || 'graduate-uniswap+superchain').slice(0, 64);
  all[idx] = b;
  writeAll(all);
  return {
    ok: true,
    bond: publicBond(b),
    next: {
      uniswap: 'Seed Robinhood Uniswap v3 with raised USDG + token (50/50 book).',
      superChain: 'Super Chain OFT peers queued — Solana + Base + Robinhood after the RH book exists. Raise was sized for Uniswap seed + omni move.'
    }
  };
}

module.exports = {
  CREATE_PRICE_USD,
  MIN_TARGET_USDG,
  DEFAULT_TARGET_USDG,
  MAX_TARGET_USDG,
  listBonds,
  getBond,
  createBond,
  pledgeBond,
  graduateBond
};
