'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createApp } = require('../server/app');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FILE = path.join(DATA, 'shepherds.json');
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

  try {
    const empty = await req(port, 'GET', '/api/shepherds');
    check('get empty', empty.status === 200 && empty.json && empty.json.ok && empty.json.count === 0);
    check('arm price 100', empty.json && empty.json.armPriceUsd === 100);

    const bad = await req(port, 'POST', '/api/shepherds', {
      token: '0x5411f1681830F0Dc163818a96B8D253A78e7A6a4',
      symbol: 'TEST',
      wallet: '0x1aa92670a4e680081c407e060a3e8bc3d1929a13',
      hash: '0x' + '11'.repeat(32),
      usd: 10
    });
    check('reject underpay', bad.status === 400);

    const hash = '0x' + '22'.repeat(32);
    const ok = await req(port, 'POST', '/api/shepherds', {
      token: '0x5411f1681830F0Dc163818a96B8D253A78e7A6a4',
      symbol: 'TEST',
      wallet: '0x1aa92670a4e680081c407e060a3e8bc3d1929a13',
      hash,
      usd: 100,
      fairOpen: true,
      sniperSoak: true,
      floorNurse: false,
      guardUsd: 500,
      hours: 24
    });
    check('arm 201', ok.status === 201 && ok.json && ok.json.ok && !ok.json.deduped);
    check('symbol', ok.json.shepherd && ok.json.shepherd.symbol === 'TEST');
    check('fair open', ok.json.shepherd && ok.json.shepherd.fairOpen === true);
    check('floor nurse off', ok.json.shepherd && ok.json.shepherd.floorNurse === false);

    const again = await req(port, 'POST', '/api/shepherds', {
      token: '0x5411f1681830F0Dc163818a96B8D253A78e7A6a4',
      symbol: 'TEST',
      wallet: '0x1aa92670a4e680081c407e060a3e8bc3d1929a13',
      hash,
      usd: 100
    });
    check('dedupe same hash', again.status === 200 && again.json && again.json.deduped);

    const list = await req(port, 'GET', '/api/shepherds');
    check('listed once', list.status === 200 && list.json.count === 1);
  } finally {
    server.close();
    restore();
  }

  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('shepherd-api ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
