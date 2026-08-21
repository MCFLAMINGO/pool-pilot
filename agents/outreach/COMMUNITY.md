# Pool Pilot Mini App — give this to RH token communities

## How you earn
Every swap through the desk skims **0.30%**. When the trader pays with **ETH**, that skim is split: most goes into a treasury-owned **MCFL buy-wall LP** (ETH into the book), and the rest quietly buys **MCFL** into the treasury wallet — same Swap button, no separate steps. Other input assets still transfer to treasury as-is.  
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

1. [@BotFather](https://t.me/BotFather) → **Pool Pilot Swap** → **Bot Settings** → **Configure Mini App**
2. **Enable** Mini App if asked
3. **Edit Mini App URL** (exact):

```
https://poolpilot.xyz/tg-swap
```

4. Optional Menu Button: same URL, text `Swap`
5. Optional Direct Link name `swap` → `https://poolpilot.xyz/tg-swap`

### If Launch shows “Something went wrong”
1. Open in Safari/Chrome: https://poolpilot.xyz/tg-swap — must load the swap UI
2. Temporarily set Mini App URL to diagnostic: `https://poolpilot.xyz/tg-ok` → Launch again  
   - If **OK** page shows → BotFather is fine; switch URL back to `/tg-swap` after deploy  
   - If still duck error → re-save Mini App URL, force-quit Telegram, retry on **phone** (Desktop is flakier)
3. Prefer phone Telegram for first successful Launch
4. Community links still work as web: `https://poolpilot.xyz/swap?usd=25&out=0x…`

Until Main App URL is saved correctly, Launch will always fail.

## Your guys’ workflow

1. Keep share bot running: `npm run outreach:bot`
2. They DM `/share ANSEM` (or any token)
3. Copy **Best (Telegram Mini App)** into that token’s community
4. Members tap → Mini App opens prefilled → connect wallet → swap

## Web fallback
`https://poolpilot.xyz/tg-swap?out=0x…&usd=25`  
or `https://poolpilot.xyz/swap?…`
