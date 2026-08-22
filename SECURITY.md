# Security Model

Pool Pilot asks users to connect a wallet and sign transactions. This document states exactly what it can and cannot do, which attacks have been tested, and what remains out of scope.

**Reporting:** open a GitHub issue for anything non-sensitive. For anything exploitable, email **erik@mcflamingo.com** directly. There is no bug bounty program; disclosure is handled in good faith and credited.

**Not third-party audited.** Everything below is the author's own adversarial testing. It is documented and reproducible, and it is not a substitute for an audit. This repo exists partly so that an audit can happen.

---

## 1. Trust boundaries

Pool Pilot is a static front end. It has:

- **No backend.** No server receives user data. There is no API to compromise.
- **No contracts.** Nothing is deployed on-chain by this project. There is no proxy, no admin key, no upgrade path, nothing that can hold funds.
- **No database, no analytics, no telemetry.** No cookies, no `localStorage`, no session storage.

Everything it does reduces to: read chain state over RPC, and hand a transaction object to the user's wallet for approval.

### Contracts the app will ever ask a user to transact with

| Contract | Address | Why |
| --- | --- | --- |
| WETH | `0x0bd7d308f8e1639fab988df18a8011f41eacad73` | `deposit()` to wrap, `approve()` the position manager |
| The user's own token | (varies) | `approve()` the position manager |
| Uniswap v3 `NonfungiblePositionManager` | `0x73991a25c818bf1f1128deaab1492d45638de0d3` | `mint`, `collect`, `multicall` |
| Uniswap v3 `SwapRouter02` | `0xcaf681a66d020601342297493863e78c959e5cb2` | Fee swap UI (`/swap`) + optional MCFL buy path |
| MCFL | `0x21a91215fbfc4fc002b07cc87698a6fc01aed523` | ERC-20 `transfer` for the MCFL fee path |
| Treasury | `0x1aa92670a4e680081c407e060a3e8bc3d1929a13` | Owns MCFL buy-wall LP from ETH skim (100% while bootstrapping) + quiet MCFL buys after depth clears / other fee assets |

Any transaction targeting an address outside this set is a bug. The UI prints the target contract name and address next to every step precisely so a user can verify this against their wallet popup — the wallet's own display is the final, unspoofable check.

### What is never requested

- `eth_sign`, `personal_sign`, `signTypedData` — **no message signatures of any kind.** This is the single most common drain vector (blind-signing a permit or a Seaport order). Pool Pilot has no legitimate reason to ask, so it never does. A signature request from this UI means it has been tampered with.
- `setApprovalForAll` — never.
- Unlimited/`MaxUint256` approvals — never. Every approval is the exact amount for that one move.

---

## 2. Attacks tested

Each of these was executed against the running application or a mainnet fork, not merely reasoned about.

### 2.1 Cross-site scripting via hostile token metadata — **found and fixed**

**Severity: high.** This was a real vulnerability in an earlier revision.

Pool Pilot loads any token address a user pastes, including from a URL hash (`/#0x…`). A token contract can return arbitrary bytes from `symbol()` and `name()` — including HTML. Two render paths interpolated those strings into `innerHTML` without escaping. A malicious creator could deploy a token with a payload symbol and distribute a "check my pool" link that executed script in the victim's browser, with a connected wallet in scope.

**Fix, two independent layers:**

1. **Sanitise at the boundary.** `cleanLabel()` in `chainlib.js` strips every character outside `[A-Za-z0-9 _.$-]` and caps length (12 for symbol, 40 for name) before the value enters application state. Markup cannot survive this.
2. **Escape at render.** All interpolations pass through `esc()`.

**Verification:** RPC responses for the `symbol()` (`0x95d89b41`) and `name()` (`0x06fdde03`) selectors were intercepted and replaced with `<img src=x onerror="…">` while the live app loaded. Results: rendered as inert text, zero `<img>` elements created in the document, callback never fired.

### 2.2 Sandwich / front-running of in-range mints — **found and fixed**

**Severity: medium-high** (silent value loss, not theft).

`planStraddle` built its mint with `amount0Min: 0, amount1Min: 0`. For an in-range Uniswap v3 mint, the pool price at execution determines the actual ratio consumed. In a pool where a $50 trade moves price 20%, an adversary could shove the price between preview and inclusion and cause the deposit to land at a materially different ratio than the user was shown.

**Fix:** minimums are now computed from the pool tick at preview time. The expected consumed amounts are derived from the standard v3 liquidity relations and an 80% floor is applied to each side. If the price moves enough to break that floor, the transaction reverts and the user keeps their funds.

**Verification:** `test/sandwich-sim.js`. A victim prepares a straddle; an attacker executes a large buy in between; the victim's mint is then broadcast. Result: **revert**, victim funds untouched (gas and approvals only).

Out-of-range mints (the buy-side ladder and the ETH fee position) are single-asset by construction and are not exposed to this — their ratio cannot be skewed by price movement. `amount*Min: 0` there is correct, not an oversight.

### 2.3 CDN supply-chain substitution — **mitigated**

`ethers@5.7.2` loads from cdnjs. Previously with no integrity check: a compromise of that CDN, or a MITM against it, would deliver arbitrary JavaScript into a page with wallet access — the highest-impact attack available against a static dapp.

**Fix:** the script tag carries a Subresource Integrity hash and `crossorigin="anonymous"`. Modified bytes fail the check, the script does not execute, and the app fails closed rather than loading a hostile signer.

Residual: cdnjs remains a single point of availability failure. Self-hosting `ethers` in-repo would remove the third party entirely and is a reasonable hardening step for a reviewer to recommend.

