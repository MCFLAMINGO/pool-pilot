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

/** Round 1 = 12 seats at $500 (clear ticket). Round 2 opens after fill / raise / volume. */
const ROUNDS = {
  1: {
    id: 1,
    name: 'Round 1 — founding seats',
    usdMin: 500,
    usdMax: 500,
    seatPriceUsd: 500,
    maxSeats: 12,
    advanceRaisedUsd: 6000,
    advanceVolumeUsd: 100000
  },
  2: {
    id: 2,
    name: 'Round 2 — growth seats',
    usdMin: 1000,
    usdMax: 5000,
    seatPriceUsd: 2500,
    maxSeats: 24,
    advanceRaisedUsd: Infinity,
    advanceVolumeUsd: Infinity
  }
};

/**
 * Volume stages → monthly partner pay (professional ladder, carnival-clear).
 * monthlyBonusUsd = stipend while you hold this stage (lifetime attributed volume).
 * Plus 100% of attributed desk skim (0.30%) on month-to-date volume.
 */
const SKIM_BPS = 30;
const STAGES = [
  {
    id: 'seated',
    name: 'Seated',
    volumeUsd: 0,
    monthlyBonusUsd: 0,
    blurb: 'ETH parked in your buy wall. Drive volume with your ref.'
  },
  {
    id: 'ignite',
    name: 'Ignite',
    volumeUsd: 25000,
    monthlyBonusUsd: 200,
    blurb: 'First real traction — bonus unlocks on the monthly check.'
  },
  {
    id: 'breakout',
    name: 'Breakout',
    volumeUsd: 100000,
    monthlyBonusUsd: 700,
    blurb: 'Clear early goal. Monthly check steps up.'
  },
  {
    id: 'pro',
    name: 'Pro',
    volumeUsd: 500000,
    monthlyBonusUsd: 2500,
    blurb: 'Habit volume. This is a real partner month.'
  },
  {
    id: 'killing',
    name: 'Killing it',
    volumeUsd: 2000000,
    monthlyBonusUsd: 8000,
    blurb: 'Top of the ladder — keep the links live.'
  }
];

