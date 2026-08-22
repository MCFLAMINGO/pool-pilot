'use strict';

/**
 * Partner seat registry — buy-in rounds + capital/work share board.
 * File: data/partner-seats.json  |  Postgres when DATABASE_URL set.
 */

const fs = require('fs');
const path = require('path');
const eventsStore = require('./store');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'partner-seats.json');
const MAX_SEATS_FILE = 500;

/** Round 1 = smaller guys; advances when raised or attributed volume clears thresholds. */
const ROUNDS = {
  1: {
    id: 1,
    name: 'Round 1 — early seats',
    usdMin: 100,
    usdMax: 500,
    maxSeats: 15,
    advanceRaisedUsd: 7500,
    advanceVolumeUsd: 50000
  },
  2: {
    id: 2,
    name: 'Round 2 — growth seats',
    usdMin: 1000,
    usdMax: 5000,
    maxSeats: 30,
    advanceRaisedUsd: Infinity,
    advanceVolumeUsd: Infinity
  }
};

const CAPITAL_WEIGHT = 0.6;
const WORK_WEIGHT = 0.4;

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

function dbUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.LOCAL_INTEL_DB_URL || '';
}

function usePostgres() {
  return Boolean(dbUrl());
}

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) fs.writeFileSync(FILE_PATH, '[]\n', 'utf8');
}

