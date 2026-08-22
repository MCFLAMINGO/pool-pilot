'use strict';

const express = require('express');
const store = require('./store');
const seats = require('./seats');
const house = require('./house');
const listings = require('./listings');
const shepherd = require('./shepherd');
const bonds = require('./bonds');
const routeChips = require('./routeChips');

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.use((req, res, next) => {
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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Partner-Key, X-Ops-Key');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.get('/api/health', async (_req, res) => {
    try {
      const h = await store.health();
      res.json({ ok: true, service: 'pool-pilot-partner', ...h, ts: Date.now() });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.post('/api/events', async (req, res) => {
    try {
      const key = process.env.PARTNER_INGEST_KEY;
      if (key) {
        const got = req.headers['x-partner-key'];
        if (got !== key) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const result = await store.insertEvent(req.body || {}, { ip: clientIp(req) });
      res.status(result.deduped ? 200 : 201).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.get('/api/stats', async (req, res) => {
    try {
      const ref = store.cleanRef(req.query.ref || '');
      if (ref === store.HOUSE_REF) {
        return res.status(404).json({ ok: false, error: 'Not found' });
      }
      const stats = await store.statsForRef(ref, req.query.limit);
      if (!ref && Array.isArray(stats.rows)) {
        stats.rows = stats.rows.filter((r) => !store.isHouseRef(r.ref));
      }
      res.json({ ok: true, ...stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.get('/api/stats/:ref', async (req, res) => {
    try {
      if (store.isHouseRef(req.params.ref) && store.cleanRef(req.params.ref) === store.HOUSE_REF) {
        return res.status(404).json({ ok: false, error: 'Not found' });
      }
      const stats = await store.statsForRef(req.params.ref, req.query.limit);
      res.json({ ok: true, ...stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.get('/api/ops/reach', async (req, res) => {
    try {
      house.authorizeOps(req);
      const report = await house.getReachReport();
      res.json(report);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  // Single-segment alias — Vercel /api/[...path] only reliably hits one segment here.
  app.get('/api/reach', async (req, res) => {
    try {
      house.authorizeOps(req);
      const report = await house.getReachReport();
      res.json(report);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.get('/api/seats', async (req, res) => {
    try {
      const board = await seats.getBoard({
        ref: req.query.ref,
        wallet: req.query.wallet,
        round: req.query.round
      });
      res.json(board);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.get('/api/seats/round', async (_req, res) => {
    try {
      const board = await seats.getBoard({});
      res.json({
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
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.post('/api/seats', async (req, res) => {
    try {
      const key = process.env.PARTNER_INGEST_KEY;
      if (key) {
        const got = req.headers['x-partner-key'];
        if (got !== key) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const result = await seats.registerSeat(req.body || {});
      res.status(result.deduped ? 200 : 201).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.get('/api/listings', async (_req, res) => {
    try {
      const board = await listings.getListings();
      res.json(board);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.post('/api/listings', async (req, res) => {
    try {
      const key = process.env.PARTNER_INGEST_KEY;
      if (key) {
        const got = req.headers['x-partner-key'];
        if (got !== key) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const result = await listings.registerListing(req.body || {});
      res.status(result.deduped ? 200 : 201).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.get('/api/route-chips', async (req, res) => {
    try {
      res.json(await routeChips.listRouteChips(req.query || {}));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.post('/api/route-chips', async (req, res) => {
    try {
      const key = process.env.PARTNER_INGEST_KEY;
      if (key && req.headers['x-partner-key'] !== key) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const result = await routeChips.upsertRouteChip(req.body || {});
      res.status(201).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.get('/api/shepherds', async (req, res) => {
    try {
      res.json(await shepherd.listShepherds(req.query || {}));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.post('/api/shepherds', async (req, res) => {
    try {
      const key = process.env.PARTNER_INGEST_KEY;
      if (key && req.headers['x-partner-key'] !== key) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const result = await shepherd.armShepherd(req.body || {});
      res.status(result.deduped ? 200 : 201).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.get('/api/bonds', async (req, res) => {
    try {
      res.json(await bonds.listBonds(req.query || {}));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.get('/api/bonds/:id', async (req, res) => {
    try {
      res.json(await bonds.getBond(req.params.id));
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.post('/api/bonds', async (req, res) => {
    try {
      const key = process.env.PARTNER_INGEST_KEY;
      if (key && req.headers['x-partner-key'] !== key) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const result = await bonds.createBond(req.body || {});
      res.status(result.deduped ? 200 : 201).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.post('/api/bonds/:id/pledge', async (req, res) => {
    try {
      const key = process.env.PARTNER_INGEST_KEY;
      if (key && req.headers['x-partner-key'] !== key) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const result = await bonds.pledgeBond(req.params.id, req.body || {});
      res.status(result.deduped ? 200 : 201).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.post('/api/bonds/:id/graduate', async (req, res) => {
    try {
      const key = process.env.PARTNER_INGEST_KEY;
      if (key && req.headers['x-partner-key'] !== key) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const result = await bonds.graduateBond(req.params.id, req.body || {});
      res.json(result);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e && e.message) });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Not found', path: req.path });
  });

  return app;
}

module.exports = { createApp };
