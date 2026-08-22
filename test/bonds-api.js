'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createApp } = require('../server/app');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FILE = path.join(DATA, 'bonds.json');
const BAK = FILE + '.bak-test';

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

function backup() {
  if (fs.existsSync(FILE)) fs.renameSync(FILE, BAK);
}
function restore() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
    if (fs.existsSync(BAK)) fs.renameSync(BAK, FILE);
  } catch {
    /* ignore */
  }
}

async function main() {
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.PARTNER_INGEST_KEY;

  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  backup();
  fs.writeFileSync(FILE, '[]\n');

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

  const creator = '0x1aa92670a4e680081c407e060a3e8bc3d1929a13';
  const pledger = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  try {
    const empty = await req(port, 'GET', '/api/bonds');
    check('get empty', empty.status === 200 && empty.json && empty.json.ok && empty.json.count === 0);
    check('create price 50', empty.json && empty.json.createPriceUsd === 50);
    check('min target 5k', empty.json && empty.json.minTargetUsdg === 5000);

    const tooSmall = await req(port, 'POST', '/api/bonds', {
      name: 'Tiny',
      symbol: 'TINY',
      creator,
      hash: '0x' + '99'.repeat(32),
      targetUsdg: 1000,
      usd: 50
    });
    check('reject thin raise', tooSmall.status === 400);

    const bad = await req(port, 'POST', '/api/bonds', {
      name: 'Harbor',
      symbol: 'HBR',
      creator,
      hash: '0x' + '33'.repeat(32),
      targetUsdg: 10000,
      usd: 10
    });
    check('reject underpay', bad.status === 400);

    const createHash = '0x' + '44'.repeat(32);
    const created = await req(port, 'POST', '/api/bonds', {
      name: 'Harbor',
      symbol: 'HBR',
      creator,
      hash: createHash,
      targetUsdg: 10000,
      usd: 50,
      blurb: 'Community launch'
    });
    check('create 201', created.status === 201 && created.json && created.json.ok && !created.json.deduped);
    check('open status', created.json.bond && created.json.bond.status === 'open');
    const bondId = created.json.bond.id;

    const getOne = await req(port, 'GET', '/api/bonds/' + bondId);
    check('get one', getOne.status === 200 && getOne.json.bond && getOne.json.bond.symbol === 'HBR');

    const pledgeHash = '0x' + '55'.repeat(32);
    const pledged = await req(port, 'POST', '/api/bonds/' + bondId + '/pledge', {
      wallet: pledger,
      hash: pledgeHash,
      usdg: 10000
    });
    check('pledge fills', (pledged.status === 200 || pledged.status === 201) && pledged.json && pledged.json.bond.status === 'filled');
    check('raised', pledged.json.bond.raisedUsdg === 10000);

    const earlyGrad = await req(port, 'POST', '/api/bonds/' + bondId + '/graduate', {
      wallet: pledger
    });
    check('only creator graduates', earlyGrad.status === 403);

    const graduated = await req(port, 'POST', '/api/bonds/' + bondId + '/graduate', {
      wallet: creator,
      note: 'test-grad',
      token: '0x5411f1681830F0Dc163818a96B8D253A78e7A6a4'
    });
    check('graduate', graduated.status === 200 && graduated.json.bond.status === 'graduated');
    check('super chain queued', graduated.json.bond.superChainQueued === true);
    check('next steps', graduated.json.next && graduated.json.next.superChain);
    check('route chip note', graduated.json.next && graduated.json.next.routeChip);
    check('token set', graduated.json.bond.token === '0x5411f1681830f0dc163818a96b8d253a78e7a6a4');

    const chips = await req(port, 'GET', '/api/route-chips?ref=hbr');
    check('route chip for bond ref', chips.status === 200 && chips.json.count >= 1);
  } finally {
    server.close();
    restore();
  }

  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('bonds-api ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