### 2.4 Content Security Policy — **added**

`index.html` sets:

```
default-src 'none';
script-src 'self' https://cdnjs.cloudflare.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com;
font-src https://fonts.gstatic.com https://cdn.fontshare.com data:;
img-src 'self' data:;
connect-src 'self' http://127.0.0.1:8787 http://localhost:8787 https://rpc.mainnet.chain.robinhood.com https://api.coinbase.com https://api.geckoterminal.com;
form-action 'none'; base-uri 'none';
```

Defense in depth behind §2.1: no inline scripts, no `eval`, and egress restricted to an allow-list. Even given an escaping bug, injected script cannot execute and has nowhere to exfiltrate to. The last inline event handler was refactored to an attached listener so the policy holds with no `unsafe-inline` for scripts.

`style-src` retains `'unsafe-inline'` for the font providers' stylesheets. Because `script-src` does not allow inline, this is not a script-execution vector.

Note: `frame-ancestors` cannot be delivered via `<meta>` and is intentionally omitted. Framing protection requires an HTTP header — see §4.

### 2.5 ETH/USD price-feed manipulation — **found and fixed**

The $25 fee is denominated in USD and priced from an external feed (Coinbase spot, with a fallback). Two problems: a missing feed silently fell back to a hardcoded `3000`, and an absurd value propagated unchecked into the fee amount.

**Fix:** `saneUsd()` rejects anything non-finite or outside $100–$100,000. `quoteFee()` now throws rather than quoting when the price is unusable, and also rejects a non-finite pool price. A poisoned or dead feed produces a clear error, never a wrong charge.

**Verification:** the feed was stubbed with `0.0001`, `99999999`, `-500`, `NaN`, and `null`. All five blocked the quote; a valid price quoted normally.

### 2.6 Address input validation

Token input is validated against `/^0x[0-9a-fA-F]{40}$/` before any use, both from the input field and the URL hash. Non-matching input is rejected with a message and never reaches an RPC call or the DOM.

### 2.7 Wrong-network signing

`ensureChain()` reads `eth_chainId` and requires `0x1237` (4663) before any signature, prompting `wallet_switchEthereumChain` (and `wallet_addEthereumChain` on 4902) otherwise. Transactions cannot be quietly signed on a different chain.

### 2.8 Transaction target verification (UX-as-security)

Every step in the execution modal renders the target contract's name and address with an explorer link, and instructs the user to match it against the `to` field in their wallet. This deliberately routes the final trust decision through the wallet's own UI, which no web page can forge.

---

## 3. Known accepted risks

Not bugs — properties of the design, disclosed:

1. **Impermanent loss.** Concentrated positions below spot convert to the token as price falls into them. That is what a buy wall does. Disclosed in the UI and the footer.
2. **Fees fund MCFL liquidity.** ETH fees mint treasury-owned positions in the MCFL pool. The treasury owns them and can withdraw them. This is stated at the point of payment; it is a business-model disclosure, not a user-fund risk — user funds are never involved.
3. **Super Chain launch is manual.** LayerZero OFT mesh (Solana + Base + Robinhood) is hand-delivered within 72 hours or refunded on-chain. Never described as automated.
4. **The 80% slippage floor is a judgement call.** Tighter reverts more often on thin pools; looser permits more skew. 80% was chosen for pools where a $50 trade moves price ~20%. Reviewers are invited to argue for a different number.
5. **Public RPC dependency.** A malicious or failing RPC can misreport pool state, causing bad *advice*. It cannot cause a bad *signature* — the wallet independently displays the real transaction, and the chain rejects invalid state.

---

## 4. Out of scope

Cannot be fixed in this codebase; users should understand them:

- **Compromised wallet extension or device.** Nothing a web app can do.
- **DNS hijack or malicious hosting of the domain.** An attacker controlling the origin serves whatever they want. Mitigations are operational: registrar lock, DNSSEC, and — importantly — SRI plus CSP mean the *legitimate* deployment fails closed rather than degrading silently. Users should verify the domain.
- **Hostile token contracts.** A token whose `transfer` logic is malicious (blacklists, fee-on-transfer, reentrancy against the position manager) can behave badly regardless of this UI. Pool Pilot neutralises hostile *metadata* (§2.1); it does not audit token *logic*.
- **HTTP security headers.** `frame-ancestors`, HSTS, and `X-Content-Type-Options` must be set at the hosting layer. Recommended for any production deployment.
- **Uniswap v3 itself.** Assumed correct; it is audited and long-lived.

---

## 5. Where to look first

Prioritised for a reviewer:

| Priority | Location | Question |
| --- | --- | --- |
| 1 | `chainlib.js` → `planStraddle` | Is the liquidity math correct at range edges? Can the floor be gamed or made to revert always? |
| 2 | `chainlib.js` → `payFeeWithEthTx` | Are tick bands correct for **both** token orientations? Can the band ever straddle the current tick (which would make the fee move the price)? |
| 3 | `app.js` | Any `innerHTML` sink reachable by attacker-controlled data that `esc()` misses. |
| 4 | `index.html` | Is the CSP over-permissive anywhere? |
| 5 | `chainlib.js` → `discoverPool` | Can a crafted token/pool cause bad pool selection or a misleading health verdict? |
| 6 | `chainlib.js` → `readState` | Can pool state be crafted so impact numbers mislead a creator into a harmful move? |

Reproduce all of it with `npm run test:all-fork` against an anvil fork. Instructions in the [README](README.md).
