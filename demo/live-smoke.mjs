#!/usr/bin/env node
/** Live UI smoke: homepage → arrive → swap quote paints. */
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE || 'https://poolpilot.xyz';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const fails = [];

  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByTestId('card-fund-rh').scrollIntoViewIfNeeded();
  const arrive = page.getByTestId('link-arrive-rh');
  if (!(await arrive.count())) throw new Error('missing Arrive CTA on home');
  await arrive.click();
  await page.waitForURL(/arrive/, { timeout: 15000 });

  const relay = page.getByTestId('button-arrive-relay');
  const href = await relay.getAttribute('href');
  if (!href || !/relay\.link\/bridge\/robinhood/.test(href)) {
    throw new Error('Relay button not prefilled: ' + href);
  }

  await page.getByTestId('button-arrive-swap').click();
  await page.waitForURL(/swap/, { timeout: 15000 });
  await page.waitForSelector('#arriveBanner:not(.hidden)', { timeout: 8000 }).catch(() => {
    fails.push('arrive banner not shown for from=relay');
  });

  // Back to Arrive — confirm links into the rest of .xyz
  await page.goto(BASE + '/arrive', { waitUntil: 'domcontentloaded' });
  for (const id of [
    'link-arrive-home',
    'link-arrive-swap-nav',
    'link-arrive-start',
    'link-arrive-more-swap',
    'link-arrive-more-home',
    'link-arrive-more-start'
  ]) {
    if (!(await page.getByTestId(id).count())) fails.push('missing ' + id);
  }
  await page.getByTestId('link-arrive-more-home').click();
  await page.waitForURL(/\/$|index\.html/, { timeout: 10000 }).catch(() => fails.push('home link from Arrive failed'));

  // Prefill amount via USD chip and wait for quote
  await page.goto(BASE + '/swap?from=relay&usd=25&out=0x21a91215fbfc4fc002b07cc87698a6fc01aed523', { waitUntil: 'domcontentloaded' });
  const chip = page.locator('#usdPresets [data-usd="25"]');
  if (await chip.count()) await chip.click();
  await page.waitForFunction(() => {
    const btn = document.getElementById('swapBtn');
    const box = document.getElementById('quoteBox');
    return btn && !btn.disabled && box && !box.classList.contains('hidden');
  }, null, { timeout: 20000 }).catch(() => {
    fails.push('swap quote did not enable');
  });

  const quoteText = await page.locator('#quoteBox').innerText().catch(() => '');
  if (!/Protocol fee/i.test(quoteText)) fails.push('quote missing protocol fee line: ' + quoteText.slice(0, 120));

  await page.goto(BASE + '/swap?usd=25&out=0x21a91215fbfc4fc002b07cc87698a6fc01aed523', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const btn = document.getElementById('swapBtn');
    return btn && !btn.disabled;
  }, null, { timeout: 20000 }).catch(() => fails.push('direct swap deep link quote failed'));

  await browser.close();
  if (fails.length) {
    console.error('SMOKE FAILS:\n' + fails.join('\n'));
    process.exit(1);
  }
  console.log('LIVE UI SMOKE OK', BASE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
