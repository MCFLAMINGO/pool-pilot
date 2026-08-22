'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createApp } = require('../server/app');
const { STAGES, pathForSeat } = require('../server/seats');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const SEATS = path.join(DATA, 'partner-seats.json');
const EVENTS = path.join(DATA, 'partner-events.json');
const BAK_S = SEATS + '.bak-test';
const BAK_E = EVENTS + '.bak-test';

function req(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: Object.assign(
          { Accept: 'application/json' },
          data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
        )
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function backup(file, bak) {
  if (fs.existsSync(file)) fs.renameSync(file, bak);
}
function restore(file, bak) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    if (fs.existsSync(bak)) fs.renameSync(bak, file);
  } catch {
    /* ignore */
  }
}

async function main() {
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.LOCAL_INTEL_DB_URL;
  delete process.env.PARTNER_INGEST_KEY;
  delete process.env.HOUSE_VIEW_KEY;

  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  backup(SEATS, BAK_S);
  backup(EVENTS, BAK_E);
  fs.writeFileSync(SEATS, '[]\n');
  fs.writeFileSync(
    EVENTS,
    JSON.stringify([
      {
        t: Date.now(),
        kind: 'swap',
        ref: 'alice',
        usd: 30000,
        hash: '0x' + '11'.repeat(32),
        token: '',
        symbol: 'MCFL',
        note: ''
      }
    ]) + '\n'
  );

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let failed = 0;
  function check(name, cond) {
    if (!cond) {
      console.error('FAIL', name);
      failed += 1;
    } else console.log('ok', name);
  }

  try {
    const p = pathForSeat(30000, 30000);
    check('ignite stage at 30k', p.stage.id === 'ignite');
    check('next is breakout', p.nextStage && p.nextStage.id === 'breakout');
    check('milestones length', p.milestones.length === STAGES.length);

    const round = await req(port, 'GET', '/api/seats/round');
    check('round 1 $500', round.json.round.usdMin === 500 && round.json.round.usdMax === 500);
    check('12 seats', round.json.round.maxSeats === 12);
    check('path legend', Array.isArray(round.json.pathLegend) && round.json.pathLegend.length >= 4);

    const bad = await req(port, 'POST', '/api/seats', {
      ref: 'alice',
      wallet: '0x1111111111111111111111111111111111111111',
      usd: 250,
      hash: '0x' + 'aa'.repeat(32)
    });
    check('rejects non-500', bad.status === 400);

    const hash = '0x' + 'bb'.repeat(32);
    const ok = await req(port, 'POST', '/api/seats', {
      ref: 'alice',
      wallet: '0x1111111111111111111111111111111111111111',
      usd: 500,
      eth: 0.15,
      hash,
      token: '0x21a91215fbfc4fc002b07cc87698a6fc01aed523',
      symbol: 'MCFL',
      pool: '0x2222222222222222222222222222222222222222'
    });
    check('seat 201', ok.status === 201 && ok.json.ok);

    const board = await req(port, 'GET', '/api/seats?ref=alice');
    check('mine has path', board.json.mine && board.json.mine.path);
    check('alice ignite', board.json.mine.path.stage.id === 'ignite');
    check('no partner cash', board.json.mine.path.partnerCash === false);
    check('no monthly est', board.json.mine.path.monthlyEstUsd === 0);
    check('no skim rebate', board.json.mine.path.skimMtdUsd === 0);
    check('economics note', board.json.economics && board.json.economics.partnerCash === false);
    check('milestone reached ignite', board.json.mine.path.milestones.some((m) => m.id === 'ignite' && m.reached));
    check('board lists all seats', Array.isArray(board.json.board) && board.json.board.length === 1);
    check('seatsTakenAll', board.json.seatsTakenAll === 1);
    check('seatsByRound r1', board.json.seatsByRound && board.json.seatsByRound[1] === 1);
    check('attribution meta', board.json.attribution && board.json.attribution.autoBindWallet === true);

    const byWallet = await req(
      port,
      'GET',
      '/api/seats?wallet=0x1111111111111111111111111111111111111111'
    );
    check('wallet finds mine', byWallet.json.mine && byWallet.json.mine.ref === 'alice');

    const hash2 = '0x' + 'cc'.repeat(32);
    const bob = await req(port, 'POST', '/api/seats', {
      ref: 'bob',
      wallet: '0x2222222222222222222222222222222222222222',
      usd: 500,
      eth: 0.15,
      hash: hash2,
      symbol: 'MCFL'
    });
    check('bob seat 201', bob.status === 201 && bob.json.ok);

    const all = await req(port, 'GET', '/api/seats');
    check('field has both seats', all.json.board && all.json.board.length === 2);
    check('seatsTakenAll 2', all.json.seatsTakenAll === 2);
    check(
      'alice ahead on volume',
      all.json.board[0].ref === 'alice' && all.json.board[0].workUsd >= 30000
    );

    const reserved = await req(port, 'POST', '/api/seats', {
      ref: 'poolpilot',
      wallet: '0x3333333333333333333333333333333333333333',
      usd: 500,
      hash: '0x' + 'dd'.repeat(32)
    });
    check('rejects house ref seat', reserved.status === 400);

    const cold = await req(port, 'POST', '/api/events', {
      kind: 'swap',
      ref: '',
      usd: 12000,
      hash: '0x' + 'ee'.repeat(32),
      symbol: 'MCFL'
    });
    check('cold swap accepted', cold.status === 201 && cold.json.ok);
    check('cold → house ref', cold.json.event && cold.json.event.ref === 'poolpilot');

    const leak = await req(port, 'GET', '/api/stats/poolpilot');
    check('house stats hidden', leak.status === 404);

    const pubBoard = await req(port, 'GET', '/api/seats');
    check(
      'house not on live field',
      Array.isArray(pubBoard.json.board) &&
        !pubBoard.json.board.some((s) => s.ref === 'poolpilot')
    );

    const noKey = await req(port, 'GET', '/api/reach');
    check('reach needs key when unset → 503', noKey.status === 503);

    process.env.HOUSE_VIEW_KEY = 'house-secret';
    const badKey = await req(port, 'GET', '/api/reach?key=wrong');
    check('reach bad key 401', badKey.status === 401);
    const reach = await req(port, 'GET', '/api/reach?key=house-secret');
    check('reach ok', reach.status === 200 && reach.json.ok);
    check('reach house vol', reach.json.house && reach.json.house.volumeUsd >= 12000);
    check('reach partner vol', reach.json.partners && reach.json.partners.volumeUsd >= 30000);
    check('natural share set', reach.json.naturalShare > 0 && reach.json.naturalShare < 1);
    const reachAlias = await req(port, 'GET', '/api/ops/reach?key=house-secret');
    check('ops/reach alias', reachAlias.status === 200 && reachAlias.json.ok);
    delete process.env.HOUSE_VIEW_KEY;
  } finally {
    await new Promise((r) => server.close(r));
    restore(SEATS, BAK_S);
    restore(EVENTS, BAK_E);
  }

  if (failed) {
    console.error(failed + ' failure(s)');
    process.exit(1);
  }
  console.log('seats-api: all ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
