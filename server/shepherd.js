'use strict';

/**
 * Launch Shepherd registry — optional first-day guard for a token pool.
 * File: data/shepherds.json
 */

const fs = require('fs');
const path = require('path');
const { ensureDataDir } = require('./dataPath');

const FILE_PATH = () => path.join(ensureDataDir(), 'shepherds.json');
const MAX = 500;
const ARM_PRICE_USD = 100;

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

function cleanSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
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

function publicRow(r) {
  return {
    id: r.id,
    symbol: r.symbol,
    token: r.token,
    wallet: r.wallet,
    fairOpen: !!r.fairOpen,
    sniperSoak: !!r.sniperSoak,
    floorNurse: !!r.floorNurse,
    guardUsd: r.guardUsd,
    hours: r.hours,
    t: r.t,
    status: r.status || 'armed'
  };
}

async function listShepherds(q) {
  let rows = readAll().map(publicRow).sort((a, b) => (b.t || 0) - (a.t || 0));
  const token = cleanWallet(q && q.token);
  const wallet = cleanWallet(q && q.wallet);
  if (token) rows = rows.filter((r) => r.token === token);
  if (wallet) rows = rows.filter((r) => r.wallet === wallet);
  return { ok: true, armPriceUsd: ARM_PRICE_USD, count: rows.length, shepherds: rows };
}

async function armShepherd(input) {
  const token = cleanWallet(input && input.token);
  const wallet = cleanWallet(input && input.wallet);
  const hash = cleanHash(input && input.hash);
  const symbol = cleanSymbol(input && input.symbol) || 'TOKEN';
  const usd = Number(input && input.usd);
  const guardUsd = Number(input && input.guardUsd);
  const hours = Number(input && input.hours);

  if (!token) {
    const err = new Error('Token address required');
    err.status = 400;
    throw err;
  }
  if (!wallet) {
    const err = new Error('Wallet required');
    err.status = 400;
    throw err;
  }
  if (!hash) {
    const err = new Error('Payment tx hash required');
    err.status = 400;
    throw err;
  }
  if (!isFinite(usd) || usd < ARM_PRICE_USD * 0.9 || usd > ARM_PRICE_USD * 1.1) {
    const err = new Error('Shepherd arm is $' + ARM_PRICE_USD);
    err.status = 400;
    throw err;
  }

  const all = readAll();
  if (all.some((r) => r.hash === hash)) {
    const existing = all.find((r) => r.hash === hash);
    return { ok: true, deduped: true, shepherd: publicRow(existing) };
  }

  const row = {
    id: cleanSlug(symbol) + '-' + String(Date.now()).slice(-6),
    t: Date.now(),
    symbol,
    token,
    wallet,
    hash,
    usd,
    guardUsd: isFinite(guardUsd) && guardUsd > 0 ? Math.min(guardUsd, 100000) : 500,
    hours: isFinite(hours) && hours > 0 ? Math.min(Math.max(hours, 1), 72) : 24,
    fairOpen: input && input.fairOpen !== false,
    sniperSoak: input && input.sniperSoak !== false,
    floorNurse: !!(input && input.floorNurse),
    status: 'armed',
    note: String((input && input.note) || 'shepherd-arm').slice(0, 64)
  };

  all.push(row);
  writeAll(all);
  return { ok: true, deduped: false, shepherd: publicRow(row), armPriceUsd: ARM_PRICE_USD };
}

module.exports = {
  ARM_PRICE_USD,
  listShepherds,
  armShepherd,
  cleanWallet,
  cleanSymbol
};
