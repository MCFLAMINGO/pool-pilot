'use strict';

/**
 * Ops-only reach report: natural (house) vs partner volume.
 * Gated by HOUSE_VIEW_KEY (falls back to PARTNER_INGEST_KEY).
 */

const store = require('./store');
const seats = require('./seats');

const { HOUSE_REF, isHouseRef } = store;

function opsKeyConfigured() {
  return Boolean(process.env.HOUSE_VIEW_KEY || process.env.PARTNER_INGEST_KEY);
}

/** Accept X-Ops-Key / ?key= matching HOUSE_VIEW_KEY, else PARTNER_INGEST_KEY. */
function authorizeOps(req) {
  const expected = process.env.HOUSE_VIEW_KEY || process.env.PARTNER_INGEST_KEY || '';
  if (!expected) {
    const err = new Error('House view not configured (set HOUSE_VIEW_KEY)');
    err.status = 503;
    throw err;
  }
  const q = req.query || {};
  const got =
    (req.headers && (req.headers['x-ops-key'] || req.headers['x-partner-key'])) ||
    q.key ||
    '';
  if (String(got) !== expected) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  return true;
}

function sumMap(map) {
  return Object.keys(map || {}).reduce((a, k) => a + (Number(map[k]) || 0), 0);
}

function partnerOnlyMap(volMap) {
  const out = Object.create(null);
  Object.keys(volMap || {}).forEach((k) => {
    if (isHouseRef(k)) return;
    out[k] = volMap[k];
  });
  return out;
}

async function getReachReport() {
  const maps = await seats.volumeMaps();
  const board = await seats.getBoard({});
  const houseAll = (maps.all[HOUSE_REF] || 0) + (maps.all[''] || 0);
  const houseMonth = (maps.month[HOUSE_REF] || 0) + (maps.month[''] || 0);
  const partnerAllMap = partnerOnlyMap(maps.all);
  const partnerMonthMap = partnerOnlyMap(maps.month);
  const partnerAll = sumMap(partnerAllMap);
  const partnerMonth = sumMap(partnerMonthMap);
  const total = houseAll + partnerAll;
  const publicBoard = board.board || [];

  return {
    ok: true,
    houseRef: HOUSE_REF,
    house: {
      ref: HOUSE_REF,
      volumeUsd: houseAll,
      monthUsd: houseMonth,
      note: 'Swaps with no partner ref (cold traffic on /swap, /arrive, Mini App, home).'
    },
    partners: {
      volumeUsd: partnerAll,
      monthUsd: partnerMonth,
      seatsTaken: publicBoard.length,
      byRef: Object.keys(partnerAllMap)
        .map((ref) => ({
          ref,
          volumeUsd: partnerAllMap[ref] || 0,
          monthUsd: partnerMonthMap[ref] || 0
        }))
        .sort((a, b) => b.volumeUsd - a.volumeUsd)
    },
    totalVolumeUsd: total,
    naturalShare: total > 0 ? houseAll / total : 0,
    partnerShare: total > 0 ? partnerAll / total : 0,
    publicSeats: publicBoard.map((s) => ({
      ref: s.ref,
      round: s.round,
      workUsd: s.workUsd,
      monthUsd: s.monthUsd,
      stage: s.path && s.path.stage ? s.path.stage.name : null
    })),
    store: board.store
  };
}

module.exports = {
  HOUSE_REF,
  isHouseRef,
  opsKeyConfigured,
  authorizeOps,
  getReachReport,
  partnerOnlyMap
};
