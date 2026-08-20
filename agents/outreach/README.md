# Pool Pilot outreach agents

Rate-limited posters for **your own** X account and **allowlisted** Telegram chats.
Default mode is **dry-run** — nothing leaves the machine until you pass `--live`.

## Safety cadence (hard caps)

| Channel | Cap | Spacing |
|---|---|---|
| X posts | 3 / day | ≥ 4 hours apart |
| TG channel / group posts | 5 / day | ≥ 90 minutes apart |
| TG DMs (allowlist only) | 8 / day | ≥ 20 minutes apart |

Cold spam, scraped member lists, and reply-guy floods are out of scope. Targets are a curated JSON allowlist you edit.

## Setup

```bash
# from repo root
cp agents/outreach/targets.example.json agents/outreach/targets.json
# edit targets.json — add YOUR channel ids / handles only

export TELEGRAM_BOT_TOKEN=...          # bot that can post to allowlisted chats
export X_BEARER_TOKEN=...              # optional; or use OAuth1 below for posting
export X_API_KEY=...
export X_API_SECRET=...
export X_ACCESS_TOKEN=...
export X_ACCESS_SECRET=...
```

## Commands

```bash
# preview today's queue (no network posts)
node agents/outreach/run.js

# build + show what would post now
node agents/outreach/run.js --tick

# actually post (still respects cadence + allowlist)
node agents/outreach/run.js --tick --live

# only X or only TG
node agents/outreach/run.js --tick --live --channel=x
node agents/outreach/run.js --tick --live --channel=tg
```

State (last post times, daily counts) lives in `agents/outreach/.state.json` (gitignored).

## Templates

Edit `agents/outreach/templates.js` — swap deep links, fund card, Super Chain. Keep posts useful; rotate copy so cadence stays human.
