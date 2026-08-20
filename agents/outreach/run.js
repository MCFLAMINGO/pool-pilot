'use strict';

/**
 * Outreach runner — dry-run by default.
 * node agents/outreach/run.js [--tick] [--live] [--channel=x|tg|all]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const cadence = require('./cadence');
const templates = require('./templates');

const ROOT = __dirname;
const STATE_PATH = path.join(ROOT, '.state.json');
const TARGETS_PATH = path.join(ROOT, 'targets.json');
const EXAMPLE_PATH = path.join(ROOT, 'targets.example.json');

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const TICK = args.includes('--tick') || args.includes('--run');
const channelArg = (args.find((a) => a.startsWith('--channel=')) || '--channel=all').split('=')[1];

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return fallback; }
}

function saveJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

function inQuietHours(now) {
  const h = now.getUTCHours();
  const { startHour, endHour } = cadence.quietUtc;
  if (startHour === endHour) return false;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

function canSend(state, bucket, caps, now) {
  const day = dayKey(now);
  if (!state.days) state.days = {};
  if (!state.days[day]) state.days[day] = {};
  const count = state.days[day][bucket] || 0;
  if (count >= caps.perDay) return { ok: false, reason: `daily cap ${caps.perDay} hit for ${bucket}` };
  const last = state.last && state.last[bucket];
  if (last && (now.getTime() - last) < caps.minGapMs) {
    const wait = Math.ceil((caps.minGapMs - (now.getTime() - last)) / 60000);
    return { ok: false, reason: `gap: wait ~${wait}m for ${bucket}` };
  }
  if (inQuietHours(now)) return { ok: false, reason: 'quiet hours UTC' };
  return { ok: true };
}

function markSent(state, bucket, now) {
  const day = dayKey(now);
  if (!state.days) state.days = {};
  if (!state.days[day]) state.days[day] = {};
  state.days[day][bucket] = (state.days[day][bucket] || 0) + 1;
  if (!state.last) state.last = {};
  state.last[bucket] = now.getTime();
}

function httpJson(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: Object.assign({
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }, headers || {})
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { json = { raw: buf }; }
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 300)}`);
          err.status = res.statusCode;
          err.body = json;
          reject(err);
        } else resolve(json);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function tgSend(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_SWAP_BOT;
  if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN');
  return httpJson('POST', `https://api.telegram.org/bot${token}/sendMessage`, {}, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: false
  });
}

/** OAuth1 signing for X API v2 tweet create */
function oauthHeader(method, url, consumerKey, consumerSecret, token, tokenSecret) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: token,
    oauth_version: '1.0'
  };
  const params = Object.keys(oauth).sort().map((k) => `${enc(k)}=${enc(oauth[k])}`).join('&');
  const base = [method.toUpperCase(), enc(url), enc(params)].join('&');
  const key = `${enc(consumerSecret)}&${enc(tokenSecret)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(', ');
}
function enc(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

async function xPost(text) {
  const ck = process.env.X_API_KEY;
  const cs = process.env.X_API_SECRET;
  const at = process.env.X_ACCESS_TOKEN;
  const as = process.env.X_ACCESS_SECRET;
  if (!ck || !cs || !at || !as) {
    throw new Error('Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET for live X posts');
  }
  const url = 'https://api.twitter.com/2/tweets';
  const auth = oauthHeader('POST', url, ck, cs, at, as);
  return httpJson('POST', url, { Authorization: auth }, { text });
}

function loadTargets() {
  if (!fs.existsSync(TARGETS_PATH)) {
    console.error('[outreach] Missing agents/outreach/targets.json — copy from targets.example.json');
    return loadJson(EXAMPLE_PATH, { x: { enabled: false }, telegram: { enabled: false, channels: [], dms: [] } });
  }
  return loadJson(TARGETS_PATH, {});
}

async function maybePost(job, state, now) {
  const gate = canSend(state, job.bucket, job.caps, now);
  if (!gate.ok) {
    console.log(`[skip] ${job.channel}/${job.label}: ${gate.reason}`);
    return false;
  }
  console.log(`[${LIVE ? 'LIVE' : 'DRY'}] ${job.channel} → ${job.label}`);
  console.log(job.text);
  console.log('---');
  if (!LIVE) return false;
  if (job.channel === 'x') await xPost(job.text);
  else await tgSend(job.targetId, job.text);
  markSent(state, job.bucket, now);
  return true;
}

async function buildJobs(targets, now) {
  const jobs = [];
  const salt = dayKey(now);

  if ((channelArg === 'all' || channelArg === 'x') && targets.x && targets.x.enabled !== false) {
    jobs.push({
      channel: 'x',
      label: 'home-timeline',
      bucket: 'x',
      caps: cadence.x,
      text: templates.pick(templates.X_POSTS, salt + ':x')
    });
  }

  if (channelArg === 'all' || channelArg === 'tg') {
    const channels = (targets.telegram && targets.telegram.channels) || [];
    channels.forEach((ch, i) => {
      if (!ch.id || String(ch.id).indexOf('YOUR_') === 0) return;
      jobs.push({
        channel: 'tg',
        label: ch.label || ch.id,
        targetId: ch.id,
        bucket: 'tgBroadcast',
        caps: cadence.tgBroadcast,
        text: templates.pick(templates.TG_BROADCAST, salt + ':tg:' + i)
      });
    });
    const dms = (targets.telegram && targets.telegram.dms) || [];
    dms.forEach((dm, i) => {
      if (!dm.id || String(dm.id).indexOf('123456789') === 0) return;
      jobs.push({
        channel: 'tg',
        label: 'dm:' + (dm.label || dm.id),
        targetId: dm.id,
        bucket: 'tgDm',
        caps: cadence.tgDm,
        text: templates.pick(templates.TG_OUTREACH, salt + ':dm:' + i)
      });
    });
  }

  return jobs;
}

async function main() {
  const now = new Date();
  const targets = loadTargets();
  const state = loadJson(STATE_PATH, { days: {}, last: {} });

  console.log(`Pool Pilot outreach · ${LIVE ? 'LIVE' : 'DRY-RUN'} · ${now.toISOString()}`);
  console.log(`Cadence: X ${cadence.x.perDay}/day, TG ${cadence.tgBroadcast.perDay}/day, DM ${cadence.tgDm.perDay}/day`);

  if (!TICK) {
    const jobs = await buildJobs(targets, now);
    console.log(`\nQueued candidates (${jobs.length}):`);
    jobs.forEach((j) => {
      const g = canSend(JSON.parse(JSON.stringify(state)), j.bucket, j.caps, now);
      console.log(`- ${j.channel} ${j.label}: ${g.ok ? 'eligible now' : g.reason}`);
    });
    console.log('\nRun with --tick to emit copy, add --live to post.');
    return;
  }

  const jobs = await buildJobs(targets, now);
  // One send per bucket per tick — keeps cadence human
  const seen = {};
  for (const job of jobs) {
    if (seen[job.bucket]) continue;
    const sent = await maybePost(job, state, now);
    if (sent) seen[job.bucket] = true;
  }

  if (LIVE) saveJson(STATE_PATH, state);
  else console.log('(dry-run: state not written)');
}

main().catch((e) => {
  console.error('[outreach]', e.message || e);
  process.exit(1);
});
