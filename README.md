# Broker Cat Analytics

Unofficial community analytics for **$BROKER / $EDEL** on Uniswap v4 (Base): trades, per-wallet PnL, hook taxes, liquidity and a risk review.
Built only from public on-chain data. Not affiliated with the project, not financial advice.

- Token: `0xcE24b51766135Fb97D330BdcfabcC03d6Ad28222` (BROKER) · quote: `0xFb31f85A8367210B2e4Ed2360D2dA9Dc2D2Ccc95` (EDEL)
- Uniswap v4 PoolManager: `0x498581ff718922c3f8e6a244956af099b2652b2b`
- Fee hook: `0x7C672F3850afadCb8f83478E0A2a90D109fA6044` (AdvancedFeeHookV6)
- Pool ID: `0x8a1187fd9da7eca25314eab717a10cebc19ffb319d5ebe8123e60b5565aadf23`

## How it works

1. `indexer/` reads `Initialize`, `Swap` and `ModifyLiquidity` events from the PoolManager and `FeeTaken` from the hook, then fetches each swap transaction's receipt to get the *actual* BROKER/EDEL amounts and the trader (after the hook tax).
2. `indexer/pnl.mjs` computes per-wallet PnL with the average-cost method, denominated in EDEL.
3. The result is written to `data/analytics.json`; `web/` is a static UI that renders it.

PnL only covers trades through this pool. Tokens acquired any other way carry zero cost basis and are flagged as "untracked". USD uses today's EDEL/USD rate.

## Run locally

```bash
npm install
# Use a fast RPC for receipts/blocks (Alchemy etc.). Log scanning uses a public RPC by default
# because eth_getLogs on free Alchemy tiers is limited to 10 blocks.
RPC_URL=https://base-mainnet.g.alchemy.com/v2/<key> npm run index
npm start            # http://127.0.0.1:5173
```

Environment variables: `RPC_URL` (receipts, blocks, contract reads), `LOGS_RPC_URL` (eth_getLogs, default `https://mainnet.base.org`), `START_BLOCK` (skip the deploy-block search).
Indexing is incremental: progress is cached in `data/cache.json` (git-ignored).

`npm run check-stuck` shows ERC-6909 claims the PoolManager holds for the hook's payout addresses (deferred payouts).

## GitHub Pages

```bash
npm run build        # copies web/ + data/analytics.json into docs/
```

Commit `docs/` and set **Settings → Pages → Deploy from a branch → `main` / `/docs`**.
Never commit an RPC key: pass it through the environment only.
