// Holder rewards: everything the reward tracker received from the hook and paid out to holders,
// reconstructed purely from ERC-20 Transfer logs of BROKER and EDEL to/from the tracker.
// The tracker source is unverified, so we do not rely on its ABI or custom events.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, toHex, toEventSelector, getAbiItem, formatUnits, pad } from 'viem';
import { base } from 'viem/chains';
import * as C from './config.mjs';
import { erc20 } from './abi.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'rewards.json');
const CACHE = path.join(ROOT, 'data', 'rewards-cache.json');
const lc = (s) => s.toLowerCase();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const logsClient = createPublicClient({ chain: base, transport: http(C.LOGS_RPC_URL, { retryCount: 6, retryDelay: 600 }) });
const client = createPublicClient({ chain: base, transport: http(C.RPC_URL, { retryCount: 6, retryDelay: 600 }) });
const TRANSFER = toEventSelector(getAbiItem({ abi: erc20, name: 'Transfer' }));

const analytics = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'analytics.json'), 'utf8'));
const tracker = lc(analytics.token.rewardTracker);
const start = BigInt(analytics.pool.init?.block ?? 0);
const latest = await client.getBlockNumber();
const T = pad(tracker); // topic form of the tracker address

async function scan(token, topics, from, to, sink) {
  let step = 10000n, cur = from, fails = 0;
  while (cur <= to) {
    const end = cur + step - 1n > to ? to : cur + step - 1n;
    try {
      const logs = await logsClient.request({ method: 'eth_getLogs', params: [{ address: token, topics, fromBlock: toHex(cur), toBlock: toHex(end) }] });
      sink(logs);
      fails = 0; cur = end + 1n;
      await new Promise((r) => setTimeout(r, 120));
      process.stdout.write(`\r  ${token.slice(0, 8)} ${cur}/${to}   `);
    } catch (e) {
      const rl = /rate limit|429|too many/i.test(`${e.details || ''} ${e.message || ''}`);
      if (!rl && step > 200n) step /= 2n;
      else if (++fails > 60) throw e;
      else await new Promise((r) => setTimeout(r, Math.min(2000 * fails, 20000)));
    }
  }
  process.stdout.write('\n');
}

let cache = { to: null, transfers: [] };
if (fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
const from = cache.to != null ? BigInt(cache.to) + 1n : start;

if (from <= latest) {
  log(`scanning transfers of BROKER and EDEL to/from tracker ${tracker}, blocks ${from} → ${latest}`);
  for (const [name, token] of [['BROKER', lc(C.BROKER)], ['EDEL', lc(C.EDEL)]]) {
    for (const dir of ['in', 'out']) {
      const topics = dir === 'in' ? [TRANSFER, null, T] : [TRANSFER, T];
      await scan(token, topics, from, latest, (logs) => {
        for (const l of logs) {
          cache.transfers.push({ token: name, dir, block: Number(BigInt(l.blockNumber)), logIndex: Number(BigInt(l.logIndex)), tx: l.transactionHash,
            from: lc('0x' + l.topics[1].slice(26)), to: lc('0x' + l.topics[2].slice(26)), value: BigInt(l.data).toString() });
        }
      });
    }
  }
  cache.to = Number(latest);
  const seen = new Set();
  cache.transfers = cache.transfers.filter((t) => { const k = `${t.tx}:${t.logIndex}`; if (seen.has(k)) return false; seen.add(k); return true; });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}

// ---------- aggregate ----------
const dec = 18;
const num = (v) => Number(formatUnits(BigInt(v), dec));
const tokens = { BROKER: { in: 0, out: 0, inFromHook: 0, inOther: 0, claims: 0, holders: new Map() }, EDEL: { in: 0, out: 0, inFromHook: 0, inOther: 0, claims: 0, holders: new Map() } };
const PM = lc(C.POOL_MANAGER), HOOK = lc(C.HOOK);
let firstIn = null, lastOut = null;
// Historical valuation: each payout is valued at the price of the nearest trade, timestamp interpolated (Base blocks are 2s).
const TR = analytics.trades;
const nearest = (block) => { let lo = 0, hi = TR.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (TR[m].block < block) lo = m + 1; else hi = m; } return TR[lo]; };
const perAddr = new Map();
for (const t of cache.transfers) {
  const k = tokens[t.token], v = num(t.value);
  if (t.dir === 'in') {
    k.in += v;
    // hook payouts arrive from the PoolManager (take) — anything else is a direct transfer/donation
    if (t.from === PM || t.from === HOOK) k.inFromHook += v; else k.inOther += v;
    firstIn = Math.min(firstIn ?? Infinity, t.block);
  } else {
    k.out += v; k.claims++;
    const h = k.holders.get(t.to) ?? { amount: 0, n: 0, last: 0 };
    h.amount += v; h.n++; h.last = Math.max(h.last, t.block);
    k.holders.set(t.to, h);
    lastOut = Math.max(lastOut ?? 0, t.block);
    const nt = nearest(t.block), ts = nt.ts + (t.block - nt.block) * 2;
    const pa = perAddr.get(t.to) ?? { value: 0, first: Infinity, last: 0, ev: [] };
    pa.value += t.token === 'EDEL' ? v : v * nt.price;
    pa.first = Math.min(pa.first, ts); pa.last = Math.max(pa.last, ts);
    pa.ev.push([ts, t.token === 'EDEL' ? 1 : 0, t.token === 'EDEL' ? +v.toFixed(6) : +v.toFixed(2)]);
    perAddr.set(t.to, pa);
  }
}

