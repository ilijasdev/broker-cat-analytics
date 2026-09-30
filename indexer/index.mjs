import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, http, decodeEventLog, toEventSelector, getAbiItem, formatUnits, pad, toHex,
} from 'viem';
import { base } from 'viem/chains';
import * as C from './config.mjs';
import { poolManagerEvents, hookEvents, hookRead, erc20 } from './abi.mjs';
import { computePnl } from './pnl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(DATA, 'cache.json');
const OUT = path.join(DATA, 'analytics.json');
fs.mkdirSync(DATA, { recursive: true });

const client = createPublicClient({ chain: base, transport: http(C.RPC_URL, { retryCount: 6, retryDelay: 600 }) });
const logsClient = createPublicClient({ chain: base, transport: http(C.LOGS_RPC_URL, { retryCount: 6, retryDelay: 600 }) });
const lc = (s) => s.toLowerCase();
const PM = lc(C.POOL_MANAGER), BROKER = lc(C.BROKER), EDEL = lc(C.EDEL), HOOK = lc(C.HOOK);
const TRANSFER_TOPIC = toEventSelector(getAbiItem({ abi: erc20, name: 'Transfer' }));
const topic = (abi, name) => toEventSelector(getAbiItem({ abi, name }));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- cache ----------
let cache = { scannedTo: null, poolTo: null, feeTo: null, init: null, swaps: [], liq: [], fees: [], txs: {}, blockTs: {} };
if (fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
const saveCache = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

// Overlapping runs / resumed ranges can append the same log twice; keep one copy per (tx, logIndex).
const uniqBy = (arr) => { const s = new Set(); return arr.filter((x) => { const k = `${x.tx}:${x.logIndex}`; if (s.has(k)) return false; s.add(k); return true; }); };
if (cache.fees.some((f) => f.logIndex == null)) { cache.fees = []; cache.feeTo = null; } // old cache lacks logIndex: rescan
cache.swaps = uniqBy(cache.swaps); cache.liq = uniqBy(cache.liq); cache.fees = uniqBy(cache.fees);

// ---------- helpers ----------
async function findDeployBlock(address, latest) {
  let lo = 0n, hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    let code;
    try { code = await client.getCode({ address, blockNumber: mid }); }
    catch (e) { throw new Error(`getCode failed at ${mid} (RPC without archive state?). Set START_BLOCK. ${e.shortMessage || e.message}`); }
    if (code && code !== '0x') hi = mid; else lo = mid + 1n;
  }
  return lo;
}

async function rawLogs(params, from, to, step0 = 5000n, onChunk) {
  let step = step0, cur = from, fails = 0;
  while (cur <= to) {
    const end = cur + step - 1n > to ? to : cur + step - 1n;
    try {
      const logs = await logsClient.request({
        method: 'eth_getLogs',
        params: [{ ...params, fromBlock: toHex(cur), toBlock: toHex(end) }],
      });
      onChunk(logs, end);
      fails = 0;
      await new Promise((r) => setTimeout(r, 120));
      cur = end + 1n;
      if (step < step0) step = step * 2n > step0 ? step0 : step * 2n;
    } catch (e) {
      // Rate limits are not range errors: keep the step, back off instead of shrinking it.
      const rateLimited = /rate limit|429|too many requests/i.test(`${e.details || ''} ${e.message || ''}`);
      if (!rateLimited && step > 100n) step /= 2n;
      else if (++fails > 60) throw e;
      else await new Promise((r) => setTimeout(r, Math.min(2000 * fails, 20000)));
    }
  }
}

// Try providers in turn (alternating start) so one rate-limited endpoint does not stall the run.
let rr = 0;
async function anyClient(fn) {
  const order = rr++ % 2 === 0 ? [client, logsClient] : [logsClient, client];
  let err;
  for (const c of order) {
    try { return await fn(c); } catch (e) { err = e; }
  }
  throw err;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const k = i++;
      for (let attempt = 0; ; attempt++) {
        try { out[k] = await fn(items[k], k); break; }
        catch (e) {
          if (attempt >= 25) throw e;
          await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 20000))); // 429 / transient errors
        }
      }
    }
  }));
  return out;
}

// ---------- 1. scan pool events ----------
const latest = await client.getBlockNumber();
let start;
if (cache.startBlock != null) start = BigInt(cache.startBlock);
else if (C.START_BLOCK != null) start = C.START_BLOCK;
else {
  log('finding BROKER deploy block…');
  start = await findDeployBlock(C.BROKER, latest);
  log('deploy block', start.toString());
}
cache.startBlock = Number(start);

