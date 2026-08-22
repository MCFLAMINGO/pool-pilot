# Pool Pilot Mini App — give this to RH token communities

## Partner pack (website / X / QR / embed)

Generate everything from:

```
https://poolpilot.xyz/pack?symbol=MCFL&token=0x21a91215fbfc4fc002b07cc87698a6fc01aed523&ref=yourcommunity&usd=25
```

Stats / attributed receipts: https://poolpilot.xyz/partner?ref=yourcommunity  
Seat (path + milestones): https://poolpilot.xyz/seat?ref=yourcommunity  
**Path:** buy $500 seat → drive attributed volume → race on [/field](https://poolpilot.xyz/field) → **Earner at Ignite ($25k)** → then 0.30% skim auto to seat wallet.  
Before Earner, attributed skim clears to treasury LP. Buy-wall NFT always yours.  
(API: `economics.mode: auto_wallet_skim_after_earner` · `path.earner` · `path.liveSkimLifetimeUsd`)  
Case study template: https://poolpilot.xyz/case?symbol=MCFL&token=0x…  
Press kit: https://poolpilot.xyz/press

## How seats work
Round 1: **$500** ETH into a buy wall **you own** (Uniswap NFT in your wallet).  
Round 2: **$1,000–$5,000** when early seats fill or volume grows.  
Jockey field: up to 12–15 lanes side by side (`/field`).  
Desk 0.30% on your attributed swaps → **your wallet after Earner**; before that (and with no ref) → treasury / buy-wall LP.

## How the desk earns
Every swap skims **0.30%**. Seat refs that have unlocked Earner receive that skim in-wallet automatically. Otherwise ETH skim strengthens the book (bootstrap → 100% treasury MCFL buy-wall LP; mature → LP + quiet MCFL buy).  
Communities get a free Mini App link; seat holders race volume on `/field`.

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