function readFileSeats() {
  ensureFile();
  try {
    const arr = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeFileSeats(arr) {
  ensureFile();
  fs.writeFileSync(FILE_PATH, JSON.stringify(arr.slice(-MAX_SEATS_FILE), null, 0) + '\n', 'utf8');
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
    CREATE TABLE IF NOT EXISTS partner_seats (
      id BIGSERIAL PRIMARY KEY,
      t TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      round INT NOT NULL DEFAULT 1,
      ref TEXT NOT NULL DEFAULT '',
      wallet TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL DEFAULT '',
      symbol TEXT NOT NULL DEFAULT '',
      pool TEXT NOT NULL DEFAULT '',
      usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      eth DOUBLE PRECISION,
      hash TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS partner_seats_hash_uidx
      ON partner_seats (hash) WHERE hash <> '';
    CREATE INDEX IF NOT EXISTS partner_seats_ref_idx ON partner_seats (ref);
    CREATE INDEX IF NOT EXISTS partner_seats_wallet_idx ON partner_seats (wallet);
  `);
  return pgPool;
}

async function loadAllSeats() {
  if (usePostgres()) {
    const pool = await getPg();
    const r = await pool.query(
      `SELECT EXTRACT(EPOCH FROM t)*1000 AS t, round, ref, wallet, token, symbol, pool, usd, eth, hash, note
       FROM partner_seats ORDER BY t ASC`
    );
    return r.rows.map((e) => ({
      t: Number(e.t),
      round: Number(e.round) || 1,
      ref: e.ref,
      wallet: e.wallet,
      token: e.token,
      symbol: e.symbol,
      pool: e.pool,
      usd: Number(e.usd) || 0,
      eth: e.eth != null ? Number(e.eth) : null,
      hash: e.hash,
      note: e.note
    }));
  }
  return readFileSeats();
}

function aggregateVolumeByRef(eventRows) {
  const map = Object.create(null);
  (eventRows || []).forEach((e) => {
    if (!e || e.kind !== 'swap') return;
    const ref = eventsStore.cleanRef(e.ref);
    if (!ref) return;
    const usd = e.usd != null && isFinite(e.usd) ? Number(e.usd) : 0;
    map[ref] = (map[ref] || 0) + usd;
  });
  return map;
}

async function volumeMap() {
  if (usePostgres()) {
    try {
      const pool = await getPg();
      // Ensure events table exists (same migrate as partner store).
      await eventsStore.health();
      const r = await pool.query(
        `SELECT ref, COALESCE(SUM(usd) FILTER (WHERE kind = 'swap'), 0)::float AS usd
         FROM partner_events WHERE ref <> '' GROUP BY ref`
      );
      const map = Object.create(null);
      r.rows.forEach((row) => {
        map[row.ref] = Number(row.usd) || 0;
      });
      return map;
    } catch {
      /* partner_events may not exist yet */
    }
  }
  try {
    if (!fs.existsSync(path.join(DATA_DIR, 'partner-events.json'))) return Object.create(null);
    const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'partner-events.json'), 'utf8'));
    return aggregateVolumeByRef(Array.isArray(arr) ? arr : []);
  } catch {
    return Object.create(null);
  }
}

function computeRoundState(seats, volMap) {
  const byRound = { 1: [], 2: [] };
  seats.forEach((s) => {
    const r = Number(s.round) === 2 ? 2 : 1;
    byRound[r].push(s);
  });

  const raised1 = byRound[1].reduce((a, s) => a + (Number(s.usd) || 0), 0);
  const volTotal = Object.keys(volMap).reduce((a, k) => a + (volMap[k] || 0), 0);
  const r1 = ROUNDS[1];
  let active = 1;
  if (
    byRound[1].length >= r1.maxSeats ||
    raised1 >= r1.advanceRaisedUsd ||
    volTotal >= r1.advanceVolumeUsd
  ) {
    active = 2;
  }

  const cfg = ROUNDS[active];
  const activeSeats = byRound[active];
  const raised = activeSeats.reduce((a, s) => a + (Number(s.usd) || 0), 0);
  const seatsLeft = Math.max(0, cfg.maxSeats - activeSeats.length);

  return {
    activeRound: active,
    round: cfg,
    rounds: ROUNDS,
    raisedUsd: raised,
    seatsTaken: activeSeats.length,
    seatsLeft,
    open: seatsLeft > 0,
    totalAttributedVolumeUsd: volTotal,
    advance: {
      raisedUsd: raised1,
      volumeUsd: volTotal,
      needRaised: r1.advanceRaisedUsd,
      needVolume: r1.advanceVolumeUsd
    }
  };
}

function withShares(seats, volMap, roundId) {
  const inRound = seats.filter((s) => Number(s.round) === Number(roundId));
  const capitalTotal = inRound.reduce((a, s) => a + (Number(s.usd) || 0), 0) || 0;
  let workTotal = 0;
  inRound.forEach((s) => {
    workTotal += volMap[s.ref] || 0;
  });

  return inRound.map((s) => {
    const capitalShare = capitalTotal > 0 ? (Number(s.usd) || 0) / capitalTotal : 0;
    const workUsd = volMap[s.ref] || 0;
    const workShare = workTotal > 0 ? workUsd / workTotal : 0;
    const seatShare = CAPITAL_WEIGHT * capitalShare + WORK_WEIGHT * workShare;
    return {
      ...s,
      workUsd,
      capitalShare,
      workShare,
      seatShare,
      weights: { capital: CAPITAL_WEIGHT, work: WORK_WEIGHT }
    };
  }).sort((a, b) => b.seatShare - a.seatShare);
}

async function getBoard(opts) {
  opts = opts || {};
  const seats = await loadAllSeats();
  const volMap = await volumeMap();
  const roundState = computeRoundState(seats, volMap);
  const roundId = opts.round != null ? Number(opts.round) : roundState.activeRound;
  const board = withShares(seats, volMap, roundId);
  let mine = null;
  const ref = eventsStore.cleanRef(opts.ref || '');
  const wallet = cleanWallet(opts.wallet || '');
  if (ref || wallet) {
    mine =
      board.find((s) => (ref && s.ref === ref) || (wallet && s.wallet === wallet)) ||
      withShares(seats, volMap, 1).find((s) => (ref && s.ref === ref) || (wallet && s.wallet === wallet)) ||
      withShares(seats, volMap, 2).find((s) => (ref && s.ref === ref) || (wallet && s.wallet === wallet)) ||
      null;
  }
  return {
    ok: true,
    ...roundState,
    board,
    mine,
    store: usePostgres() ? 'postgres' : 'file'
  };
}

async function registerSeat(input) {
  const roundState = await getBoard({});
  const cfg = roundState.round;
  if (!roundState.open) {
    const err = new Error('This round is full');
    err.status = 409;
    throw err;
  }

  const usd = Number(input && input.usd);
  if (!isFinite(usd) || usd < cfg.usdMin || usd > cfg.usdMax) {
    const err = new Error('Buy-in must be $' + cfg.usdMin + '–$' + cfg.usdMax + ' for ' + cfg.name);
    err.status = 400;
    throw err;
  }

  const ref = eventsStore.cleanRef(input && input.ref);
  const wallet = cleanWallet(input && input.wallet);
  const hash = cleanHash(input && input.hash);
  if (!ref) {
    const err = new Error('Partner ref required');
    err.status = 400;
    throw err;
  }
  if (!wallet) {
    const err = new Error('Wallet required');
    err.status = 400;
    throw err;
  }
  if (!hash) {
    const err = new Error('Mint tx hash required');
    err.status = 400;
    throw err;
  }

  const seats = await loadAllSeats();
  if (seats.some((s) => s.hash === hash)) {
    return { ok: true, deduped: true, seat: seats.find((s) => s.hash === hash) };
  }
  if (seats.some((s) => s.ref === ref && Number(s.round) === roundState.activeRound)) {
    const err = new Error('This ref already has a seat in the current round');
    err.status = 409;
    throw err;
  }

  const row = {
    t: Date.now(),
    round: roundState.activeRound,
    ref,
    wallet,
    token: eventsStore.cleanToken(input && input.token) || '',
    symbol: eventsStore.cleanSymbol(input && input.symbol),
    pool: cleanWallet(input && input.pool),
    usd,
    eth: input && input.eth != null && isFinite(Number(input.eth)) ? Number(input.eth) : null,
    hash,
    note: String((input && input.note) || '').slice(0, 160)
  };

  if (usePostgres()) {
    const pool = await getPg();
    try {
      await pool.query(
        `INSERT INTO partner_seats (t, round, ref, wallet, token, symbol, pool, usd, eth, hash, note)
         VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [row.t, row.round, row.ref, row.wallet, row.token, row.symbol, row.pool, row.usd, row.eth, row.hash, row.note]
      );
    } catch (e) {
      if (e && e.code === '23505') return { ok: true, deduped: true, seat: row };
      throw e;
    }
  } else {
    const arr = readFileSeats();
    arr.push(row);
    writeFileSeats(arr);
  }

  return { ok: true, deduped: false, seat: row, round: cfg };
}

module.exports = {
  ROUNDS,
  CAPITAL_WEIGHT,
  WORK_WEIGHT,
  getBoard,
  registerSeat,
  cleanWallet
};