const t = {
  init: topic(poolManagerEvents, 'Initialize'),
  liq: topic(poolManagerEvents, 'ModifyLiquidity'),
  swap: topic(poolManagerEvents, 'Swap'),
  fee: topic(hookEvents, 'FeeTaken'),
};
const poolTopic = C.POOL_ID;

const poolFrom = cache.poolTo != null ? BigInt(cache.poolTo) + 1n : start;
const feeFrom = cache.feeTo != null ? BigInt(cache.feeTo) + 1n : start;
if (poolFrom <= latest || feeFrom <= latest) {
  log(`scanning pool ${poolFrom} → ${latest}, hook ${feeFrom} → ${latest}`);
  let n = 0, chunks = 0;
  if (poolFrom <= latest) await rawLogs(
    { address: C.POOL_MANAGER, topics: [[t.init, t.liq, t.swap], poolTopic] },
    poolFrom, latest, 5000n,
    (logs, end) => {
      for (const l of logs) {
        const ev = decodeEventLog({ abi: poolManagerEvents, data: l.data, topics: l.topics });
        const base_ = { block: Number(BigInt(l.blockNumber)), logIndex: Number(BigInt(l.logIndex)), tx: l.transactionHash };
        if (ev.eventName === 'Initialize') {
          cache.init = { ...base_, currency0: ev.args.currency0, currency1: ev.args.currency1, fee: ev.args.fee,
            tickSpacing: ev.args.tickSpacing, hooks: ev.args.hooks, sqrtPriceX96: ev.args.sqrtPriceX96.toString(), tick: ev.args.tick };
        } else if (ev.eventName === 'Swap') {
          cache.swaps.push({ ...base_, sender: lc(ev.args.sender), a0: ev.args.amount0.toString(), a1: ev.args.amount1.toString(),
            tick: ev.args.tick, fee: ev.args.fee, liquidity: ev.args.liquidity.toString() });
        } else {
          cache.liq.push({ ...base_, sender: lc(ev.args.sender), tickLower: ev.args.tickLower, tickUpper: ev.args.tickUpper,
            delta: ev.args.liquidityDelta.toString(), salt: ev.args.salt });
        }
        n++;
      }
      cache.poolTo = Number(end);
      if (++chunks % 10 === 0) saveCache();
      process.stdout.write(`\r  up to block ${end}  events ${n}   `);
    },
  );
  saveCache();
  if (feeFrom <= latest) await rawLogs(
    { address: C.HOOK, topics: [t.fee, poolTopic] },
    feeFrom, latest, 5000n,
    (logs, end) => {
      for (const l of logs) {
        const ev = decodeEventLog({ abi: hookEvents, data: l.data, topics: l.topics });
        cache.fees.push({ block: Number(BigInt(l.blockNumber)), logIndex: Number(BigInt(l.logIndex)), tx: l.transactionHash,
          currency: lc(ev.args.currency), platform: ev.args.platform.toString(), creator: ev.args.creator.toString() });
      }
      cache.feeTo = Number(end);
      if (++chunks % 10 === 0) saveCache();
    },
  );
  process.stdout.write('\n');
  cache.scannedTo = Number(latest);
  cache.poolTo = cache.feeTo = Number(latest);
  saveCache();
} else log('already up to date');

if (!cache.init) log('WARNING: no Initialize event found for POOL_ID — check the pool id / start block');

// ---------- 2. receipts → trades ----------
const dec = 18; // verified below via decimals()
const swapsByTx = new Map();
for (const s of cache.swaps) {
  if (!swapsByTx.has(s.tx)) swapsByTx.set(s.tx, []);
  swapsByTx.get(s.tx).push(s);
}

const [treasury, launcher, admin] = await Promise.all(
  ['platformTreasury', 'launcher', 'platformAdmin'].map((fn) =>
    client.readContract({ address: C.HOOK, abi: hookRead, functionName: fn }).catch(() => null)),
);
const exclude = new Set([PM, HOOK, C.BURN, C.ZERO, treasury && lc(treasury)].filter(Boolean));

const pending = [...swapsByTx.keys()].filter((h) => !cache.txs[h]);
log(`${swapsByTx.size} swap txs, ${pending.length} receipts to fetch`);
let done = 0;
await mapLimit(pending, 4, async (hash) => {
  const rc = await anyClient((c) => c.getTransactionReceipt({ hash }));
  cache.txs[hash] = deriveTrade(rc, swapsByTx.get(hash));
  if (++done % 100 === 0) { process.stdout.write(`\r  receipts ${done}/${pending.length}   `); saveCache(); }
});
if (pending.length) { process.stdout.write('\n'); saveCache(); }

