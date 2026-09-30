// Prikazuje ERC-6909 "claimove" koje PoolManager drži za hook primatelje (odgođene isplate).
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { base } from 'viem/chains';
import * as C from './config.mjs';
import { hookRead } from './abi.mjs';
const client = createPublicClient({ chain: base, transport: http(C.RPC_URL) });
const pm = parseAbi(['function balanceOf(address owner, uint256 id) view returns (uint256)']);
const id = (a) => BigInt(a);
const rd = (address, abi, functionName, args) => client.readContract({ address, abi, functionName, args }).catch(() => null);

const who = { hook: C.HOOK, BURN: C.BURN };
for (const fn of ['platformTreasury', 'launcher', 'platformAdmin']) who[fn] = await rd(C.HOOK, hookRead, fn);
console.log('Adrese:', who);
for (const [name, a] of Object.entries(who)) {
  if (!a) continue;
  const [b, e] = await Promise.all([rd(C.POOL_MANAGER, pm, 'balanceOf', [a, id(C.BROKER)]), rd(C.POOL_MANAGER, pm, 'balanceOf', [a, id(C.EDEL)])]);
  console.log(name.padEnd(17), 'claim BROKER', b == null ? '?' : formatUnits(b, 18), '| claim EDEL', e == null ? '?' : formatUnits(e, 18));
}
const erc = parseAbi(['function balanceOf(address) view returns (uint256)', 'function totalSupply() view returns (uint256)', 'function exemptFromMaxWallet(address) view returns (bool)']);
const [supply, burnBal, burnEx, tBal, tEx] = await Promise.all([
  rd(C.BROKER, erc, 'totalSupply'), rd(C.BROKER, erc, 'balanceOf', [C.BURN]), rd(C.BROKER, erc, 'exemptFromMaxWallet', [C.BURN]),
  rd(C.BROKER, erc, 'balanceOf', [who.platformTreasury]), rd(C.BROKER, erc, 'exemptFromMaxWallet', [who.platformTreasury])]);
console.log('BROKER supply', formatUnits(supply, 18), '| dEaD balance', formatUnits(burnBal, 18), 'exempt:', burnEx, `(${(Number(burnBal) / Number(supply) * 100).toFixed(2)}% supplyja)`);
console.log('treasury BROKER', formatUnits(tBal, 18), 'exempt:', tEx, `(${(Number(tBal) / Number(supply) * 100).toFixed(2)}%)`);
