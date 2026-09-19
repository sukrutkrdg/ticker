# HOLI Treasury Tracker

An **unofficial** community dashboard for the HOLI treasury Safe on Robinhood Chain.
It shows live progress toward the stated $200,000 Phase I threshold, read directly from chain.

> Not affiliated with, endorsed by, or operated by HOLI. No token, no sale, no wallet
> connection, no analytics. Verify every figure against the block explorer.

## Why it exists

HOLI's entire Phase I narrative hangs on one number — the treasury reaching $200,000 — and
there was no page showing where that number actually stands. This is that page.

## What it shows

| Panel | Source |
|---|---|
| Treasury value and progress to target | Balance × spot price |
| SHYT held, price, ETH balance, transfer count | Blockscout + GeckoTerminal |
| **Path to the target** — tokens needed vs. price needed | Derived |
| Cumulative accumulation chart | Blockscout transfer log |
| **Custody check** — Safe version, threshold, owners | `eth_call` to the Safe |
| Treasury flows table | Blockscout transfer log |

Two panels do something an official page generally will not:

- **Custody check** reads `getOwners()`, `getThreshold()` and `VERSION()` straight from the
  contract, so the multisig claim is verified rather than asserted. At time of writing the
  treasury is a **Gnosis SafeL2 v1.4.1 requiring 2 of 3 signatures**.
- **Path to the target** splits the threshold into its two levers — hold more tokens, or have
  the tokens be worth more — and flags when the first is arithmetically impossible. At the
  price observed during development, reaching $200,000 by accumulation alone would require
  ~2.74B SHYT against a total supply of 1B. The target therefore depends on price
  appreciation, not on buybacks alone. The page says so, and recomputes it every refresh.

## Verified addresses

Everything in `config.js` was resolved from chain data, not from marketing material:

| Thing | Address | How it was verified |
|---|---|---|
| Treasury Safe | `0xED1caC8cC4e3591491aA38BfDB78A8439D0BeCdB` | Second-largest SHYT holder; proxy `master_copy` resolves to SafeL2 `0x29fcB43b…C762` |
| SHYT | `0x0105Bf7d7e7d883145806a1e5664470Ee2d1518e` | Blockscout token search; contract name `PonsV2LauncherToken`, 18 decimals |
| Chain | Robinhood Chain, id `4663` | `eth_chainId` → `0x1237` |

## Data sources

- **Blockscout** — `https://robinhoodchain.blockscout.com/api/v2` (CORS `*`)
- **GeckoTerminal** — network id `robinhood`, one call per refresh (free tier: 30/min)
- **RPC** — `https://robinhood.drpc.org` (CORS `*`)

All three allow browser requests, so there is **no server, no build step and no API key**.
The page is four static files.

## Running locally

Any static server works — there is nothing to build:

```bash
npx serve .
# or
python -m http.server 8000
```

## Deploying

Static hosting, no configuration required. Vercel, Cloudflare Pages, GitHub Pages and
Netlify all serve it as-is. `vercel.json` only adds security and cache headers.

## Configuration

Everything tunable lives in `config.js` — addresses, the `target` value, and
`refreshSeconds` (default 300).

## Deliberate non-features

- **No wallet connection.** A third-party page that resembles a protocol's own site and asks
  to connect a wallet is indistinguishable from phishing. This one never asks.
- **No HOLI branding.** No logo, no brand colours, no implication of endorsement.
- **No backend.** Nothing to compromise, nothing collecting anything about you.

## Caveats

- Treasury value moves with SHYT's market price, so it falls as well as rises even when no
  tokens move.
- This measures the Safe's holdings at market price, not capital spent acquiring them.
- A multisig limits unilateral movement of funds; it does not prevent the signers, acting
  together, from moving them. Owner identities are not verifiable from chain data.
- The projection assumes a flat price and a constant accumulation rate. Neither is a
  forecast.

## Licence

MIT.