function sumBy(map, k, v) { map.set(k, (map.get(k) || 0n) + v); }
function argmax(map) { let best = null, bv = -1n; for (const [k, v] of map) if (v > bv) { best = k; bv = v; } return best; }

function deriveTrade(rc, swaps) {
  const user = swaps.filter((s) => s.sender !== HOOK);
  if (!user.length) return { skip: true, block: Number(rc.blockNumber) };
  const net0 = user.reduce((a, s) => a + BigInt(s.a0), 0n); // BROKER is currency0; + = swapper receives BROKER
  const side = net0 > 0n ? 'buy' : 'sell';

  const tr = [];
  for (const l of rc.logs) {
    if (l.topics[0] !== TRANSFER_TOPIC || l.topics.length !== 3) continue;
    const a = lc(l.address);
    if (a !== BROKER && a !== EDEL) continue;
    tr.push({ token: a === BROKER ? 'B' : 'E', from: lc('0x' + l.topics[1].slice(26)), to: lc('0x' + l.topics[2].slice(26)), value: BigInt(l.data) });
  }

  let trader, brokerRaw = 0n, edelRaw = 0n, viaRouter = false;
  if (side === 'buy') {
    const rec = new Map();
    for (const x of tr) if (x.token === 'B' && x.from === PM && !exclude.has(x.to)) sumBy(rec, x.to, x.value);
    trader = argmax(rec);
    if (!trader) return { skip: true, block: Number(rc.blockNumber) };
    brokerRaw = rec.get(trader);
    const hop = tr.find((x) => x.token === 'B' && x.from === trader && x.to !== PM && !exclude.has(x.to) && x.value * 10n >= brokerRaw * 9n);
    if (hop) { trader = hop.to; viaRouter = true; }
    for (const x of tr) if (x.token === 'E' && x.to === PM) edelRaw += x.value;
  } else {
    const snd = new Map();
    for (const x of tr) if (x.token === 'B' && x.to === PM) { sumBy(snd, x.from, x.value); brokerRaw += x.value; }
    trader = argmax(snd);
    if (!trader) return { skip: true, block: Number(rc.blockNumber) };
    const hop = tr.find((x) => x.token === 'B' && x.to === trader && x.from !== PM && !exclude.has(x.from) && x.value * 10n >= snd.get(trader) * 9n);
    if (hop) { trader = hop.from; viaRouter = true; }
    for (const x of tr) if (x.token === 'E' && x.from === PM && !exclude.has(x.to)) edelRaw += x.value;
  }
  return {
    block: Number(rc.blockNumber), trader, txFrom: lc(rc.from), side,
    broker: brokerRaw.toString(), edel: edelRaw.toString(), viaRouter, multi: user.length > 1,
    logIndex: Math.min(...user.map((s) => s.logIndex)),
  };
}

// ---------- 3. timestamps ----------
const blocks = [...new Set([
  ...Object.values(cache.txs).filter((x) => !x.skip).map((x) => x.block),
  ...cache.liq.map((x) => x.block), ...cache.fees.map((x) => x.block),
])].filter((b) => cache.blockTs[b] == null);
log(`${blocks.length} block timestamps to fetch`);
await mapLimit(blocks, 4, async (b) => {
  const blk = await anyClient((c) => c.getBlock({ blockNumber: BigInt(b), includeTransactions: false }));
  cache.blockTs[b] = Number(blk.timestamp);
});
if (blocks.length) saveCache();

// ---------- 4. build analytics ----------
const trades = Object.entries(cache.txs)
  .filter(([, x]) => !x.skip)
  .map(([tx, x]) => {
    const broker = Number(formatUnits(BigInt(x.broker), dec));
    const edel = Number(formatUnits(BigInt(x.edel), dec));
    return { tx, ts: cache.blockTs[x.block], block: x.block, logIndex: x.logIndex, trader: x.trader, txFrom: x.txFrom,
      side: x.side, broker, edel, price: broker > 0 ? edel / broker : 0, viaRouter: x.viaRouter,
      multi: (swapsByTx.get(tx) || []).filter((q) => q.sender !== HOOK).length > 1 };
  })
  .filter((x) => x.broker > 0 && x.edel > 0)
  .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);

const markPrice = trades.length ? trades[trades.length - 1].price : 0;
const wallets = computePnl(trades, markPrice);

