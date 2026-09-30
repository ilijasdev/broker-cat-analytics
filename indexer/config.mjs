export const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';
// eth_getLogs with wide ranges: Alchemy free tier allows only 10 blocks, so scan logs on a public RPC.
export const LOGS_RPC_URL = process.env.LOGS_RPC_URL || 'https://mainnet.base.org';

export const POOL_MANAGER = '0x498581ff718922c3f8e6a244956af099b2652b2b';
export const BROKER = '0xcE24b51766135Fb97D330BdcfabcC03d6Ad28222';
export const EDEL = '0xFb31f85A8367210B2e4Ed2360D2dA9Dc2D2Ccc95';
export const HOOK = '0x7C672F3850afadCb8f83478E0A2a90D109fA6044';
// BROKER/EDEL Uniswap v4 pool (id as reported by DexScreener)
export const POOL_ID = '0x8a1187fd9da7eca25314eab717a10cebc19ffb319d5ebe8123e60b5565aadf23';
export const DEXSCREENER_PAIR = `https://api.dexscreener.com/latest/dex/pairs/base/${POOL_ID}`;

export const BURN = '0x000000000000000000000000000000000000dead';
export const ZERO = '0x0000000000000000000000000000000000000000';

// Optional: skip the deploy-block search by pinning a start block.
export const START_BLOCK = process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : null;
