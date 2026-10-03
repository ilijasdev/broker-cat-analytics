// Wallet deep dive (wallet.html?a=0x…): everything the indexed data and the live chain say about one address.
// Trades, PnL, tax and reward payouts come from the indexed snapshot; balance, pending rewards and reward shares are read live.
const $ = (s, r = document) => r.querySelector(s);
let D = null, R = null, unit = 'edel', A = null;
const live = {}; // bal, pend, shares, isContract — undefined while reading, null if the RPCs did not answer
const charts = {};

// ---------- formatting (same helpers as app.js) ----------
const nf = (n, d = 2) => (n == null || !isFinite(n) ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const compact = (n) => (n == null || !isFinite(n) ? '–' : Math.abs(n) >= 1e6 ? nf(n / 1e6, 2) + 'M' : Math.abs(n) >= 1e3 ? nf(n / 1e3, 2) + 'k' : nf(n, Math.abs(n) < 1 ? 4 : 2));
const usdOK = () => unit === 'usd' && D.edelUsd;
const money = (edel) => (usdOK() ? '$' + compact(edel * D.edelUsd) : compact(edel) + ' EDEL');
const moneyPlain = (edel) => (usdOK() ? edel * D.edelUsd : edel);
const sgn = (edel) => `<span class="${edel > 0 ? 'pos' : edel < 0 ? 'neg' : ''}">${edel > 0 ? '+' : ''}${money(edel)}</span>`;
const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(1)}%`);
const sharePct = (x) => (x == null ? '–' : (x * 100).toFixed(x < 0.01 ? 4 : 2) + '%');
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const txl = (h, t = 'tx') => `<a href="https://basescan.org/tx/${h}" target="_blank" rel="noopener">${t}</a>`;
const dt = (ts) => (ts ? new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) : '–');
const price = (p) => (usdOK() ? '$' + (p * D.edelUsd).toPrecision(3) : p.toPrecision(3));

const win = (title, body, cls = '') =>
  `<div class="win ${cls}"><div class="bar"><span class="dots"><i></i><i></i><i></i></span>${title}</div><div class="body">${body}</div></div>`;
const kpi = (l, v) => `<div class="win kpi"><div class="body"><div class="v">${v}</div><div class="l">${l}</div></div></div>`;
const note = (t) => `<div class="note">${t}</div>`;
const sec = (t) => `<div class="stamp sec">${t}</div>`;
const sub = (t) => ` <span class="muted small">${t}</span>`;
const wait = (v, f) => (v === undefined ? '<span class="muted">reading…</span>' : v == null ? '–' : f(v));

// ---------- charts ----------
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim();
function draw(id, cfg) {
  charts[id]?.destroy();
  const cv = document.getElementById(id);
  if (!cv) return;
  Chart.defaults.color = '#0a0c10';
  Chart.defaults.borderColor = 'rgba(0,0,0,.15)';
  Chart.defaults.font.family = '"JetBrains Mono", monospace';
  Chart.defaults.font.size = 11;
  charts[id] = new Chart(cv, { ...cfg, options: { responsive: true, maintainAspectRatio: false, animation: false, ...cfg.options } });
}
const timeAxis = { type: 'linear', ticks: { callback: (v) => new Date(v * 1000).toISOString().slice(5, 10), maxTicksLimit: 8 } };
const dayKey = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

// ---------- live reads ----------
const RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
async function rpc(method, params) {
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.result != null) return j.result;
    } catch { /* try next RPC */ }
  }
  return null;
}
const ethCall = (to, selector) => rpc('eth_call', [{ to, data: selector + A.slice(2).padStart(64, '0') }, 'latest']);
const word0 = (hex) => (hex && hex.length >= 66 ? Number(BigInt(hex.slice(0, 66))) / 1e18 : null); // first return word, 18 decimals

// Tracker views (unverified contract, selectors recovered from its bytecode): pendingOf(address) -> EDEL,
// pendingTokenOf(address) -> BROKER, holders(address) -> (shares, …).
async function readLive() {
  const tracker = D.token.rewardTracker;
  const [bal, pe, pt, sh, code] = await Promise.all([
    ethCall(D.token.address, '0x70a08231'),
    tracker ? ethCall(tracker, '0xf44136a1') : null,
    tracker ? ethCall(tracker, '0xfdebf35e') : null,
    tracker ? ethCall(tracker, '0x18a5bbdc') : null,
    rpc('eth_getCode', [A, 'latest']),
  ]);
  live.bal = word0(bal);
  live.pend = word0(pe) == null && word0(pt) == null ? null : { edel: word0(pe) ?? 0, broker: word0(pt) ?? 0 };
  live.shares = word0(sh);
  live.isContract = code == null ? null : code !== '0x';
}

// ---------- load ----------
async function load() {
  const r = await fetch('data/analytics.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('data/analytics.json not found');
  D = await r.json();
  try { const rr = await fetch('data/rewards.json', { cache: 'no-store' }); if (rr.ok) R = await rr.json(); } catch { /* optional */ }
  $('#loading').hidden = true;
  $('#asof').textContent = `INDEXED THROUGH BLOCK ${D.lastBlock} · GENERATED ${dt(D.generatedAt)} UTC${R ? ` · REWARDS THROUGH BLOCK ${R.lastBlock}` : ''} · BALANCE, PENDING AND SHARES ARE READ LIVE`;
  if (!D.edelUsd) document.querySelector('input[value=usd]').closest('label').hidden = true;

  const q = (new URLSearchParams(location.search).get('a') || '').trim();
  $('#a-input').value = q;
  if (!ADDR_RE.test(q)) { renderEmpty(q ? 'That is not a valid 0x address.' : ''); return; }
  A = q.toLowerCase();
  document.title = `${short(A)} · Wallet deep dive · Broker Cat Analytics`;
  $('#a-copy').hidden = false;
  render();
  await readLive();
  render();
}

function renderEmpty(msg) {
  let mine = '';
  try { mine = localStorage.getItem('bca-addr') || ''; } catch { /* storage may be unavailable */ }
  $('#wallet').innerHTML = note(`${msg ? `<b>${msg}</b> ` : ''}Paste a wallet address above to see its net result, trading PnL, hook tax paid and holder rewards. The link <code>wallet.html?a=0x…</code> can be shared.`) +
    (ADDR_RE.test(mine) ? `<a class="pill" href="?a=${mine.toLowerCase()}">Open ${short(mine)} — your last calculator lookup</a>` : '');
}

function priceAtTs(ts) { // EDEL per BROKER at the nearest trade
  const T = D.trades; let lo = 0, hi = T.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (T[m].ts < ts) lo = m + 1; else hi = m; }
  return T[lo].price;
}

// Holder reward rate as % of volume: observed ~1.8% (theory 1.70%), the calculator's default.
const REWARD_RATE = 1.8;

// ---------- render ----------
function render() {
  const w = D.wallets.find((x) => x.address === A);
  const rec = R?.holders.find((h) => h.address === A);
  const mine = D.trades.filter((t) => t.trader === A);
  const T = D.trades, tEnd = T[T.length - 1].ts, mark = D.markPrice;
  const supply = D.token.totalSupply || 1e9;
  const ex = R?.excluded;
  const eligible = Math.max(1, supply - (ex ? ex.poolManager + ex.dead + ex.tracker : D.token.poolManagerBalance || 0));
  const maxWallet = D.token.maxWalletBps ? (supply * D.token.maxWalletBps) / 1e4 : null;
  // Balance: live when an RPC answered, otherwise the indexer's reading.
  const bal = live.bal ?? w?.balance ?? null;
  const balLive = live.bal != null;
  const isContract = live.isContract ?? rec?.isContract ?? null;
  const pend = live.pend ?? (rec?.pendE != null ? { edel: rec.pendE, broker: rec.pendB ?? 0 } : null);
  const flags = [];

  // ----- identity -----
  const seen = [w?.firstTs, rec?.firstTs, w?.lastTs, rec?.lastTs].filter(Boolean);
  let html = win(`WALLET ${short(A)}`, `
    <div class="addrline">
      <code class="full">${A}</code>
      ${isContract == null ? '' : `<span class="tag">${isContract ? 'contract / smart wallet' : 'EOA'}</span>`}
      ${w ? '<span class="tag buy">trader</span>' : ''}${rec ? '<span class="tag">reward recipient</span>' : ''}
      <a href="https://basescan.org/address/${A}" target="_blank" rel="noopener">BaseScan ↗</a>
    </div>
    <div class="grid kpis" style="margin:14px 0 0">
      ${kpi(`BROKER balance ${balLive ? 'now (live)' : live.bal === undefined ? 'now' : 'at index time'}`, bal == null ? wait(live.bal, compact) : compact(bal) + sub(money(bal * mark)))}
      ${kpi('Share of total supply', bal == null ? '–' : sharePct(bal / supply) + sub(`${sharePct(bal / eligible)} of reward-eligible supply`))}
      ${maxWallet ? kpi(`Of the max wallet (${compact(maxWallet)} BROKER)`, bal == null ? '–' : pct(bal / maxWallet)) : ''}
      ${kpi('Reward shares in the tracker (live)', wait(live.shares, compact))}
      ${kpi('Accrued, not yet delivered', pend ? `${compact(pend.edel)} EDEL + ${compact(pend.broker)} BROKER${sub('≈ ' + money(pend.edel + pend.broker * mark))}` : wait(live.pend, () => '–'))}
      ${kpi('First → last indexed activity', seen.length ? `${dt(Math.min(...seen)).slice(0, 10)} → ${dt(Math.max(...seen)).slice(0, 10)}` : '–')}
    </div>`);

  if (!w && !rec) {
    html += note(`No trades through the BROKER/EDEL pool and no holder-reward payouts for <code>${short(A)}</code> in the indexed data (through block ${D.lastBlock}). ${bal > 0 ? 'It holds BROKER, so it either got the tokens after the last index run or by transfer / on another venue.' : live.bal === undefined ? '' : 'It does not hold BROKER either.'}`);
  }

  // ----- net result -----
  const tax = new Map(D.fees.map((f) => [f.tx, f.platformEdel + f.creatorEdel]));
  const taxPaid = mine.reduce((a, t) => a + (tax.get(t.tx) ?? 0), 0);
  if (w) {
    const held = w.balance ?? w.position; // indexer's reading, consistent with the indexed trades
    const edelRw = rec?.edel ?? 0;
    const net = w.receivedEdel - w.spentEdel + edelRw + held * mark;
    const owed = w.spentEdel - w.receivedEdel - edelRw; // EDEL still to recover from the tokens held
    const row = (l, v, cls = '') => `<tr class="${cls}"><td class="l">${l}</td><td>${v}</td></tr>`;
    html += sec('01 · NET RESULT') + `
      <div class="grid kpis">
        ${kpi(`Net result${w.spentEdel > 0 ? ` (${pct(net / w.spentEdel)} on EDEL spent)` : ''}`, sgn(net))}
        ${kpi('Break-even price for the tokens held', owed <= 0 ? 'paid back' + sub('sells + EDEL rewards already cover the buys') : held > 0 ? price(owed / held) + (usdOK() ? '' : ' EDEL') + sub(`last price ${price(mark)}`) : '–')}
        ${kpi('Trading PnL in this pool', sgn(w.total))}
        ${kpi('Holder rewards received', rec ? money(rec.valueEdel) + sub('value at receipt') : '–')}
      </div>
      ${win('NET_RESULT.TABLE', `<table class="sum"><tbody>
        ${row(`EDEL spent on ${nf(w.buys, 0)} buys`, sgn(-w.spentEdel))}
        ${row(`EDEL received from ${nf(w.sells, 0)} sells`, sgn(w.receivedEdel))}
        ${row('EDEL received as holder rewards', sgn(edelRw))}
        ${row(`${compact(held)} BROKER held at index time × last price`, sgn(held * mark))}
        ${row('Net result', sgn(net), 'total')}
      </tbody></table>
      ${note(`<b>How to read this.</b> Everything that went out and came back in EDEL, plus what the tokens held are worth at the last price (${price(mark)}${usdOK() ? '' : ' EDEL'}). BROKER rewards are not added on top: they are either still in the balance or were sold, and then they are in the sell proceeds. The hook tax (${money(taxPaid)} on this wallet’s trades) is already inside the trade amounts. Accrued-but-undelivered rewards are not counted. Tokens that arrived or left by plain transfer count as free gains or as losses, because their cost is unknown.`)}`)}`;

    // ----- trading -----
    const vol = w.spentEdel + w.receivedEdel;
    html += sec('02 · TRADING') + `
      <div class="grid kpis">
        ${kpi(`Total PnL (ROI ${pct(w.roi)})`, sgn(w.total))}
        ${kpi('Realized', sgn(w.realized))}
        ${kpi('Unrealized', sgn(w.unrealized))}
        ${kpi(`Open position${w.avgCost ? ' @ ' + price(w.avgCost) : ''}`, compact(w.position))}
        ${kpi('Win rate on sells', pct(w.winRate) + sub(`${nf(w.buys, 0)} buys / ${nf(w.sells, 0)} sells`))}
        ${kpi('Hook tax paid', money(taxPaid) + sub(`${pct(taxPaid / (vol || 1))} of ${money(vol)} volume`))}
      </div>
      <div class="grid two">
        ${win('ENTRIES_AND_EXITS.CHART <span class="muted">(pool price, this wallet’s buys ▲ and sells ▼)</span>', '<div class="chartbox"><canvas id="c-entries"></canvas></div>')}
        ${win('CUMULATIVE_PNL.CHART', '<div class="chartbox"><canvas id="c-pnl"></canvas></div>')}
      </div>
      ${win('TRADES.LOG', `<div class="tablewrap" style="max-height:50vh"><table><thead><tr><th class="l">Time (UTC)</th><th>Side</th><th>BROKER</th><th>EDEL</th><th>Price</th><th>Tax</th><th></th></tr></thead><tbody>
      ${mine.slice().reverse().map((t) => `<tr><td class="l">${dt(t.ts)}</td><td><span class="tag ${t.side}">${t.side}</span></td><td>${compact(t.broker)}</td><td>${compact(t.edel)}</td><td>${price(t.price)}</td><td>${tax.has(t.tx) ? money(tax.get(t.tx)) : '–'}</td><td>${txl(t.tx)}</td></tr>`).join('')}
      </tbody></table></div>
      ${note('PnL uses only trades through this pool (average-cost method, in EDEL). Amounts are what the wallet actually paid and received, after the hook tax. Tax on buys is charged in BROKER and valued at the price of that trade.')}`)}`;

    if (w.untrackedSold > 1e-6) flags.push(`Sold ${compact(w.untrackedSold)} BROKER with no tracked purchase through this pool (booked at zero cost) — realized trading PnL is probably overstated. Holder rewards paid in BROKER and then sold show up here.`);
    if (w.viaRouter) flags.push(`${w.viaRouter} trades were resolved through a router address (final recipient/sender is followed); attribution may be off for complex aggregators.`);
    if (balLive && w.balance != null && Math.abs(live.bal - w.balance) > Math.max(1, w.balance * 0.01))
      flags.push(`The balance changed since the index run: ${compact(w.balance)} → ${compact(live.bal)} BROKER. The net result and trading figures are as of block ${D.lastBlock} and do not include what happened after.`);
    // What pool buys and unsold BROKER rewards cannot explain must have moved by transfer or on another venue.
    const gap = held - w.position - Math.max(0, (rec?.broker ?? 0) - w.untrackedSold);
    if (Math.abs(gap) > Math.max(1000, 0.01 * Math.max(held, w.position)))
      flags.push(gap > 0
        ? `Holds ≈ ${compact(gap)} BROKER more than its pool buys and reward payouts explain — received by transfer or bought on another venue. They are counted at zero cost, so the net result is overstated by their real cost.`
        : `≈ ${compact(-gap)} BROKER left this wallet other than through sells in this pool (transfers out, other venues). The net result counts them as lost.`);
  }

  // ----- rewards -----
  if (rec) {
    const days = Math.max(1, (tEnd - rec.firstTs) / 86400);
    const pos = (bal ?? 0) * mark;
    const realizedApr = pos > 0 ? (rec.valueEdel / pos) * (365 / days) : null;
    const vol24 = T.filter((t) => t.ts > tEnd - 86400).reduce((a, t) => a + t.edel, 0);
    const fwd = vol24 * (REWARD_RATE / 100) * ((bal ?? 0) / eligible);
    const byDay = {};
    for (const [ts, tok, amt] of rec.ev) {
      const d = (byDay[dayKey(ts)] ??= { b: 0, e: 0, v: 0, n: 0 });
      if (tok) { d.e += amt; d.v += amt; } else { d.b += amt; d.v += amt * priceAtTs(ts); }
      d.n++;
    }
    html += sec(`0${w ? 3 : 1} · HOLDER REWARDS`) + `
      <div class="grid kpis">
        ${kpi('Rewards received (BROKER)', compact(rec.broker) + ' BROKER')}
        ${kpi('Rewards received (EDEL)', compact(rec.edel) + ' EDEL')}
        ${kpi('Total value at receipt', money(rec.valueEdel) + sub(`${money(rec.edel + rec.broker * mark)} at the last price`))}
        ${kpi('Payout transfers', nf(rec.claims, 0) + sub(`${dt(rec.firstTs).slice(0, 10)} → ${dt(rec.lastTs).slice(0, 10)}`))}
        ${taxPaid > 0 ? kpi('Rewards received ÷ tax paid', pct(rec.valueEdel / taxPaid)) : ''}
        ${kpi('Realized APR on current balance', realizedApr == null ? '–' : nf(realizedApr * 100, 0) + '%' + sub(`over ${days.toFixed(1)} days`))}
        ${kpi('Forward: reward / day (24h volume)', pos > 0 ? money(fwd) : '–')}
        ${kpi('Forward: yearly at today’s conditions', pos > 0 ? money(fwd * 365) + sub(`≈ ${nf((fwd * 365 / pos) * 100, 0)}% APR`) : '–')}
      </div>
      <div class="grid two">
        ${win(`CUMULATIVE_REWARDS.CHART <span class="muted">(${usdOK() ? 'USD' : 'EDEL'} at receipt)</span>`, '<div class="chartbox"><canvas id="c-rw"></canvas></div>')}
        ${win('REWARDS_BY_DAY.LOG', `<div class="tablewrap" style="max-height:270px"><table><thead><tr><th class="l">Day (UTC)</th><th>BROKER</th><th>EDEL</th><th>Value at receipt</th><th>Payouts</th></tr></thead><tbody>
        ${Object.keys(byDay).sort().reverse().map((d) => `<tr><td class="l">${d}</td><td>${compact(byDay[d].b)}</td><td>${compact(byDay[d].e)}</td><td>${money(byDay[d].v)}</td><td>${byDay[d].n}</td></tr>`).join('')}
        </tbody></table></div>`)}
      </div>
      ${note(`Payouts are the BROKER and EDEL transfers from the tracker to this address (through block ${R.lastBlock}); each is valued at the pool price at that moment. <b>Accrued, not yet delivered</b> is paid automatically when the holder queue reaches the wallet, or on <code>claim()</code>; if the tracker has no cash on hand the delivery is deferred. “Realized APR” divides rewards by the <i>current</i> position, so it only means something if the balance was roughly constant. “Forward” assumes the last 24h of volume, a ${REWARD_RATE}% reward rate and today’s price hold — see the <a href="index.html">reward calculator</a> for what-if scenarios.`)}`;
  } else if (w || bal > 0) {
    html += note(`No holder-reward payouts found for <code>${short(A)}</code> in the indexed data${R ? ` (through block ${R.lastBlock})` : ''}. It may have bought after the last index run, hold through a contract, or be excluded.`);
  }

  if (live.shares === 0 && bal > 0) flags.push('The tracker shows zero reward shares for this address although it holds BROKER — it is not accruing holder rewards right now.');
  if (maxWallet && bal > maxWallet * 0.9) flags.push(`The balance is at ${pct(bal / maxWallet)} of the max wallet. Reward payouts in BROKER that would push it over the cap revert on the token side.`);
  if (isContract) flags.push('This address has code (smart wallet, router or pool). Trades and rewards attributed to it may belong to more than one person.');
  if (flags.length) html += sec('FLAGS') + win('FLAGS.TXT', flags.map((f) => `<div class="risk med"><div class="small">${f}</div></div>`).join(''));

  $('#wallet').innerHTML = html;

  // ----- charts -----
  const pts = (side) => mine.filter((t) => t.side === side).map((t) => ({ x: t.ts, y: moneyPlain(t.price) }));
  const marker = (label, side, color, rotation) => ({ label, data: pts(side), showLine: false, pointStyle: 'triangle', rotation, pointRadius: 7, pointHoverRadius: 9, backgroundColor: color, borderColor: '#000', borderWidth: 2 });
  draw('c-entries', { type: 'line', data: { datasets: [
    marker('Buys', 'buy', css('acid'), 0), marker('Sells', 'sell', css('coral'), 180),
    { label: 'Pool price', data: T.map((t) => ({ x: t.ts, y: moneyPlain(t.price) })), borderColor: 'rgba(0,0,0,.3)', pointRadius: 0, borderWidth: 1 }] },
    options: { scales: { x: timeAxis, y: { type: 'logarithmic', ticks: { callback: (v) => Number(v).toPrecision(1) } } } } });
  if (w) draw('c-pnl', { type: 'line', data: { datasets: [
    { label: 'Realized', data: w.series.map((s) => ({ x: s[0], y: moneyPlain(s[1]) })), borderColor: '#000', pointRadius: 0, stepped: true, borderWidth: 2 },
    { label: 'Realized + unrealized', data: w.series.map((s) => ({ x: s[0], y: moneyPlain(s[1] + s[2]) })), borderColor: css('edel'), pointRadius: 0, borderWidth: 2 }] },
    options: { scales: { x: timeAxis } } });
  if (rec) {
    let cum = 0;
    const cumPts = rec.ev.map(([ts, tok, amt]) => { cum += moneyPlain(tok ? amt : amt * priceAtTs(ts)); return { x: ts, y: +cum.toFixed(4) }; });
    draw('c-rw', { type: 'line', data: { datasets: [{ data: cumPts, borderColor: '#000', backgroundColor: css('acid'), pointRadius: 0, borderWidth: 2, stepped: true, fill: true }] },
      options: { plugins: { legend: { display: false } }, scales: { x: timeAxis } } });
  }
}

// ---------- wiring ----------
$('#addrbar').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#a-input').value.trim();
  if (!ADDR_RE.test(v)) { $('#a-status').textContent = 'Not a valid 0x address.'; return; }
  location.search = '?a=' + v.toLowerCase();
});
$('#a-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('#a-status').textContent = 'Link copied.'; }
  catch { $('#a-status').textContent = 'Copy the address bar instead.'; }
});
document.querySelectorAll('input[name=unit]').forEach((r) => r.addEventListener('change', () => { unit = r.value; if (A) render(); }));
load().catch((e) => {
  $('#loading').hidden = false;
  $('#loading').innerHTML = `Error: ${e.message}. Run <code>npm run index</code>, then <code>npm start</code>.`;
  $('#asof').textContent = 'NO DATA';
});
