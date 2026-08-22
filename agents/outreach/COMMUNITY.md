# Pool Pilot Mini App — give this to RH token communities

## Partner pack (website / X / QR / embed)

Generate everything from:

```
https://poolpilot.xyz/pack?symbol=MCFL&token=0x21a91215fbfc4fc002b07cc87698a6fc01aed523&ref=yourcommunity&usd=25
```

Stats / attributed receipts: https://poolpilot.xyz/partner?ref=yourcommunity  
Seat (path + milestones): https://poolpilot.xyz/seat?ref=yourcommunity  
**Path:** buy $500 seat → drive attributed volume → hit Ignite / Breakout / Pro / Killing it on the Live field.  
**Earn:** your Uniswap buy-wall NFT (fills → you get token). **No** monthly checks, skim rebates, or stage bonuses from treasury.  
(API: `GET /api/seats` · `pathLegend` + per-seat `path.milestones` · `economics.partnerCash: false`)  
Case study template: https://poolpilot.xyz/case?symbol=MCFL&token=0x…  
Press kit: https://poolpilot.xyz/press

## How seats work
Round 1: **$500** ETH into a buy wall **you own** (Uniswap NFT in your wallet).  
Round 2: **$1,000–$5,000** when early seats fill or volume grows.  
Share weight on the field = **60% capital + 40% attributed swap volume** from your links (status, not a cash split).  
Desk 0.30% skim **always** goes to treasury / buy-wall LP — never rebated to seats.

## How the desk earns (not partners)
Every swap through the desk skims **0.30%**. When the trader pays with **ETH**, that skim strengthens the book first: while MCFL buy-side depth is still thin (< ~$10k ETH in pool), **100%** of the ETH skim goes into a treasury-owned **MCFL buy-wall LP**. After the pool is deeper, the mature split resumes (most LP + a quiet MCFL buy to treasury). Other input assets still transfer to treasury as-is.  
Communities get a free Mini App link; seat holders climb the Live field when members trade through their ref.

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
