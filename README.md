# Pool Pilot

**Liquidity copilot for Uniswap v3 pools on Robinhood Chain.**

You paste a token address. Pool Pilot reads the pool live from chain and tells you, in plain English, whether it is healthy — how much is actually for sale, how much buy support exists, and how far a $50 trade moves the price. Then it offers two or three concrete moves and builds the exact transactions for your own wallet to sign.

It holds nothing. There is no Pool Pilot contract. Every write goes directly to Uniswap v3's audited `NonfungiblePositionManager`.

**Live:** [poolpilot.xyz](https://poolpilot.xyz)
**Start your token:** [poolpilot.xyz/start.html](https://poolpilot.xyz/start.html) — reality desk for serious creators (Stage pack, rails, MCFL-only platform fees). Liquidity copilot below stays unchanged.
**Chain:** Robinhood Chain (chain ID `4663`) · [Blockscout explorer](https://robinhoodchain.blockscout.com)

---

## Why this exists

Tokens launched on Robinhood Chain routinely end up with a pool where a $50 buy moves the price 20%+, and routers report "no route" because there is no active liquidity at the current tick. The creator can see something is wrong but has no idea what to do about it — Uniswap's own interface shows ticks and sqrt prices, not "your buy side is $56 deep."

Pool Pilot is the diagnosis plus the fix, in one widget.

---

## Architecture

Zero build step. Three files of application code, one CDN dependency.

```
index.html      markup + strict Content-Security-Policy
css/styles.css  design system, light/dark
js/chainlib.js  chain library — all reads, all transaction construction (universal: Node + browser)
js/app.js       UI layer only — rendering, modals, wallet plumbing
test/           Node test suites that exercise chainlib.js against a mainnet fork
```

`chainlib.js` is deliberately environment-agnostic: the exact same module that runs in the browser is what the fork tests import. **The code an auditor reviews is the code that ships and the code that is tested** — there is no build transform in between.

### Contracts used (Robinhood Chain)

| Role | Address |
| --- | --- |
| Uniswap v3 Factory | [`0x1f7d7550b1b028f7571e69a784071f0205fd2efa`](https://robinhoodchain.blockscout.com/address/0x1f7d7550b1b028f7571e69a784071f0205fd2efa) |
| NonfungiblePositionManager | [`0x73991a25c818bf1f1128deaab1492d45638de0d3`](https://robinhoodchain.blockscout.com/address/0x73991a25c818bf1f1128deaab1492d45638de0d3) |
| SwapRouter02 | [`0xcaf681a66d020601342297493863e78c959e5cb2`](https://robinhoodchain.blockscout.com/address/0xcaf681a66d020601342297493863e78c959e5cb2) |
| QuoterV2 | [`0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`](https://robinhoodchain.blockscout.com/address/0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7) |
| WETH | [`0x0bd7d308f8e1639fab988df18a8011f41eacad73`](https://robinhoodchain.blockscout.com/address/0x0bd7d308f8e1639fab988df18a8011f41eacad73) |
| MCFL (fee token) | [`0x21a91215fbfc4fc002b07cc87698a6fc01aed523`](https://robinhoodchain.blockscout.com/address/0x21a91215fbfc4fc002b07cc87698a6fc01aed523) |

**Pool Pilot deploys no contracts of its own.** That is the central security property: there is nothing to approve, nothing that can hold funds, and nothing that can be upgraded out from under a user.

---

## The moves

| Move | What it builds | Who owns the result |
| --- | --- | --- |
| **Deepen buy side** | WETH-only concentrated position from −10% to −35% of spot | You |
| **Tighten the spread** | Two-sided position in a tight band around spot | You |
| **Collect fees** | `collect()` on each of your positions | You |
| **Super Chain launch** | Fee payment + hand-delivered LayerZero OFT mesh (Solana + Base + Robinhood) | — |

Each paid move costs $25. Fees are payable two ways:

- **In MCFL** — a plain ERC-20 transfer to the treasury.
- **In ETH** — see below. This one is unusual and worth understanding.

### Fees paid in ETH become liquidity, not a swap

The naive design converts the ETH fee to MCFL through the MCFL pool. In a thin pool that is destructive: our own testing measured roughly **+21% price impact** on a $25 buy, meaning the payer overpays and the token's chart takes a visible hit on every single fee.

So the ETH path never swaps. The payment is a single transaction — `NPM.multicall([mint, refundETH])` — that mints a **treasury-owned, WETH-only position 5–30% below spot** in the MCFL pool. Consequences:

- **Price impact is exactly zero.** The position is minted out of range; the pool's tick does not move. Verified on a mainnet fork (`test/fee-lp-sim.js`).
- **The fee is exactly $25.** No impact premium, no slippage buffer.
- Every fee paid **deepens MCFL's buy side** instead of thinning it.
- Unspent ETH is refunded in the same transaction.

This is disclosed in the UI at the moment of payment, not buried here.

---

## Security

Read [`SECURITY.md`](SECURITY.md) for the full model, the specific attacks tested, and the honest list of what is still out of scope.

Summary of the properties an auditor should try to break:

1. **No custody, no contract.** Every state change is a wallet-signed transaction to WETH, the token, or Uniswap's position manager.
2. **Approvals are exact-amount**, scoped to a single move, granted only to the position manager. No `setApprovalForAll`, no unlimited approvals.
3. **No signature requests, ever.** Pool Pilot never calls `eth_sign`, `personal_sign`, or `signTypedData`. If this UI ever asks you to sign a message, something is wrong — reject it.
4. **Hostile token metadata is neutralised twice** — sanitised at the chain-read boundary, escaped again at render.
5. **Strict CSP** — no inline scripts, no `eval`, network egress limited to the chain RPC and two price feeds.
6. **The one CDN dependency is SRI-pinned.** A compromised CDN cannot substitute code; the app fails closed.
7. **In-range mints carry on-chain slippage floors** derived from the previewed price, so a front-runner cannot skew a deposit.
8. **Chain ID is verified before every signature.**

---

## Running it

Nothing to build.

```bash
git clone https://github.com/MCFLAMINGO/pool-pilot
cd pool-pilot
npx serve -l 3000 .
# open http://localhost:3000
```

Reading pool state works with no wallet. Executing moves needs MetaMask or Rabby in a real browser tab (wallet injection is blocked inside preview iframes — the app detects this and says so).

---

## Tests

Read-only tests hit live mainnet and need no setup:

```bash
npm install
npm run test:reads    # live pool reads across several real tokens
npm run test:plans    # transaction construction, no broadcast
```

The transaction tests run against a **fork of Robinhood Chain mainnet** using [Foundry](https://getfoundry.sh)'s anvil. In one terminal:

```bash
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --port 8545 --no-rate-limit
```

Then:

```bash
npm run test:all-fork
```

| Suite | What it proves |
| --- | --- |
| `test/fork-sims.js` | All six flows execute end-to-end as a stranger wallet: ETH fee, buy, deepen buy side, straddle, collect, MCFL fee |
| `test/fee-lp-sim.js` | The ETH fee mints a treasury-owned position, pool tick is **unchanged**, refund works |
| `test/sandwich-sim.js` | **Adversarial.** An attacker moves the price between preview and mint; the victim's transaction **reverts** instead of depositing at a manipulated ratio |

Every suite asserts and exits non-zero on failure. `test/sandwich-sim.js` is the one to read first if you are auditing — it is a real attack, executed, and it is expected to fail loudly if the slippage floors regress.

Note: the fork tests move real pool state on the fork. Restart anvil between full runs for clean numbers.

---

## Auditing this

Open invitation. If you find something, open an issue or email **erik@mcflamingo.com**. See [`SECURITY.md`](SECURITY.md) for scope and a prioritised list of where to look first.

The highest-value targets, honestly:

- `chainlib.js` → `planStraddle` slippage-floor math (is 80% the right floor? is the liquidity math right at range edges?)
- `chainlib.js` → `payFeeWithEthTx` tick-band construction for **both** pool orientations
- `app.js` → every `innerHTML` sink reachable by attacker-controlled data
- The CSP in `index.html` — is anything over-permissive?

---

## Limitations

Stated plainly, because a tool asking for wallet connections should not overclaim:

- **Not audited by a third party.** The security work here is the author's own adversarial testing. It is real, it is documented, and it is not the same thing as an audit.
- Concentrated liquidity carries **impermanent loss**. Positions placed below spot convert to the token if the price falls into them. That is the intended behaviour of a buy wall, and it is a real risk.
- **Super Chain launch** (LayerZero OFT peers on Solana + Base + Robinhood before public trading) is hand-delivered within 72 hours or refunded on-chain. It is not automated and is never presented as such.
- Pool discovery checks the four standard fee tiers and picks the deepest WETH pair. Exotic pool setups may not be found.
- Robinhood Chain's public RPC is non-archive, so history beyond roughly the last 5,000 blocks is unavailable.

---

## License

MIT. See [`LICENSE`](LICENSE).

Built by [McFlamingo](https://github.com/MCFLAMINGO). Not financial advice.
