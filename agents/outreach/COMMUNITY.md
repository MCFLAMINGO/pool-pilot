# Pool Pilot Mini App — give this to RH token communities

## How you earn
Every swap through the desk skims **0.30%** to the treasury (`TREASURY` on-chain).  
Communities get a free Mini App link; you earn when they trade.

## What to send them (example: MCFL)

```
MCFL swap inside Telegram (Pool Pilot Mini App):
https://t.me/poolpilotswapbot?startapp=MCFL_25
ETH · USDG · Token on Robinhood Chain. You sign — nothing custodied.
```

USDG cash leg:

```
https://t.me/poolpilotswapbot?startapp=USDG_MCFL_25
```

## BotFather setup (one time — you)

1. [@BotFather](https://t.me/BotFather) → **Pool Pilot Swap** → **Bot Settings** → **Configure Mini App** / **Main App**
2. **Main App URL:** `https://poolpilot.xyz/tg-swap`
3. **Menu Button** (optional): same URL, text `Swap`
4. **Direct Link** (optional): name `swap` → URL `https://poolpilot.xyz/tg-swap`  
   Then links look like: `https://t.me/poolpilotswapbot/swap?startapp=MCFL_25`

Until Main App is set, `?startapp=` may only open the bot chat — set the Mini App URL first.

## Your guys’ workflow

1. Keep share bot running: `npm run outreach:bot`
2. They DM `/share ANSEM` (or any token)
3. Copy **Best (Telegram Mini App)** into that token’s community
4. Members tap → Mini App opens prefilled → connect wallet → swap

## Web fallback
`https://poolpilot.xyz/tg-swap?out=0x…&usd=25`  
or `https://poolpilot.xyz/swap?…`
