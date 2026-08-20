# Pool Pilot outreach agents

**X posts run on gsb-swarm Railway** (same `X_API_*` OAuth as Thread Writer).
This folder keeps templates + TG allowlist cadence; it does **not** need local X keys.

## X (Railway)

On gsb-swarm set:

```
POOL_PILOT_X_OUTREACH=1
# already present on Railway:
# X_API_KEY X_API_SECRET X_ACCESS_TOKEN X_ACCESS_TOKEN_SECRET
```

Worker: `workers/poolPilotXOutreachWorker.js`  
Status: `GET /api/pool-pilot/x-status`  
Manual tick: `POST /api/pool-pilot/x-tick` (operator auth)

Cadence: 3/day · ≥4h gap · quiet UTC 03–11.

## Telegram (this repo)

```bash
cp agents/outreach/targets.example.json agents/outreach/targets.json
# allowlisted channel / DM ids only

export TELEGRAM_BOT_TOKEN=...
npm run outreach:tick          # dry-run
npm run outreach:live -- --channel=tg
```

## Optional: trigger Railway X from here

```bash
export GSB_SWARM_URL=https://gsb-swarm-production.up.railway.app
export GSB_OPERATOR_KEY=...    # same operator key gsb-swarm expects
npm run outreach:live -- --channel=x
```
