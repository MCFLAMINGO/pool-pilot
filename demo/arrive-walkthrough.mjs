#!/usr/bin/env node
/**
 * Playwright walkthrough → recorded video of Arrive (Relay → Pool Pilot).
 *
 *   npm run demo:arrive
 *
 * Writes demo/out/arrive-demo.webm (+ .mp4 if ffmpeg is available).
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, readdirSync, renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'demo', 'out');
const PORT = Number(process.env.DEMO_PORT || 4173);
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const REWRITES = {
  '/arrive': '/arrive.html',
  '/swap': '/swap.html',
  '/start': '/start.html',
  '/tg-swap': '/tg-swap.html',
  '/tg': '/tg-swap.html',
  '/tg-ok': '/tg-ok.html'
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startStaticServer() {
  const server = createServer((req, res) => {
    try {
      let path = decodeURIComponent((req.url || '/').split('?')[0]);
      if (path === '/') path = '/index.html';
      if (REWRITES[path]) path = REWRITES[path];
      const file = join(ROOT, path.replace(/^\//, ''));
      if (!file.startsWith(ROOT) || !existsSync(file)) {
        res.writeHead(404); res.end('not found'); return;
      }
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) {
      res.writeHead(500); res.end(String(e && e.message));
    }
  });
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function injectChrome(page) {
  await page.addStyleTag({
    content: `
      #pp-demo-caption {
        position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
        z-index: 2147483646; max-width: min(720px, 88vw);
        padding: 12px 18px; border-radius: 14px;
        background: rgba(18, 14, 18, 0.88); color: #fff;
        font: 600 17px/1.35 Satoshi, system-ui, sans-serif;
        letter-spacing: -0.01em; text-align: center;
        box-shadow: 0 12px 40px rgba(0,0,0,.28);
        pointer-events: none; opacity: 0; transition: opacity .35s ease;
      }
      #pp-demo-caption.on { opacity: 1; }
      #pp-demo-cursor {
        position: fixed; width: 22px; height: 22px; margin: -4px 0 0 -4px;
        border-radius: 50%; border: 2.5px solid #e0447c;
        background: rgba(224, 68, 124, 0.25);
        box-shadow: 0 0 0 6px rgba(224, 68, 124, 0.12);
        z-index: 2147483647; pointer-events: none;
        transition: left .45s cubic-bezier(.2,.8,.2,1), top .45s cubic-bezier(.2,.8,.2,1),
          transform .15s ease, opacity .2s ease;
        opacity: 0;
      }
      #pp-demo-cursor.on { opacity: 1; }
      #pp-demo-cursor.click { transform: scale(.72); }
      .pp-demo-pulse {
        outline: 3px solid rgba(224, 68, 124, 0.85) !important;
        outline-offset: 4px !important;
        transition: outline-color .3s ease;
      }
    `
  });
  await page.evaluate(() => {
    if (!document.getElementById('pp-demo-caption')) {
      const c = document.createElement('div');
      c.id = 'pp-demo-caption';
      document.body.appendChild(c);
    }
    if (!document.getElementById('pp-demo-cursor')) {
      const cur = document.createElement('div');
      cur.id = 'pp-demo-cursor';
      document.body.appendChild(cur);
    }
  });
}

async function say(page, text, holdMs = 1800) {
  await page.evaluate((t) => {
    const el = document.getElementById('pp-demo-caption');
    if (!el) return;
    el.textContent = t;
    el.classList.add('on');
  }, text);
  await sleep(holdMs);
}

async function moveCursor(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(({ x, y }) => {
    const cur = document.getElementById('pp-demo-cursor');
    if (!cur) return;
    cur.classList.add('on');
    cur.style.left = x + 'px';
    cur.style.top = y + 'px';
  }, { x, y });
  await sleep(480);
}

async function clickAnimated(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await moveCursor(page, locator);
  await locator.evaluate((el) => el.classList.add('pp-demo-pulse'));
  await sleep(350);
  await page.evaluate(() => {
    const cur = document.getElementById('pp-demo-cursor');
    if (cur) cur.classList.add('click');
  });
  await sleep(120);
  await locator.click({ force: true });
  await page.evaluate(() => {
    const cur = document.getElementById('pp-demo-cursor');
    if (cur) cur.classList.remove('click');
  });
  await sleep(200);
}

function ffmpegMp4(webmPath, mp4Path) {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-y', '-i', webmPath,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-an',
      mp4Path
    ], { stdio: 'ignore' });
    ff.on('close', (code) => resolve(code === 0));
    ff.on('error', () => resolve(false));
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) {
    try { unlinkSync(join(OUT, f)); } catch { /* ignore */ }
  }

  const server = await startStaticServer();
  const browser = await chromium.launch({
    channel: process.env.DEMO_CHANNEL || 'chrome',
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await injectChrome(page);
    await say(page, 'Pool Pilot — non-custodial LP + swap on Robinhood Chain', 2200);

    const fund = page.getByTestId('card-fund-rh');
    await fund.scrollIntoViewIfNeeded();
    await sleep(600);
    await say(page, 'Bring value to Robinhood — bridge first, then swap', 2000);

    const arriveLink = page.getByTestId('link-arrive-rh');
    await clickAnimated(page, arriveLink);
    await page.waitForURL(/arrive/);
    await injectChrome(page);
    await say(page, 'Arrive: one funnel. Relay bridges. Pool Pilot swaps.', 2200);

    await page.getByTestId('arrive-step-relay').scrollIntoViewIfNeeded();
    await say(page, 'Step 1 — Open Relay prefilled to Robinhood (4663)', 2000);
    const relayBtn = page.getByTestId('button-arrive-relay');
    await moveCursor(page, relayBtn);
    await relayBtn.evaluate((el) => el.classList.add('pp-demo-pulse'));
    await sleep(1400);
    // Don't leave the funnel for a live Relay tab — show intent, then continue.
    await relayBtn.evaluate((el) => el.classList.remove('pp-demo-pulse'));

    await page.getByTestId('arrive-step-swap').scrollIntoViewIfNeeded();
    await say(page, 'Step 2 — After the bridge confirms, come back here', 2000);
    const backBtn = page.getByTestId('button-arrive-swap');
    await clickAnimated(page, backBtn);
    await page.waitForURL(/swap/);
    await injectChrome(page);

    await say(page, 'Back from Relay — desk is prefilled for you', 2000);
    const banner = page.getByTestId('banner-from-relay');
    await banner.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await moveCursor(page, banner);
    await sleep(900);

    const chip100 = page.locator('#usdPresets [data-usd="100"]');
    if (await chip100.count()) {
      await say(page, 'Pick a dollar size — ETH · USDG · Token desk', 1600);
      await clickAnimated(page, chip100);
      await page.waitForFunction(() => {
        const el = document.getElementById('amountIn');
        return el && String(el.value) === '100';
      }, null, { timeout: 3000 }).catch(() => {});
      await sleep(1400);
    }

    const chips = page.locator('#tokenChips .chip').first();
    if (await chips.count()) {
      await say(page, 'Tap a Robinhood token chip (or paste any 0x)', 1800);
      await clickAnimated(page, chips);
      await sleep(1000);
    }

    await say(page, 'You sign every tx. Pool Pilot never holds funds.', 2400);
    await page.evaluate(() => {
      const cur = document.getElementById('pp-demo-cursor');
      if (cur) cur.classList.remove('on');
    });
    await sleep(1600);
    await say(page, 'poolpilot.xyz/arrive  ·  Tell your AI: llms.txt', 2800);
    await sleep(800);
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  const webms = readdirSync(OUT).filter((f) => f.endsWith('.webm'));
  if (!webms.length) throw new Error('No Playwright video written');
  const src = join(OUT, webms[0]);
  const webmDest = join(OUT, 'arrive-demo.webm');
  if (src !== webmDest) renameSync(src, webmDest);

  const mp4Dest = join(OUT, 'arrive-demo.mp4');
  const ok = await ffmpegMp4(webmDest, mp4Dest);
  console.log('Video:', webmDest);
  if (ok) {
    console.log('MP4:', mp4Dest);
    const assets = join(ROOT, 'assets');
    mkdirSync(assets, { recursive: true });
    copyFileSync(mp4Dest, join(assets, 'arrive-demo.mp4'));
    console.log('Copied → assets/arrive-demo.mp4');
  } else {
    console.warn('ffmpeg convert skipped/failed — webm only');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