// current balances
log(`reading balances for ${wallets.length} wallets…`);
const addrs = wallets.map((w) => w.address);
for (let i = 0; i < addrs.length; i += 300) {
  const slice = addrs.slice(i, i + 300);
  const res = await client.multicall({
    contracts: slice.map((a) => ({ address: C.BROKER, abi: erc20, functionName: 'balanceOf', args: [a] })),
    allowFailure: true,
  }).catch(() => []);
  res.forEach((r, k) => { if (r.status === 'success') wallets[i + k].balance = Number(formatUnits(r.result, dec)); });
}

// token + hook + pool meta
const rd = (address, abi, functionName, args) => client.readContract({ address, abi, functionName, args }).catch(() => null);
const [symbol, totalSupply, maxWalletBps, pmExempt, rewardTracker, launched, edelSymbol, pmBalance] = await Promise.all([
  rd(C.BROKER, erc20, 'symbol'), rd(C.BROKER, erc20, 'totalSupply'), rd(C.BROKER, erc20, 'maxWalletBps'),
  rd(C.BROKER, erc20, 'exemptFromMaxWallet', [C.POOL_MANAGER]), rd(C.BROKER, erc20, 'rewardTracker'),
  rd(C.BROKER, erc20, 'launched'), rd(C.EDEL, erc20, 'symbol'), rd(C.BROKER, erc20, 'balanceOf', [C.POOL_MANAGER]),
]);

let hook = null;
if (cache.init) {
  const cfg = await rd(C.HOOK, hookRead, 'configOf', [C.POOL_ID]);
  const key = { currency0: cache.init.currency0, currency1: cache.init.currency1, fee: cache.init.fee, tickSpacing: cache.init.tickSpacing, hooks: cache.init.hooks };
  const payees = await rd(C.HOOK, hookRead, 'payees', [key]);
  hook = {
    cfg: cfg && { buyTaxBps: cfg[0], sellTaxBps: cfg[1], burnBps: cfg[2], liquidityBps: cfg[3], tokenIsCurrency0: cfg[4], set: cfg[5],
      sniperEndsAt: Number(cfg[6]), sniperWindow: cfg[7], sniperStartBps: cfg[8] },
    payees: payees && payees.map((p) => ({ to: p.to, shareBps: p.shareBps })),
    treasury, launcher, admin,
  };
}

let dex = null;
try { dex = (await (await fetch(C.DEXSCREENER_PAIR)).json()).pair ?? null; } catch { /* optional */ }
const edelUsd = dex?.priceUsd && dex?.priceNative ? Number(dex.priceUsd) / Number(dex.priceNative) : null;

const tradePrice = new Map(trades.map((x) => [x.tx, x.price]));
function priceAt(tx, block) {
  if (tradePrice.has(tx)) return tradePrice.get(tx);
  let lo = 0, hi = trades.length - 1; // nearest trade by block (trades are sorted)
  while (lo < hi) { const mid = (lo + hi) >> 1; if (trades[mid].block < block) lo = mid + 1; else hi = mid; }
  return trades.length ? trades[lo].price : markPrice;
}
const fees = cache.fees.map((f) => {
  const isB = f.currency === BROKER;
  const p = Number(formatUnits(BigInt(f.platform), dec)), c = Number(formatUnits(BigInt(f.creator), dec));
  // BROKER-denominated fees are valued at the price of the trade that generated them (not today's price).
  const k = isB ? priceAt(f.tx, f.block) : 1;
  return { ts: cache.blockTs[f.block], tx: f.tx, currency: isB ? 'BROKER' : 'EDEL', platform: p, creator: c, platformEdel: p * k, creatorEdel: c * k };
});
const liq = cache.liq.map((l) => ({ ...l, ts: cache.blockTs[l.block], delta: l.delta }));

const analytics = {
  generatedAt: Math.floor(Date.now() / 1000),
  lastBlock: cache.scannedTo,
  markPrice, edelUsd,
  dex: dex && { liquidityUsd: dex.liquidity?.usd, priceUsd: dex.priceUsd, fdv: dex.fdv, volume24h: dex.volume?.h24, url: dex.url },
  token: { address: C.BROKER, symbol, edelSymbol, totalSupply: totalSupply != null ? Number(formatUnits(totalSupply, dec)) : null,
    maxWalletBps, poolManagerExempt: pmExempt, rewardTracker, launched, poolManagerBalance: pmBalance != null ? Number(formatUnits(pmBalance, dec)) : null },
  pool: { id: C.POOL_ID, poolManager: C.POOL_MANAGER, hookAddress: C.HOOK, edel: C.EDEL, init: cache.init },
  hook, trades, wallets, fees, liq,
};
fs.writeFileSync(OUT, JSON.stringify(analytics));
log(`done: ${trades.length} trades, ${wallets.length} wallets, ${fees.length} fee events → ${path.relative(ROOT, OUT)}`);
