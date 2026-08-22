'use strict';

/**
 * Front-page featured token listings — $500 easy-click chip slot.
 * File: data/token-listings.json  |  Postgres when DATABASE_URL set.
 */

const fs = require('fs');
const path = require('path');
const { ensureDataDir } = require('./dataPath');

const FILE_PATH = () => path.join(ensureDataDir(), 'token-listings.json');
const MAX_LISTINGS = 200;
const LISTING_PRICE_USD = 500;
/** Allow ±8% around $500 so ETH price drift does not reject honest pays. */
const USD_TOLERANCE = 0.08;

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

function dbUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.LOCAL_INTEL_DB_URL || '';
}

function usePostgres() {
  return Boolean(dbUrl());
}

function ensureFile() {
  const fp = FILE_PATH();
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, '[]\n', 'utf8');
}

function readFileListings() {
  ensureFile();
  try {
    const arr = JSON.parse(fs.readFileSync(FILE_PATH(), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeFileListings(arr) {
  ensureFile();
  fs.writeFileSync(FILE_PATH(), JSON.stringify(arr.slice(-MAX_LISTINGS), null, 0) + '\n', 'utf8');
}

let pgPool = null;
async function getPg() {
  if (pgPool) return pgPool;
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: dbUrl(),
    ssl: dbUrl().includes('localhost') || dbUrl().includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false }
  });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS token_listings (
      id SERIAL PRIMARY KEY,
      t BIGINT NOT NULL,
      address TEXT NOT NULL,
      symbol TEXT NOT NULL,
      wallet TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      usd DOUBLE PRECISION NOT NULL,
      eth DOUBLE PRECISION,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_token_listings_address ON token_listings (address);
  `);
  return pgPool;
}

async function loadAll() {
  if (usePostgres()) {
    const pg = await getPg();
    const r = await pg.query(
      'SELECT t, address, symbol, wallet, hash, usd, eth, note FROM token_listings ORDER BY t ASC'
    );
    return r.rows.map((row) => ({
      t: Number(row.t),
      address: row.address,
      symbol: row.symbol,
      wallet: row.wallet,
      hash: row.hash,
      usd: Number(row.usd),
      eth: row.eth != null ? Number(row.eth) : null,
      note: row.note || '',
      featured: true
    }));
  }
  return readFileListings().map((row) => Object.assign({}, row, { featured: true }));
}

async function getListings() {
  const rows = await loadAll();
  // Newest paid listing wins for a given address
  const byAddr = Object.create(null);
  rows.forEach((r) => {
    byAddr[r.address] = r;
  });
  const featured = Object.keys(byAddr)
    .map((k) => byAddr[k])
    .sort((a, b) => (b.t || 0) - (a.t || 0));
  return {
    ok: true,
    priceUsd: LISTING_PRICE_USD,
    count: featured.length,
    featured: featured.map((r) => ({
      symbol: r.symbol,
      address: r.address,
      featured: true,
      paid: true,
      t: r.t,
      wallet: r.wallet
    }))
  };
}

async function registerListing(input) {
  const address = cleanWallet(input && input.address);
  const symbol = cleanSymbol(input && input.symbol);
  const wallet = cleanWallet(input && input.wallet);
  const hash = cleanHash(input && input.hash);
  const usd = Number(input && input.usd);
  const eth = input && input.eth != null ? Number(input.eth) : null;
  const amountIn = input && input.amountIn != null ? Number(input.amountIn) : null;
  let asset = String((input && input.asset) || '').trim().toUpperCase();
  if (asset !== 'ETH' && asset !== 'USDG') {
    asset = eth != null && isFinite(eth) ? 'ETH' : (amountIn != null ? 'USDG' : '');
  }

  if (!address) {
    const err = new Error('Token address required');
    err.status = 400;
    throw err;
  }
  if (!symbol || symbol.length < 1) {
    const err = new Error('Token symbol required');
    err.status = 400;
    throw err;
  }
  if (!wallet) {
    const err = new Error('Payer wallet required');
    err.status = 400;
    throw err;
  }
  if (!hash) {
    const err = new Error('Payment tx hash required');
    err.status = 400;
    throw err;
  }
  if (!isFinite(usd) || usd < LISTING_PRICE_USD * (1 - USD_TOLERANCE) || usd > LISTING_PRICE_USD * (1 + USD_TOLERANCE)) {
    const err = new Error('Listing is $' + LISTING_PRICE_USD + ' (±' + Math.round(USD_TOLERANCE * 100) + '%)');
    err.status = 400;
    throw err;
  }

  const all = await loadAll();
  if (all.some((r) => r.hash === hash)) {
    return { ok: true, deduped: true, listing: all.find((r) => r.hash === hash) };
  }

  var row = {
    t: Date.now(),
    address,
    symbol,
    wallet,
    hash,
    usd,
    eth: isFinite(eth) ? eth : null,
    asset: asset,
    amountIn: isFinite(amountIn) ? amountIn : null,
    note: String((input && input.note) || 'featured-listing').slice(0, 64),
    featured: true
  };

  if (usePostgres()) {
    const pg = await getPg();
    try {
      await pg.query(
        `INSERT INTO token_listings (t, address, symbol, wallet, hash, usd, eth, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.t, row.address, row.symbol, row.wallet, row.hash, row.usd, row.eth, row.note]
      );
    } catch (e) {
      if (e && e.code === '23505') {
        const existing = (await loadAll()).find((r) => r.hash === hash);
        return { ok: true, deduped: true, listing: existing };
      }
      throw e;
    }
  } else {
    const arr = readFileListings();
    arr.push(row);
    writeFileListings(arr);
  }

  return { ok: true, deduped: false, listing: row, priceUsd: LISTING_PRICE_USD };
}

module.exports = {
  LISTING_PRICE_USD,
  getListings,
  registerListing,
  cleanWallet,
  cleanSymbol,
  cleanHash
};
