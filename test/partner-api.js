'use strict';

/**
 * Partner attribution API smoke test (file store).
 * Uses a temp data dir via cwd isolation — store writes under ../data from server/.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createApp } = require('../server/app');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FILE = path.join(DATA, 'partner-events.json');
const BAK = path.join(DATA, 'partner-events.json.bak-test');

function req(port, method, urlPath, body, headers) {
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
          data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
          headers || {}
        )
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, json, raw });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.LOCAL_INTEL_DB_URL;
  delete process.env.PARTNER_INGEST_KEY;

  if (fs.existsSync(FILE)) fs.renameSync(FILE, BAK);
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
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
    } else {
      console.log('ok', name);
    }
  }

  try {
    const health = await req(port, 'GET', '/api/health');
    check('health ok', health.status === 200 && health.json && health.json.ok && health.json.store === 'file');

    const bad = await req(port, 'POST', '/api/events', { kind: 'swap' });
    check('events need ref/token/hash', bad.status === 400);

    const hash =
      '0x' +
      'ab'.repeat(32);
    const ins = await req(port, 'POST', '/api/events', {
      kind: 'swap',
      ref: 'testers',
      symbol: 'MCFL',
      token: '0x21a91215fbfc4fc002b07cc87698a6fc01aed523',
      usd: 25,
      hash
    });
    check('insert 201', ins.status === 201 && ins.json && ins.json.ok && !ins.json.deduped);

    const dup = await req(port, 'POST', '/api/events', {
      kind: 'swap',
      ref: 'testers',
      hash,
      usd: 25
    });
    check('dedupe by hash', dup.status === 200 && dup.json && dup.json.deduped);

    const stats = await req(port, 'GET', '/api/stats/testers');
    check(
      'stats for ref',
      stats.status === 200 &&
        stats.json &&
        stats.json.ok &&
        stats.json.swaps === 1 &&
        stats.json.usd === 25
    );

    const q = await req(port, 'GET', '/api/stats?ref=testers');
    check('stats query', q.status === 200 && q.json && q.json.swaps === 1);

    process.env.PARTNER_INGEST_KEY = 'secret-test';
    // recreate app with key — need new server
  } finally {
    await new Promise((r) => server.close(r));
    try {
      if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
      if (fs.existsSync(BAK)) fs.renameSync(BAK, FILE);
    } catch (e) {
      console.warn('cleanup', e.message);
    }
  }

  // auth gate on a fresh server
  process.env.PARTNER_INGEST_KEY = 'secret-test';
  delete process.env.DATABASE_URL;
  const app2 = createApp();
  const server2 = http.createServer(app2);
  await new Promise((r) => server2.listen(0, '127.0.0.1', r));
  const port2 = server2.address().port;
  try {
    fs.writeFileSync(FILE, '[]\n');
    const unauth = await req(port2, 'POST', '/api/events', { ref: 'x', kind: 'click' });
    check('ingest key rejects', unauth.status === 401);
    const auth = await req(
      port2,
      'POST',
      '/api/events',
      { ref: 'x', kind: 'click', note: 'pin' },
      { 'X-Partner-Key': 'secret-test' }
    );
    check('ingest key accepts', auth.status === 201 && auth.json && auth.json.ok);
  } finally {
    delete process.env.PARTNER_INGEST_KEY;
    await new Promise((r) => server2.close(r));
    try {
      if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
      if (fs.existsSync(BAK)) fs.renameSync(BAK, FILE);
    } catch (e) {
      /* ignore */
    }
  }

  if (failed) {
    console.error(failed + ' failure(s)');
    process.exit(1);
  }
  console.log('partner-api: all ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