/** Treasury partner-incentive pool (funds stage bonuses). Not taken from seat ETH. */
const INCENTIVE_POOL = {
  round1BudgetUsd: 20000,
  note:
    'Stage bonuses are paid from Pool Pilot’s partner incentive pool (treasury), separate from your seat ETH — that ETH stays in your Uniswap position.'
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

function monthStartMs(now) {
  const d = new Date(now || Date.now());
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function aggregateVolumeByRefSince(eventRows, sinceMs) {
  const map = Object.create(null);
  (eventRows || []).forEach((e) => {
    if (!e || e.kind !== 'swap') return;
    if (sinceMs && Number(e.t) < sinceMs) return;
    const ref = eventsStore.cleanRef(e.ref);
    if (!ref) return;
    const usd = e.usd != null && isFinite(e.usd) ? Number(e.usd) : 0;
    map[ref] = (map[ref] || 0) + usd;
  });
  return map;
}

async function readAllEvents() {
  if (usePostgres()) {
    try {
      const pool = await getPg();
      await eventsStore.health();
      const r = await pool.query(
        `SELECT EXTRACT(EPOCH FROM t)*1000 AS t, kind, ref, usd FROM partner_events`
      );
      return r.rows.map((e) => ({
        t: Number(e.t),
        kind: e.kind,
        ref: e.ref,
        usd: e.usd != null ? Number(e.usd) : 0
      }));
    } catch {
      return [];
    }
  }
  try {
    const file = path.join(DATA_DIR, 'partner-events.json');
    if (!fs.existsSync(file)) return [];
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function volumeMaps() {
  const events = await readAllEvents();
  return {
    all: aggregateVolumeByRef(events),
    month: aggregateVolumeByRefSince(events, monthStartMs())
  };
}

function stageForVolume(workUsd) {
  let cur = STAGES[0];
  for (let i = 0; i < STAGES.length; i++) {
    if (workUsd >= STAGES[i].volumeUsd) cur = STAGES[i];
  }
  const idx = STAGES.findIndex((s) => s.id === cur.id);
  const next = STAGES[idx + 1] || null;
  const prevVol = cur.volumeUsd;
  const nextVol = next ? next.volumeUsd : cur.volumeUsd;
  const span = Math.max(1, nextVol - prevVol);
  const progressToNext = next ? Math.min(1, Math.max(0, (workUsd - prevVol) / span)) : 1;
  return { stage: cur, next, progressToNext, stageIndex: idx };
}

function pathForSeat(workUsd, monthUsd) {
  const { stage, next, progressToNext, stageIndex } = stageForVolume(workUsd || 0);
  const skimMtd = ((monthUsd || 0) * SKIM_BPS) / 10000;
  const monthlyBonusUsd = stage.monthlyBonusUsd || 0;
  const monthlyEstUsd = monthlyBonusUsd + skimMtd;
  const milestones = STAGES.map((s, i) => ({
    id: s.id,
    name: s.name,
    volumeUsd: s.volumeUsd,
    monthlyBonusUsd: s.monthlyBonusUsd,
    blurb: s.blurb,
    reached: (workUsd || 0) >= s.volumeUsd,
    current: s.id === stage.id,
    next: next && s.id === next.id
  }));
  return {
    stage,
    nextStage: next,
    stageIndex,
    progressToNext,
    workUsd: workUsd || 0,
    monthUsd: monthUsd || 0,
    skimBps: SKIM_BPS,
    skimMtdUsd: skimMtd,
    monthlyBonusUsd,
    monthlyEstUsd,
    milestones
  };
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

function withShares(seats, volMap, monthMap, roundId) {
  const inRound = seats.filter((s) => Number(s.round) === Number(roundId));
  const capitalTotal = inRound.reduce((a, s) => a + (Number(s.usd) || 0), 0) || 0;
  let workTotal = 0;
  inRound.forEach((s) => {
    workTotal += volMap[s.ref] || 0;
  });

  return inRound
    .map((s) => {
      const capitalShare = capitalTotal > 0 ? (Number(s.usd) || 0) / capitalTotal : 0;
      const workUsd = volMap[s.ref] || 0;
      const monthUsd = monthMap[s.ref] || 0;
      const workShare = workTotal > 0 ? workUsd / workTotal : 0;
      const seatShare = CAPITAL_WEIGHT * capitalShare + WORK_WEIGHT * workShare;
      const path = pathForSeat(workUsd, monthUsd);
      return {
        ...s,
        workUsd,
        monthUsd,
        capitalShare,
        workShare,
        seatShare,
        weights: { capital: CAPITAL_WEIGHT, work: WORK_WEIGHT },
        path
      };
    })
    .sort((a, b) => b.workUsd - a.workUsd || b.seatShare - a.seatShare);
}

/** Every seat across rounds — public Live field. Shares stay per-round. */
function withSharesAll(seats, volMap, monthMap) {
  const r1 = withShares(seats, volMap, monthMap, 1);
  const r2 = withShares(seats, volMap, monthMap, 2);
  return r1.concat(r2).sort((a, b) => b.workUsd - a.workUsd || Number(a.round) - Number(b.round));
}

function partnerVolTotal(volMap) {
  let n = 0;
  Object.keys(volMap || {}).forEach((k) => {
    if (eventsStore.isHouseRef(k)) return;
    n += volMap[k] || 0;
  });
  return n;
}

function filterPublicBoard(rows) {
  return (rows || []).filter((s) => s && !eventsStore.isHouseRef(s.ref));
}

async function getBoard(opts) {
  opts = opts || {};
  const seats = await loadAllSeats();
  const maps = await volumeMaps();
  const volMap = maps.all;
  const monthMap = maps.month;
  const roundState = computeRoundState(seats, volMap);
  // Public attributed total = partners only (house is ops-private).
  roundState.totalAttributedVolumeUsd = partnerVolTotal(volMap);
  roundState.advance = {
    ...roundState.advance,
    // Round advance still sees total flow including natural reach.
    volumeUsd: Object.keys(volMap).reduce((a, k) => a + (volMap[k] || 0), 0),
    partnerVolumeUsd: partnerVolTotal(volMap),
    houseVolumeUsd: (volMap[eventsStore.HOUSE_REF] || 0) + (volMap[''] || 0)
  };

  const wantRound = opts.round;
  let board;
  if (wantRound === 'all' || wantRound == null || wantRound === '' || String(wantRound).toLowerCase() === 'all') {
    board = withSharesAll(seats, volMap, monthMap);
  } else {
    board = withShares(seats, volMap, monthMap, Number(wantRound));
  }
  board = filterPublicBoard(board);
  const roundBoard = filterPublicBoard(withShares(seats, volMap, monthMap, roundState.activeRound));
  let mine = null;
  const ref = eventsStore.cleanRef(opts.ref || '');
  const wallet = cleanWallet(opts.wallet || '');
  // Never surface the reserved house ref as a partner "mine" lane.
  if ((ref || wallet) && ref !== eventsStore.HOUSE_REF) {
    mine =
      board.find((s) => (ref && s.ref === ref) || (wallet && s.wallet === wallet)) ||
      filterPublicBoard(withSharesAll(seats, volMap, monthMap)).find(
        (s) => (ref && s.ref === ref) || (wallet && s.wallet === wallet)
      ) ||
      null;
  }
  const byRound = { 1: 0, 2: 0 };
  seats.forEach((s) => {
    if (eventsStore.isHouseRef(s.ref)) return;
    const r = Number(s.round) === 2 ? 2 : 1;
    byRound[r] += 1;
  });
  const publicSeats = seats.filter((s) => !eventsStore.isHouseRef(s.ref));
  return {
    ok: true,
    ...roundState,
    seatsTakenAll: publicSeats.length,
    seatsByRound: byRound,
    stages: STAGES,
    skimBps: SKIM_BPS,
    incentivePool: INCENTIVE_POOL,
    pathLegend: STAGES.map((s) => ({
      id: s.id,
      name: s.name,
      volumeUsd: s.volumeUsd,
      monthlyBonusUsd: s.monthlyBonusUsd,
      blurb: s.blurb,
      estAtVolume:
        s.monthlyBonusUsd + (s.volumeUsd * SKIM_BPS) / 10000
    })),
    board,
    roundBoard,
    mine,
    attribution: {
      how: 'Swaps through Pool Pilot with ?ref= (or sticky pp_ref) POST to /api/events and credit that seat ref. No ref → invisible house (ops-only).',
      autoBindWallet: true,
      skimBps: SKIM_BPS,
      houseRef: eventsStore.HOUSE_REF,
      housePublic: false
    },
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
  if (eventsStore.isHouseRef(ref)) {
    const err = new Error('Reserved ref');
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
  STAGES,
  SKIM_BPS,
  INCENTIVE_POOL,
  CAPITAL_WEIGHT,
  WORK_WEIGHT,
  getBoard,
  registerSeat,
  cleanWallet,
  pathForSeat,
  volumeMaps
};
