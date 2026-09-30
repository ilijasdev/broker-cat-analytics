import fs from 'node:fs';
import { createPublicClient, http, parseAbi, decodeEventLog, formatUnits, toHex } from 'viem';
import { base } from 'viem/chains';
const c = createPublicClient({ chain: base, transport: http('https://mainnet.base.org', { retryCount: 8, retryDelay: 1500 }) });
const T = '0xe0301d789704341C2Ab086352d032D29BB211C55';
const abi = parseAbi([
  'event Accrued(uint256 amount, uint256 accPerShare)', 'event AccruedToken(uint256 amount, uint256 accPerShare)',
  'event Delivered(address indexed holder, uint256 amount)', 'event DeliveredToken(address indexed holder, uint256 amount)',
  'event DeliveryDeferred(address indexed holder, uint256 amount)']);
const state = fs.existsSync('data/inv-state.json') ? JSON.parse(fs.readFileSync('data/inv-state.json', 'utf8')) : { cur: '51329804', sum: {}, cnt: {} };
let cur = BigInt(state.cur); const sum = Object.fromEntries(Object.entries(state.sum).map(([k, v]) => [k, BigInt(v)])); const cnt = state.cnt;
const latest = await c.getBlockNumber(); let step = 3000n, fails = 0, n = 0;
const add = (k, v) => { sum[k] = (sum[k] || 0n) + v; cnt[k] = (cnt[k] || 0) + 1; };
const save = () => fs.writeFileSync('data/inv-state.json', JSON.stringify({ cur: cur.toString(), sum: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v.toString()])), cnt }));
while (cur <= latest) {
  const end = cur + step - 1n > latest ? latest : cur + step - 1n;
  try {
    const logs = await c.request({ method: 'eth_getLogs', params: [{ address: T, fromBlock: toHex(cur), toBlock: toHex(end) }] });
    for (const l of logs) { try { const ev = decodeEventLog({ abi, data: l.data, topics: l.topics }); add(ev.eventName, ev.args.amount ?? 0n); } catch { add('other', 0n); } }
    cur = end + 1n; fails = 0; if (++n % 20 === 0) save(); await new Promise((r) => setTimeout(r, 250));
  } catch (e) { const m = (e.details || e.message || '').toLowerCase(); if (/rate|429|limit/.test(m) && ++fails < 40) await new Promise((r) => setTimeout(r, 2500 * fails)); else if (step > 300n) step /= 2n; else { save(); console.log('STOP at', cur.toString(), m.slice(0, 120)); process.exit(1); } }
}
save();
const f = (v) => Number(formatUnits(v ?? 0n, 18)).toLocaleString('en-US', { maximumFractionDigits: 1 });
for (const k of Object.keys(sum)) console.log(k.padEnd(18), String(cnt[k]).padStart(6), 'events | Σ amount', f(sum[k]));
