'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createApp } = require('../server/app');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const LISTINGS = path.join(DATA, 'token-listings.json');
const BAK = LISTINGS + '.bak-test';

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
  if (fs.existsSync(LISTINGS)) fs.renameSync(LISTINGS, BAK);
}
function restore() {
  try {
    if (fs.existsSync(LISTINGS)) fs.unlinkSync(LISTINGS);
    if (fs.existsSync(BAK)) fs.renameSync(BAK, LISTINGS);
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
  backup();
  fs.writeFileSync(LISTINGS, '[]\n');

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
    const empty = await req(port, 'GET', '/api/listings');
    check('get empty', empty.status === 200 && empty.json && empty.json.ok && empty.json.count === 0);
    check('price 500', empty.json && empty.json.priceUsd === 500);

    const bad = await req(port, 'POST', '/api/listings', {
      address: '0x21a91215fbfc4fc002b07cc87698a6fc01aed523',
      symbol: 'MCFL',
      wallet: '0x1aa92670a4e680081c407e060a3e8bc3d1929a13',
      hash: '0x' + 'ab'.repeat(32),
      usd: 100
    });
    check('reject underpay', bad.status === 400);

    const hash = '0x' + 'cd'.repeat(32);
    const ok = await req(port, 'POST', '/api/listings', {
      address: '0x5411f1681830F0Dc163818a96B8D253A78e7A6a4',
      symbol: 'WIENERAI',
      wallet: '0x1aa92670a4e680081c407e060a3e8bc3d1929a13',
      hash,
      usd: 500,
      eth: 0.12
    });
    check('register 201', ok.status === 201 && ok.json && ok.json.ok && !ok.json.deduped);
    check('symbol', ok.json.listing && ok.json.listing.symbol === 'WIENERAI');

    const again = await req(port, 'POST', '/api/listings', {
      address: '0x5411f1681830F0Dc163818a96B8D253A78e7A6a4',
      symbol: 'WIENERAI',
      wallet: '0x1aa92670a4e680081c407e060a3e8bc3d1929a13',
      hash,
      usd: 500
    });
    check('dedupe same hash', again.status === 200 && again.json && again.json.deduped);

    const list = await req(port, 'GET', '/api/listings');
    check('listed once', list.status === 200 && list.json.count === 1);
    check(
      'featured addr',
      list.json.featured[0] &&
        list.json.featured[0].address === '0x5411f1681830f0dc163818a96b8d253a78e7a6a4'
    );

    // Client helpers
    const metaPath = path.join(ROOT, 'js/tokenMeta.js');
    const rhPath = path.join(ROOT, 'js/rhTokens.js');
    const metaSrc = fs.readFileSync(metaPath, 'utf8') + '\n' + fs.readFileSync(rhPath, 'utf8');
    // Load in reverse: RH_TOKENS first
    const vm = require('vm');
    const sandbox = {};
    vm.runInNewContext(fs.readFileSync(rhPath, 'utf8') + '\n' + fs.readFileSync(metaPath, 'utf8'), sandbox);
    check('WIENERAI lookup', sandbox.PoolPilotTokens.byAddress('0x5411f1681830F0Dc163818a96B8D253A78e7A6a4').symbol === 'WIENERAI');
    check('featured has MCFL', sandbox.PoolPilotTokens.featuredTokens().some((t) => t.symbol === 'MCFL'));
    check('community has PEPE', sandbox.PoolPilotTokens.communityTokens().some((t) => t.symbol === 'PEPE'));
    check('confirm html', /Confirmed/.test(sandbox.PoolPilotTokens.confirmHtml(sandbox.PoolPilotTokens.bySymbol('MCFL'))));
    check('chip has img', /chip-img/.test(sandbox.PoolPilotTokens.chipHtml(sandbox.PoolPilotTokens.bySymbol('ANSEM'))));
  } finally {
    await new Promise((r) => server.close(r));
    restore();
  }

  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('listings-api ok');
}

main().catch((e) => {
  console.error(e);
  restore();
  process.exit(1);
});
