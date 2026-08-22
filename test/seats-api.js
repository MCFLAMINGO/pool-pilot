'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createApp } = require('../server/app');

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
        usd: 1000,
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
    const round = await req(port, 'GET', '/api/seats/round');
    check('round 1 open', round.status === 200 && round.json.activeRound === 1 && round.json.open);
    check('round 1 window', round.json.round.usdMin === 100 && round.json.round.usdMax === 500);

    const bad = await req(port, 'POST', '/api/seats', {
      ref: 'alice',
      wallet: '0x1111111111111111111111111111111111111111',
      usd: 50,
      hash: '0x' + 'aa'.repeat(32)
    });
    check('rejects under min', bad.status === 400);

    const hash = '0x' + 'bb'.repeat(32);
    const ok = await req(port, 'POST', '/api/seats', {
      ref: 'alice',
      wallet: '0x1111111111111111111111111111111111111111',
      usd: 250,
      eth: 0.08,
      hash,
      token: '0x21a91215fbfc4fc002b07cc87698a6fc01aed523',
      symbol: 'MCFL',
      pool: '0x2222222222222222222222222222222222222222'
    });
    check('seat 201', ok.status === 201 && ok.json.ok && !ok.json.deduped);

    const board = await req(port, 'GET', '/api/seats?ref=alice');
    check('board has alice', board.status === 200 && board.json.mine && board.json.mine.ref === 'alice');
    check('capital share 100%', Math.abs(board.json.mine.capitalShare - 1) < 1e-9);
    check('work share from events', Math.abs(board.json.mine.workShare - 1) < 1e-9);
    check('seat weight 100%', Math.abs(board.json.mine.seatShare - 1) < 1e-9);
    check('where eth fields', board.json.mine.hash === hash && board.json.mine.pool.startsWith('0x'));

    const bob = await req(port, 'POST', '/api/seats', {
      ref: 'bob',
      wallet: '0x3333333333333333333333333333333333333333',
      usd: 250,
      hash: '0x' + 'cc'.repeat(32)
    });
    check('second seat', bob.status === 201);

    const board2 = await req(port, 'GET', '/api/seats?ref=alice');
    check('capital split 50%', Math.abs(board2.json.mine.capitalShare - 0.5) < 1e-9);
    // alice has all volume → work 100%; seat = 0.6*0.5 + 0.4*1 = 0.7
    check('seat weight mixes capital+work', Math.abs(board2.json.mine.seatShare - 0.7) < 1e-9);
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
