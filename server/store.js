'use strict';

/**
 * Partner attribution store.
 * - file (default): data/partner-events.json — fine for single-node Railway / local
 * - postgres: when DATABASE_URL / LOCAL_INTEL_DB_URL / POSTGRES_URL is set
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'partner-events.json');
const MAX_EVENTS = 5000;

function cleanRef(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
}

function cleanToken(raw) {
  const s = String(raw || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return '';
  return s.toLowerCase();
}

function cleanSymbol(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
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

/* ---------- file store ---------- */
function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) fs.writeFileSync(FILE_PATH, '[]\n', 'utf8');
}

function readFileEvents() {
  ensureFile();
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeFileEvents(arr) {
  ensureFile();
  fs.writeFileSync(FILE_PATH, JSON.stringify(arr.slice(-MAX_EVENTS), null, 0) + '\n', 'utf8');
}

/* ---------- postgres ---------- */
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
    CREATE TABLE IF NOT EXISTS partner_events (
      id BIGSERIAL PRIMARY KEY,
      t TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      kind TEXT NOT NULL DEFAULT 'swap',
      ref TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL DEFAULT '',
      symbol TEXT NOT NULL DEFAULT '',
      usd DOUBLE PRECISION,
      hash TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS partner_events_hash_uidx
      ON partner_events (hash) WHERE hash <> '';
    CREATE INDEX IF NOT EXISTS partner_events_ref_idx ON partner_events (ref);
  `);
  return pgPool;
}

function normalizeEvent(input, meta) {
  const usdRaw = input && input.usd != null ? Number(input.usd) : null;
  return {
    t: Date.now(),
    kind: String((input && input.kind) || 'swap').slice(0, 32),
    ref: cleanRef(input && input.ref),
    token: cleanToken(input && input.token),
    symbol: cleanSymbol(input && input.symbol),
    usd: usdRaw != null && isFinite(usdRaw) && usdRaw >= 0 ? usdRaw : null,
    hash: cleanHash(input && input.hash),
    note: String((input && input.note) || '').slice(0, 160),
    ip: String((meta && meta.ip) || '').slice(0, 64)
  };
}

async function insertEvent(input, meta) {
  const row = normalizeEvent(input, meta);
  if (!row.ref && !row.hash && !row.token) {
    const err = new Error('Need ref, token, or hash');
    err.status = 400;
    throw err;
  }

  if (usePostgres()) {
    const pool = await getPg();
    try {
      const r = await pool.query(
        `INSERT INTO partner_events (t, kind, ref, token, symbol, usd, hash, note, ip)
         VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (hash) WHERE hash <> '' DO NOTHING
         RETURNING id, EXTRACT(EPOCH FROM t)*1000 AS t, kind, ref, token, symbol, usd, hash, note`,
        [row.t, row.kind, row.ref, row.token, row.symbol, row.usd, row.hash, row.note, row.ip]
      );
      if (!r.rows.length) return { ok: true, deduped: true, event: row };
      const e = r.rows[0];
      return {
        ok: true,
        deduped: false,
        event: {
          t: Number(e.t),
          kind: e.kind,
          ref: e.ref,
          token: e.token,
          symbol: e.symbol,
          usd: e.usd != null ? Number(e.usd) : null,
          hash: e.hash,
          note: e.note
        }
      };
    } catch (e) {
      // unique without partial index fallback
      if (e && e.code === '23505') return { ok: true, deduped: true, event: row };
      throw e;
    }
  }

  const arr = readFileEvents();
  if (row.hash && arr.some((e) => e.hash === row.hash)) {
    return { ok: true, deduped: true, event: row };
  }
  arr.push(row);
  writeFileEvents(arr);
  return { ok: true, deduped: false, event: row };
}

async function statsForRef(ref, limit) {
  ref = cleanRef(ref);
  limit = Math.min(Math.max(Number(limit) || 50, 1), 200);

  if (usePostgres()) {
    const pool = await getPg();
    const sum = await pool.query(
      `SELECT
         COUNT(*)::int AS events,
         COUNT(*) FILTER (WHERE kind = 'swap')::int AS swaps,
         COALESCE(SUM(usd) FILTER (WHERE kind = 'swap'), 0)::float AS usd
       FROM partner_events
       WHERE ($1 = '' OR ref = $1)`,
      [ref]
    );
    const rows = await pool.query(
      `SELECT EXTRACT(EPOCH FROM t)*1000 AS t, kind, ref, token, symbol, usd, hash, note
       FROM partner_events
       WHERE ($1 = '' OR ref = $1)
       ORDER BY t DESC
       LIMIT $2`,
      [ref, limit]
    );
    const s = sum.rows[0] || {};
    return {
      ref,
      store: 'postgres',
      events: s.events || 0,
      swaps: s.swaps || 0,
      usd: Number(s.usd) || 0,
      rows: rows.rows.map((e) => ({
        t: Number(e.t),
        kind: e.kind,
        ref: e.ref,
        token: e.token,
        symbol: e.symbol,
        usd: e.usd != null ? Number(e.usd) : null,
        hash: e.hash,
        note: e.note
      }))
    };
  }

  let rows = readFileEvents();
  if (ref) rows = rows.filter((e) => e.ref === ref);
  rows = rows.slice().sort((a, b) => b.t - a.t);
  const swaps = rows.filter((e) => e.kind === 'swap');
  let usd = 0;
  swaps.forEach((e) => {
    if (e.usd != null && isFinite(e.usd)) usd += e.usd;
  });
  return {
    ref,
    store: 'file',
    events: rows.length,
    swaps: swaps.length,
    usd,
    rows: rows.slice(0, limit)
  };
}

async function health() {
  if (usePostgres()) {
    const pool = await getPg();
    await pool.query('SELECT 1');
    return { ok: true, store: 'postgres' };
  }
  ensureFile();
  return { ok: true, store: 'file', path: FILE_PATH };
}

module.exports = {
  cleanRef,
  cleanToken,
  insertEvent,
  statsForRef,
  health,
  usePostgres,
  dbUrl
};