// block → timestamp for last claims (only a handful of lookups)
const tsOf = async (b) => (b ? Number((await client.getBlock({ blockNumber: BigInt(b) })).timestamp) : null);
const [firstInTs, lastOutTs] = await Promise.all([tsOf(firstIn), tsOf(lastOut)]);

const bal = async (token) => Number(formatUnits(await client.readContract({ address: token, abi: erc20, functionName: 'balanceOf', args: [tracker] }), dec));
const [balB, balE] = await Promise.all([bal(C.BROKER), bal(C.EDEL)]);

const addrs = new Set([...tokens.BROKER.holders.keys(), ...tokens.EDEL.holders.keys()]);
const holders = [...addrs].map((a) => {
  const b = tokens.BROKER.holders.get(a), e = tokens.EDEL.holders.get(a);
  const pa = perAddr.get(a);
  return { address: a, broker: b?.amount ?? 0, edel: e?.amount ?? 0, claims: (b?.n ?? 0) + (e?.n ?? 0), lastBlock: Math.max(b?.last ?? 0, e?.last ?? 0),
    valueEdel: pa?.value ?? 0, firstTs: pa?.first ?? null, lastTs: pa?.last ?? null, ev: pa ? pa.ev.sort((x, y) => x[0] - y[0]) : [] };
});

// which recipients are contracts (routers, pools) rather than holder wallets?
const codeFlags = new Map();
if (fs.existsSync(OUT)) { try { for (const h of JSON.parse(fs.readFileSync(OUT, 'utf8')).holders) codeFlags.set(h.address, h.isContract); } catch { /* first run */ } }
const unknown = holders.filter((h) => !codeFlags.has(h.address));
for (let i = 0; i < unknown.length; i += 25) {
  await Promise.all(unknown.slice(i, i + 25).map(async (h) => {
    const code = await client.getCode({ address: h.address }).catch(() => null);
    codeFlags.set(h.address, !!code && code !== '0x');
  }));
}
holders.forEach((h) => { h.isContract = codeFlags.get(h.address) || false; });

const summary = (name, bal_) => {
  const k = tokens[name];
  return { in: k.in, inFromHook: k.inFromHook, inOther: k.inOther, out: k.out, claims: k.claims, recipients: k.holders.size, balance: bal_ };
};
const res = {
  generatedAt: Math.floor(Date.now() / 1000), lastBlock: Number(latest), tracker,
  firstInTs, lastClaimTs: lastOutTs,
  BROKER: summary('BROKER', balB), EDEL: summary('EDEL', balE),
  uniqueRecipients: holders.length, contractRecipients: holders.filter((h) => h.isContract).length,
  holders: holders.sort((a, b) => b.edel + b.broker * analytics.markPrice - (a.edel + a.broker * analytics.markPrice)),
};
// Supply that plausibly does not earn holder rewards (used by the reward calculator's eligible-supply estimate).
res.excluded = {
  poolManager: await client.readContract({ address: C.BROKER, abi: erc20, functionName: 'balanceOf', args: [C.POOL_MANAGER] }).then((v) => Number(formatUnits(v, dec))).catch(() => 0),
  dead: await client.readContract({ address: C.BROKER, abi: erc20, functionName: 'balanceOf', args: [C.BURN] }).then((v) => Number(formatUnits(v, dec))).catch(() => 0),
  tracker: balB,
};

// Cross-check against the launchpad's public API (aggregates it reports for this token). Optional.
try {
  const url = `https://api.basestonk.io/api/launchpad/tokens/${C.BROKER}`;
  let j;
  try { j = await (await fetch(url)).json(); }
  catch { // Node/Windows cannot verify this host's incomplete certificate chain; Git's curl (Mozilla CA bundle) can. Verification stays on.
    const bins = ['curl', 'C:/Program Files/Git/mingw64/bin/curl.exe'];
    for (const bin of bins) {
      try { j = JSON.parse(execFileSync(bin, ['-sS', '-m', '30', url], { encoding: 'utf8', maxBuffer: 20e6, stdio: ['ignore', 'pipe', 'ignore'] })); break; } catch { /* try next */ }
    }
    if (!j) throw new Error('API unreachable');
  }
  const t = j.token;
  res.api = {
    rewardsToken: Number(formatUnits(BigInt(t.rewardsToken), dec)), rewardsPair: Number(formatUnits(BigInt(t.rewardsPair), dec)),
    burntTokens: Number(formatUnits(BigInt(t.burntTokens), dec)), buybackPair: Number(formatUnits(BigInt(t.buybackPair), dec)),
    holders: t.holders, rewardsBps: t.rewardsBps,
  };
} catch { /* API is a convenience, not a dependency */ }
fs.writeFileSync(OUT, JSON.stringify(res));
log(`done: ${holders.length} recipient addresses`, JSON.stringify({ BROKER: res.BROKER, EDEL: res.EDEL }));
