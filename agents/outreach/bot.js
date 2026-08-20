'use strict';

/**
 * Pool Pilot community share bot — answers /start /kit /share /swap /usdg
 * so your guys can grab paste-ready blurbs for RH token Telegram chats.
 *
 *   export TELEGRAM_BOT_TOKEN=...
 *   npm run outreach:bot
 *
 * Long-polls getUpdates. Ctrl+C to stop. Does not custody funds.
 */

const https = require('https');
const kit = require('./shareKit');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_SWAP_BOT;
if (!TOKEN) {
  console.error('Set TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
let offset = 0;
let running = true;

function api(method, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const u = new URL(`${API}/${method}`);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(buf); } catch (e) { return reject(new Error(buf.slice(0, 200))); }
        if (!json.ok) reject(new Error(json.description || buf.slice(0, 200)));
        else resolve(json.result);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function reply(chatId, text) {
  return api('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: false
  }).catch((e) => {
    // Fallback without Markdown if parse fails
    return api('sendMessage', {
      chat_id: chatId,
      text: String(text).replace(/\*/g, '').replace(/`/g, ''),
      disable_web_page_preview: false
    });
  });
}

function handleText(chatId, text) {
  const raw = String(text || '').trim();
  const parts = raw.split(/\s+/);
  const cmd = (parts[0] || '').split('@')[0].toLowerCase();

  if (cmd === '/start' || cmd === '/help') return reply(chatId, kit.startText());
  if (cmd === '/kit') return reply(chatId, kit.generalKit());
  if (cmd === '/swap') return reply(chatId, kit.swapText());
  if (cmd === '/usdg') return reply(chatId, kit.usdgText());
  if (cmd === '/share') {
    const token = parts[1];
    const usd = Number(parts[2]) || 25;
    if (!token) {
      return reply(chatId, 'Usage: `/share MCFL` or `/share 0x… 25`\nOr `/kit` for the general pack.');
    }
    const pack = kit.communityPack(token, usd);
    return reply(chatId, pack.text);
  }

  // Bare symbol → treat as share
  if (/^[A-Za-z][A-Za-z0-9]{1,15}$/.test(raw) || /^0x[0-9a-fA-F]{40}$/.test(raw)) {
    return reply(chatId, kit.communityPack(raw, 25).text);
  }

  return reply(
    chatId,
    'Send `/share MCFL` for community blurbs, `/kit` for the general pack, or `/swap` for the desk.'
  );
}

async function loop() {
  console.log('[share-bot] listening for /share /kit /swap … Ctrl+C to stop');
  while (running) {
    try {
      const updates = await api('getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message']
      });
      for (const u of updates || []) {
        offset = u.update_id + 1;
        const msg = u.message;
        if (!msg || !msg.chat || !msg.text) continue;
        // Groups: only answer commands / mentions to avoid spam
        if (msg.chat.type !== 'private') {
          const t = msg.text;
          if (!t.startsWith('/')) continue;
        }
        await handleText(msg.chat.id, msg.text);
      }
    } catch (e) {
      console.error('[share-bot]', e.message || e);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

process.on('SIGINT', () => { running = false; process.exit(0); });
process.on('SIGTERM', () => { running = false; process.exit(0); });

api('deleteWebhook', { drop_pending_updates: false })
  .then(() => loop())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
