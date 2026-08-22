'use strict';

/**
 * Vercel serverless entry (used by api/index.js and api/[...path].js).
 * Mirrors Express routes in server/app.js against the shared store.
 */

const store = require('./store');
const seats = require('./seats');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function cors(req, res) {
  const origin = req.headers.origin || '';
  const allow =
    !origin ||
    origin === 'https://poolpilot.xyz' ||
    origin === 'https://www.poolpilot.xyz' ||
    /^https:\/\/[\w-]+-mcflamingo\.vercel\.app$/.test(origin) ||
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  if (allow && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Partner-Key');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 32 * 1024) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function ipOf(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
}

function pathnameOf(req) {
  const raw = req.url || '/';
  try {
    return new URL(raw, 'http://local').pathname;
  } catch {
    return String(raw).split('?')[0] || '/';
  }
}

async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const pathname = pathnameOf(req);

  try {
    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      const h = await store.health();
      return send(res, 200, { ok: true, service: 'pool-pilot-partner', ...h, ts: Date.now() });
    }

    if (req.method === 'POST' && (pathname === '/api/events' || pathname === '/events')) {
      const key = process.env.PARTNER_INGEST_KEY;
      if (key && req.headers['x-partner-key'] !== key) {
        return send(res, 401, { ok: false, error: 'Unauthorized' });
      }
      const body = await readBody(req);
      const result = await store.insertEvent(body, { ip: ipOf(req) });
      return send(res, result.deduped ? 200 : 201, result);
    }

    if (
      req.method === 'GET' &&
      (pathname === '/api/stats' ||
        pathname.startsWith('/api/stats/') ||
        pathname === '/stats' ||
        pathname.startsWith('/stats/'))
    ) {
      const u = new URL(req.url || '/', 'http://local');
      let ref = u.searchParams.get('ref') || '';
      const m = pathname.match(/\/stats\/([^/]+)$/);
      if (m) ref = decodeURIComponent(m[1]);
      const stats = await store.statsForRef(ref, u.searchParams.get('limit'));
      return send(res, 200, { ok: true, ...stats });
    }

    if (req.method === 'GET' && (pathname === '/api/seats/round' || pathname === '/seats/round')) {
      const board = await seats.getBoard({});
      return send(res, 200, {
        ok: true,
        activeRound: board.activeRound,
        round: board.round,
        rounds: board.rounds,
        raisedUsd: board.raisedUsd,
        seatsTaken: board.seatsTaken,
        seatsLeft: board.seatsLeft,
        open: board.open,
        totalAttributedVolumeUsd: board.totalAttributedVolumeUsd,
        advance: board.advance,
        stages: board.stages,
        pathLegend: board.pathLegend,
        skimBps: board.skimBps,
        incentivePool: board.incentivePool
      });
    }

    if (req.method === 'GET' && (pathname === '/api/seats' || pathname === '/seats')) {
      const u = new URL(req.url || '/', 'http://local');
      const board = await seats.getBoard({
        ref: u.searchParams.get('ref'),
        wallet: u.searchParams.get('wallet'),
        round: u.searchParams.get('round')
      });
      return send(res, 200, board);
    }

    if (req.method === 'POST' && (pathname === '/api/seats' || pathname === '/seats')) {
      const key = process.env.PARTNER_INGEST_KEY;
      if (key && req.headers['x-partner-key'] !== key) {
        return send(res, 401, { ok: false, error: 'Unauthorized' });
      }
      const body = await readBody(req);
      const result = await seats.registerSeat(body);
      return send(res, result.deduped ? 200 : 201, result);
    }

    return send(res, 404, { ok: false, error: 'Not found', path: pathname });
  } catch (e) {
    return send(res, e.status || 500, { ok: false, error: String(e && e.message) });
  }
}

module.exports = handler;
