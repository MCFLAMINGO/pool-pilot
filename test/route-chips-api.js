'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createApp } = require('../server/app');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FILE = path.join(DATA, 'route-chips.json');
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
    const empty = await req(port, 'GET', '/api/route-chips');
    check('no dump without ref', empty.status === 200 && empty.json && empty.json.count === 0);

    const house = await req(port, 'GET', '/api/route-chips?ref=poolpilot');
    check('house empty', house.status === 200 && house.json.count === 0);

    const bad = await req(port, 'POST', '/api/route-chips', {
      ref: 'poolpilot',
      address: '0x5411f1681830F0Dc163818a96B8D253A78e7A6a4',
      symbol: 'X'
    });
    check('reject house ref', bad.status === 400);

    const ok = await req(port, 'POST', '/api/route-chips', {
      ref: 'harbor',
      address: '0x5411f1681830F0Dc163818a96B8D253A78e7A6a4',
      symbol: 'HBR',
      source: 'bond'
    });
    check('upsert 201', ok.status === 201 && ok.json && ok.json.ok && ok.json.chip.symbol === 'HBR');
    check('route only', ok.json.chip.routeOnly === true);

    const listed = await req(port, 'GET', '/api/route-chips?ref=harbor');
    check('listed for ref', listed.status === 200 && listed.json.count === 1);
    check('address', listed.json.chips[0].address === '0x5411f1681830f0dc163818a96b8d253a78e7a6a4');

    const other = await req(port, 'GET', '/api/route-chips?ref=someoneelse');
    check('other ref empty', other.status === 200 && other.json.count === 0);
  } finally {
    server.close();
    restore();
  }

  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('route-chips-api ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
