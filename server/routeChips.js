'use strict';

/**
 * Route chips — partner-scoped swap icons.
 * Visitors with ?ref= (sticky) see that partner's token right after MCFL.
 * Unrelated traffic does NOT see it. Global frontpage = $500 featured listing.
 * File: data/route-chips.json
 */

const fs = require('fs');
const path = require('path');
const { ensureDataDir } = require('./dataPath');
const { cleanRef, isHouseRef } = require('./store');

const FILE_PATH = () => path.join(ensureDataDir(), 'route-chips.json');
const MAX = 500;

function cleanWallet(raw) {
  const s = String(raw || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return '';
  return s.toLowerCase();
}

function cleanSymbol(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16);
}

function cleanIcon(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https:\/\//i.test(s) || /^data:image\//i.test(s)) return s.slice(0, 512);
  return '';
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

function publicChip(r) {
  return {
    ref: r.ref,
    address: r.address,
    symbol: r.symbol,
    iconUrl: r.iconUrl || '',
    source: r.source || 'route',
    t: r.t,
    routeOnly: true
  };
}

async function listRouteChips(q) {
  const ref = cleanRef(q && q.ref);
  let rows = readAll().map(publicChip).sort((a, b) => (b.t || 0) - (a.t || 0));
  if (ref && !isHouseRef(ref)) {
    rows = rows.filter((r) => r.ref === ref);
  } else if (!ref) {
    // Never dump all route chips publicly — empty without a ref.
    rows = [];
  } else {
    rows = [];
  }
  return {
    ok: true,
    ref: ref && !isHouseRef(ref) ? ref : '',
    count: rows.length,
    chips: rows,
    note: 'Route chips show only for visitors with this sticky ?ref=. Global top slot requires $500 featured listing.'
  };
}

/**
 * Upsert one chip per ref (latest token wins). Creator of a bond/seat route uses this.
 */
async function upsertRouteChip(input) {
  const ref = cleanRef(input && input.ref);
  const address = cleanWallet(input && input.address);
  const symbol = cleanSymbol(input && input.symbol) || 'TOKEN';
  const iconUrl = cleanIcon(input && input.iconUrl);
  const source = String((input && input.source) || 'route').slice(0, 32);

  if (!ref || isHouseRef(ref)) {
    const err = new Error('Partner ref required (not house)');
    err.status = 400;
    throw err;
  }
  if (!address) {
    const err = new Error('Token address required');
    err.status = 400;
    throw err;
  }

  const all = readAll();
  const idx = all.findIndex((r) => r.ref === ref);
  const row = {
    t: Date.now(),
    ref,
    address,
    symbol,
    iconUrl,
    source,
    bondId: String((input && input.bondId) || '').slice(0, 32)
  };
  if (idx >= 0) all[idx] = Object.assign({}, all[idx], row);
  else all.push(row);
  writeAll(all);
  return { ok: true, chip: publicChip(row) };
}

module.exports = {
  listRouteChips,
  upsertRouteChip,
  cleanWallet,
  cleanSymbol
};
