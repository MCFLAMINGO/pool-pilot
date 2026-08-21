# Pool Pilot outreach agents

**X posts run on gsb-swarm Railway** (same `X_API_*` OAuth as Thread Writer).

## Product map

| Piece | Job |
|---|---|
| **Mini App** `poolpilot.xyz/tg-swap` | In-Telegram swap desk for RH communities — **this is what you give them** |
| **Bot** `@poolpilotswapbot` | `/share TOKEN` → Mini App link + paste blurbs |
| **Channel** `@poolpilot` | Announce feed |
| **Outreach tick** | Scheduled channel/DM posts |

Earn path: **0.30% protocol fee** on every Mini App / web swap → treasury.

See [COMMUNITY.md](./COMMUNITY.md) for BotFather Mini App setup + paste examples.

## Mini App + share bot

```bash
export TELEGRAM_BOT_TOKEN=...
npm run outreach:bot          # answers /share /kit /start
```

```bash
npm run outreach:share -- MCFL
npm run outreach:share -- kit
```

## X (Railway)

```
POOL_PILOT_X_OUTREACH=1
```

## Telegram broadcast ticks

```bash
cp agents/outreach/targets.example.json agents/outreach/targets.json
export TELEGRAM_BOT_TOKEN=...
npm run outreach:tick
npm run outreach:live -- --channel=tg
```
