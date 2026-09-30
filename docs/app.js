const $ = (s, r = document) => r.querySelector(s);
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
let D = null, R = null, unit = 'edel';
const charts = {};

// ---------- formatting ----------
const nf = (n, d = 2) => (n == null || !isFinite(n) ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const compact = (n) => (n == null || !isFinite(n) ? '–' : Math.abs(n) >= 1e6 ? nf(n / 1e6, 2) + 'M' : Math.abs(n) >= 1e3 ? nf(n / 1e3, 2) + 'k' : nf(n, Math.abs(n) < 1 ? 4 : 2));
const usdOK = () => unit === 'usd' && D.edelUsd;
const money = (edel) => (usdOK() ? '$' + compact(edel * D.edelUsd) : compact(edel) + ' EDEL');
const moneyPlain = (edel) => (usdOK() ? edel * D.edelUsd : edel);
const sgn = (edel) => `<span class="${edel > 0 ? 'pos' : edel < 0 ? 'neg' : ''}">${edel > 0 ? '+' : ''}${money(edel)}</span>`;
const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(1)}%`);
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const addr = (a) => `<a href="https://basescan.org/address/${a}" target="_blank" rel="noopener">${short(a)}</a>`;
const txl = (h, t = 'tx') => `<a href="https://basescan.org/tx/${h}" target="_blank" rel="noopener">${t}</a>`;
const dt = (ts) => (ts ? new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) : '–');
const price = (p) => (usdOK() ? '$' + (p * D.edelUsd).toPrecision(3) : p.toPrecision(3));
const bpsPct = (x) => (x == null ? '–' : (x / 100).toFixed(2) + '%');

const win = (title, body, cls = '') =>
  `<div class="win ${cls}"><div class="bar"><span class="dots"><i></i><i></i><i></i></span>${title}</div><div class="body">${body}</div></div>`;
const kpi = (l, v) => `<div class="win kpi"><div class="body"><div class="v">${v}</div><div class="l">${l}</div></div></div>`;
const note = (t) => `<div class="note">${t}</div>`;

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
const bar = (color) => ({ backgroundColor: color, borderColor: '#000', borderWidth: 2 });
const timeAxis = { type: 'linear', ticks: { callback: (v) => new Date(v * 1000).toISOString().slice(5, 10), maxTicksLimit: 8 } };
const dayKey = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

// ---------- load ----------
async function load() {
  const r = await fetch('data/analytics.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('data/analytics.json not found');
  D = await r.json();
  try { const rr = await fetch('data/rewards.json', { cache: 'no-store' }); if (rr.ok) R = await rr.json(); } catch { /* optional */ }
  $('#loading').hidden = true;
  $('#asof').textContent = `DATA THROUGH BLOCK ${D.lastBlock} · GENERATED ${dt(D.generatedAt)} UTC · ${D.trades.length} TRADES · ${D.wallets.length} WALLETS`;
  if (!D.edelUsd) document.querySelector('input[value=usd]').closest('label').hidden = true;
  renderAll();
}
const renderAll = () => { renderOverview(); renderWallets(); renderHook(); renderRewards(); renderCalc(); renderLp(); renderRisk(); };

// ---------- overview ----------
function renderOverview() {
  const T = D.trades, W = D.wallets;
  const vol = T.reduce((a, t) => a + t.edel, 0);
  const buys = T.filter((t) => t.side === 'buy'), sells = T.filter((t) => t.side === 'sell');
  const profit = W.filter((w) => w.total > 0).length;
  const realized = W.reduce((a, w) => a + w.realized, 0);
  const last24 = T.filter((t) => t.ts > D.generatedAt - 86400);
  $('#overview').innerHTML = `
    <div class="grid kpis">
      ${kpi('Last price', price(D.markPrice) + (usdOK() ? '' : ' EDEL'))}
      ${kpi('Total volume', money(vol))}
      ${kpi('Volume, last 24h of data', money(last24.reduce((a, t) => a + t.edel, 0)))}
      ${kpi('Buys / sells', `${nf(buys.length, 0)} / ${nf(sells.length, 0)}`)}
      ${kpi('Trading wallets', nf(W.length, 0))}
      ${kpi('Wallets in profit', `${profit} <span class="muted small">(${pct(profit / (W.length || 1))})</span>`)}
      ${kpi('Sum of realized PnL', sgn(realized))}
      ${kpi('Liquidity (DexScreener)', D.dex?.liquidityUsd ? '$' + compact(D.dex.liquidityUsd) : '–')}
    </div>
    <div class="grid one">
      ${win('PRICE_PER_TRADE.CHART', '<div class="chartbox tall"><canvas id="c-price"></canvas></div>')}
    </div>
    <div class="grid two" style="margin-top:18px">
      ${win('DAILY_VOLUME.CHART', '<div class="chartbox"><canvas id="c-vol"></canvas></div>')}
      ${win('NET_FLOW.CHART <span class="muted">(buys − sells)</span>', '<div class="chartbox"><canvas id="c-net"></canvas></div>')}
      ${win('WALLET_PNL_DISTRIBUTION.CHART', '<div class="chartbox"><canvas id="c-dist"></canvas></div>')}
    </div>
    ${note('PnL uses only trades through this pool (average-cost method, in EDEL). Tokens acquired any other way carry zero cost basis and are flagged as “untracked”. USD uses today’s EDEL/USD rate, not the historical one.')}`;

  draw('c-price', { type: 'line', data: { datasets: [{ data: T.map((t) => ({ x: t.ts, y: moneyPlain(t.price) })), borderColor: '#000', backgroundColor: css('acid'), pointRadius: 0, borderWidth: 2 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: timeAxis, y: { type: 'logarithmic', ticks: { callback: (v) => Number(v).toPrecision(1) } } } } });

  const days = {};
  for (const t of T) (days[dayKey(t.ts)] ??= { buy: 0, sell: 0 })[t.side] += t.edel;
  const dl = Object.keys(days).sort();
  draw('c-vol', { type: 'bar', data: { labels: dl, datasets: [
    { label: 'Buys', data: dl.map((d) => moneyPlain(days[d].buy)), ...bar(css('acid')), stack: 's' },
    { label: 'Sells', data: dl.map((d) => moneyPlain(days[d].sell)), ...bar(css('coral')), stack: 's' }] },
    options: { scales: { x: { stacked: true, ticks: { maxTicksLimit: 8 } }, y: { stacked: true } } } });
  draw('c-net', { type: 'bar', data: { labels: dl, datasets: [{ data: dl.map((d) => moneyPlain(days[d].buy - days[d].sell)),
    ...bar(dl.map((d) => (days[d].buy >= days[d].sell ? css('acid') : css('coral')))) }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8 } } } } });

  const edges = [-Infinity, -1000, -100, -10, -1, 0, 1, 10, 100, 1000, Infinity];
  const labels = ['< -1k', '-1k…-100', '-100…-10', '-10…-1', '-1…0', '0…1', '1…10', '10…100', '100…1k', '> 1k'];
  const counts = new Array(labels.length).fill(0);
  for (const w of W) { const v = moneyPlain(w.total); for (let i = 0; i < labels.length; i++) if (v >= edges[i] && v < edges[i + 1]) { counts[i]++; break; } }
  draw('c-dist', { type: 'bar', data: { labels, datasets: [{ data: counts, ...bar(labels.map((_, i) => (i < 5 ? css('coral') : css('acid')))) }] },
    options: { plugins: { legend: { display: false } } } });
}

// ---------- wallets ----------
const walletCols = [
  ['address', 'Wallet', (w) => addr(w.address), 'l'],
  ['trades', 'Buys/Sells', (w) => `${w.buys}/${w.sells}`],
  ['spentEdel', 'Spent', (w) => money(w.spentEdel)],
  ['receivedEdel', 'Received', (w) => money(w.receivedEdel)],
  ['position', 'Position (BROKER)', (w) => compact(w.position)],
  ['avgCost', 'Avg cost', (w) => (w.avgCost ? price(w.avgCost) : '–')],
  ['realized', 'Realized', (w) => sgn(w.realized)],
  ['unrealized', 'Unrealized', (w) => sgn(w.unrealized)],
  ['total', 'Total PnL', (w) => sgn(w.total)],
  ['roi', 'ROI', (w) => (w.roi == null ? '–' : `<span class="${w.roi >= 0 ? 'pos' : 'neg'}">${pct(w.roi)}</span>`)],
  ['winRate', 'Win %', (w) => pct(w.winRate)],
  ['balance', 'Balance now', (w) => (w.balance == null ? '–' : compact(w.balance))],
  ['lastTs', 'Last trade', (w) => dt(w.lastTs)],
];
const wstate = { sort: 'total', asc: false, q: '', min: 1, view: 'all' };

function renderWallets() {
  $('#wallets').innerHTML = win('WALLET_PNL.EXE', `
    <div class="toolbar">
      <input type="search" id="wq" placeholder="Search address…" value="${wstate.q}">
      <select id="wview">
        <option value="all">All wallets</option><option value="winners">In profit</option><option value="losers">In loss</option>
        <option value="open">Open position</option><option value="closed">Closed position</option>
        <option value="untracked">Sold “untracked” tokens</option>
      </select>
      <select id="wmin"><option value="1">≥ 1 trade</option><option value="2">≥ 2 trades</option><option value="5">≥ 5 trades</option><option value="20">≥ 20 trades</option></select>
      <span class="muted small" id="wcount"></span>
    </div>
    <div class="tablewrap"><table><thead><tr></tr></thead><tbody></tbody></table></div>
    ${note('Total = realized + unrealized (position × last price − cost basis). “Balance now” is the live BROKER balance; if it exceeds the tracked position, the wallet got tokens outside this pool. Click a row for details.')}`);
  $('#wview').value = wstate.view; $('#wmin').value = wstate.min;
  const head = $('#wallets thead tr');
  walletCols.forEach(([k, label], i) => {
    const th = el(`<th class="${i === 0 ? 'l' : ''}">${label}</th>`);
    th.dataset.k = k; head.append(th);
    th.onclick = () => { wstate.asc = wstate.sort === k ? !wstate.asc : false; wstate.sort = k; fillWallets(); };
  });
  $('#wq').oninput = (e) => { wstate.q = e.target.value.trim().toLowerCase(); fillWallets(); };
  $('#wview').onchange = (e) => { wstate.view = e.target.value; fillWallets(); };
  $('#wmin').onchange = (e) => { wstate.min = +e.target.value; fillWallets(); };
  fillWallets();
}

function fillWallets() {
  const f = {
    all: () => true, winners: (w) => w.total > 0, losers: (w) => w.total < 0, open: (w) => w.position > 1e-6,
    closed: (w) => w.position <= 1e-6, untracked: (w) => w.untrackedSold > 1e-6,
  }[wstate.view];
  const key = wstate.sort;
  const rows = D.wallets.filter((w) => f(w) && w.trades >= wstate.min && (!wstate.q || w.address.includes(wstate.q)))
    .sort((a, b) => { const x = a[key] ?? -Infinity, y = b[key] ?? -Infinity; return (x < y ? -1 : x > y ? 1 : 0) * (wstate.asc ? 1 : -1); });
  $('#wcount').textContent = `${rows.length} wallets${rows.length > 500 ? ' (showing top 500)' : ''}`;
  [...$('#wallets thead tr').children].forEach((th) => {
    th.classList.toggle('sorted', th.dataset.k === key); th.classList.toggle('asc', th.dataset.k === key && wstate.asc);
  });
  const tb = $('#wallets tbody'); tb.innerHTML = '';
  for (const w of rows.slice(0, 500)) {
    const tr = el(`<tr class="click">${walletCols.map(([, , fn, c]) => `<td class="${c || ''}">${fn(w)}</td>`).join('')}</tr>`);
    tr.onclick = (e) => { if (e.target.tagName !== 'A') openWallet(w.address); };
    tb.append(tr);
  }
}

function openWallet(a) {
  const w = D.wallets.find((x) => x.address === a);
  const mine = D.trades.filter((t) => t.trader === a);
  $('#drawer').hidden = false;
  $('#drawer-body').innerHTML = `
    ${win(`WALLET ${short(a)}`, `
      <div>${addr(a)} <span class="muted small">· ${nf(w.trades, 0)} trades · ${dt(w.firstTs)} → ${dt(w.lastTs)}</span></div>
      <div class="grid kpis" style="grid-template-columns:1fr 1fr;margin:12px 0 0">
        ${kpi(`Total PnL (ROI ${pct(w.roi)})`, sgn(w.total))}
        ${kpi('Realized', sgn(w.realized))}
        ${kpi('Unrealized', sgn(w.unrealized))}
        ${kpi(`Open position${w.avgCost ? ' @ ' + price(w.avgCost) : ''}`, compact(w.position))}
      </div>
      ${w.untrackedSold > 1e-6 ? note(`Sold ${compact(w.untrackedSold)} BROKER with no tracked purchase through this pool (booked at zero cost) — realized PnL is probably overstated.`) : ''}
      ${w.viaRouter ? note(`${w.viaRouter} trades were resolved through a router address (final recipient/sender is followed); attribution may be off for complex aggregators.`) : ''}`)}
    ${(() => { const rw = R?.holders.find((h) => h.address === a); return rw ? note(`Holder rewards claimed from the tracker: <b>${compact(rw.edel)} EDEL</b> + <b>${compact(rw.broker)} BROKER</b> (not included in the PnL above).`) : ''; })()}
    ${win('CUMULATIVE_PNL.CHART', '<div class="chartbox" style="height:220px"><canvas id="c-wallet"></canvas></div>')}
    ${win('TRADES.LOG', `<div class="tablewrap" style="max-height:40vh"><table><thead><tr><th class="l">Time (UTC)</th><th>Side</th><th>BROKER</th><th>EDEL</th><th>Price</th><th></th></tr></thead><tbody>
    ${mine.slice().reverse().map((t) => `<tr><td class="l">${dt(t.ts)}</td><td><span class="tag ${t.side}">${t.side}</span></td><td>${compact(t.broker)}</td><td>${compact(t.edel)}</td><td>${price(t.price)}</td><td>${txl(t.tx)}</td></tr>`).join('')}
    </tbody></table></div>`)}`;
  draw('c-wallet', { type: 'line', data: { datasets: [
    { label: 'Realized', data: w.series.map((s) => ({ x: s[0], y: moneyPlain(s[1]) })), borderColor: '#000', pointRadius: 0, stepped: true, borderWidth: 2 },
    { label: 'Realized + unrealized', data: w.series.map((s) => ({ x: s[0], y: moneyPlain(s[1] + s[2]) })), borderColor: css('edel'), pointRadius: 0, borderWidth: 2 }] },
    options: { scales: { x: timeAxis } } });
}
$('#drawer-close').onclick = () => { $('#drawer').hidden = true; };

// ---------- hook & tax ----------
function renderHook() {
  const H = D.hook, c = H?.cfg, I = D.pool.init;
  const F = D.fees;
  const tot = F.reduce((a, f) => ({ p: a.p + f.platformEdel, c: a.c + f.creatorEdel }), { p: 0, c: 0 });
  const vb = D.trades.filter((t) => t.side === 'buy').reduce((a, t) => a + t.edel, 0), vs = D.trades.filter((t) => t.side === 'sell').reduce((a, t) => a + t.edel, 0);
  const isHook = I && I.hooks.toLowerCase() === D.pool.hookAddress.toLowerCase();
  $('#hook').innerHTML = `
    <div class="grid two">
      ${win('POOL.SYS', `<table><tbody>
          <tr><td class="l">Pool ID</td><td><code>${D.pool.id.slice(0, 18)}…</code></td></tr>
          <tr><td class="l">LP fee tier</td><td>${I ? bpsPct(I.fee) + ` (${I.fee})` : '–'}</td></tr>
          <tr><td class="l">Tick spacing</td><td>${I?.tickSpacing ?? '–'}</td></tr>
          <tr><td class="l">Hook (from Initialize)</td><td>${I ? addr(I.hooks) : '–'} ${isHook ? '<span class="tag buy">AdvancedFeeHookV6</span>' : '<span class="tag sell">unexpected hook</span>'}</td></tr>
          <tr><td class="l">currency0 / currency1</td><td>${I ? addr(I.currency0) + ' / ' + addr(I.currency1) : '–'}</td></tr>
        </tbody></table>
        ${note('To add liquidity, use exactly this PoolKey: currency0 (BROKER), currency1 (EDEL), the fee and tick spacing above, and this hook address. Any other combination is a different pool.')}`)}
      ${win('TAX_CONFIG.SYS <span class="muted">(on-chain, immutable)</span>', c ? `<table><tbody>
          <tr><td class="l">Buy tax</td><td>${bpsPct(c.buyTaxBps)}</td></tr>
          <tr><td class="l">Sell tax</td><td>${bpsPct(c.sellTaxBps)}</td></tr>
          <tr><td class="l">Burn share of creator part</td><td>${bpsPct(c.burnBps)}</td></tr>
          <tr><td class="l">Liquidity share of creator part</td><td>${bpsPct(c.liquidityBps)}</td></tr>
          <tr><td class="l">Sniper protection</td><td>${c.sniperWindow ? `${c.sniperWindow}s from ${bpsPct(c.sniperStartBps)}, ended ${dt(c.sniperEndsAt)}` : 'not set'}</td></tr>
        </tbody></table>
        <h3>Payees</h3>
        <table><tbody>${(H.payees || []).map((p) => `<tr><td class="l">${addr(p.to)}${p.to.toLowerCase() === (D.token.rewardTracker || '').toLowerCase() ? ' <span class="tag">reward tracker</span>' : ''}</td><td>${bpsPct(p.shareBps)}</td></tr>`).join('') || '<tr><td>–</td></tr>'}</tbody></table>
        <h3>Roles</h3>
        <table><tbody><tr><td class="l">Launcher</td><td>${H.launcher ? addr(H.launcher) : '–'}</td></tr>
        <tr><td class="l">Platform admin</td><td>${H.admin ? addr(H.admin) : '–'}</td></tr>
        <tr><td class="l">Platform treasury</td><td>${H.treasury ? addr(H.treasury) : '–'}</td></tr></tbody></table>` : '<div class="muted">configOf unavailable (RPC error).</div>')}
      ${win('TAX_COLLECTED.CHART <span class="muted">(in EDEL)</span>', `<div class="chartbox"><canvas id="c-fees"></canvas></div>
        <div class="small muted" style="margin-top:8px">Total: platform ${money(tot.p)} · creator/payees ${money(tot.c)}. BROKER-denominated fees are valued at the price of the trade that produced them.</div>`)}
      ${win('TAX_SUMMARY.TXT', `<table><tbody>
        <tr><td class="l">Tax collected / total volume</td><td>${pct((tot.p + tot.c) / (vb + vs || 1))}</td></tr>
        <tr><td class="l">Platform share of tax</td><td>${pct(tot.p / (tot.p + tot.c || 1))}</td></tr>
        <tr><td class="l">Buy volume</td><td>${money(vb)}</td></tr><tr><td class="l">Sell volume</td><td>${money(vs)}</td></tr>
        <tr><td class="l">Fee events</td><td>${nf(F.length, 0)}</td></tr></tbody></table>
        ${note('Fees are charged in the swap’s output currency: buys pay in BROKER, sells pay in EDEL. Tax does not go to LPs — LPs earn only the pool’s LP fee.')}`)}
    </div>`;
  const days = {};
  for (const f of F) { const d = dayKey(f.ts); (days[d] ??= { p: 0, c: 0 }); days[d].p += f.platformEdel; days[d].c += f.creatorEdel; }
  const dl = Object.keys(days).sort();
  draw('c-fees', { type: 'bar', data: { labels: dl, datasets: [
    { label: 'Platform', data: dl.map((d) => moneyPlain(days[d].p)), ...bar(css('cyan')), stack: 's' },
    { label: 'Creator / payees', data: dl.map((d) => moneyPlain(days[d].c)), ...bar(css('yellow')), stack: 's' }] },
    options: { scales: { x: { stacked: true, ticks: { maxTicksLimit: 8 } }, y: { stacked: true } } } });
}

// ---------- holder rewards ----------
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

function renderRewards() {
  if (!R) { $('#rewards').innerHTML = note('No <code>data/rewards.json</code> yet — run <code>npm run rewards</code>.'); return; }
  const mark = D.markPrice;
  const val = (h) => h.edel + h.broker * mark; // value in EDEL, BROKER at the last price
  const ratio = (o, i) => (i > 0 ? o / i : null);
  const pnl = new Map(D.wallets.map((w) => [w.address, w]));
  const totalVal = R.holders.reduce((a, h) => a + val(h), 0);
  $('#rewards').innerHTML = `
    <div class="grid kpis">
      ${kpi('EDEL paid to holders', money(R.EDEL.out))}
      ${kpi('BROKER paid to holders', compact(R.BROKER.out) + ' BROKER')}
      ${kpi('Addresses that received rewards', nf(R.uniqueRecipients, 0) + (R.contractRecipients ? ` <span class="muted small">(${R.contractRecipients} are contracts, mostly smart wallets/bots)</span>` : ''))}
      ${kpi('Payout transfers', nf(R.EDEL.claims + R.BROKER.claims, 0))}
      ${kpi('Received by tracker (EDEL)', `${money(R.EDEL.in)} <span class="muted small">${pct(ratio(R.EDEL.out, R.EDEL.in))} paid out</span>`)}
      ${kpi('Received by tracker (BROKER)', `${compact(R.BROKER.in)} <span class="muted small">${pct(ratio(R.BROKER.out, R.BROKER.in))} paid out</span>`)}
      ${kpi('Still in tracker (unclaimed)', `${money(R.EDEL.balance)} + ${compact(R.BROKER.balance)} BROKER`)}
      ${kpi('First deposit → last claim', `${dt(R.firstInTs).slice(5, 10)} → ${dt(R.lastClaimTs).slice(5, 10)}`)}
    </div>
    ${note(`<b>Mechanism.</b> The hook’s <code>afterSwap</code> only sends 85% of the creator share of every tax to the payee <code>${short(R.tracker)}</code> (the token’s <code>rewardTracker</code>) — a plain transfer. The <i>payout to holders</i> is triggered by the BROKER token itself: its <code>_update</code> calls <code>tracker.ping(from, to, value)</code> (up to 5M gas, failures ignored) after <b>every</b> BROKER transfer, so each trade advances a queue of holders and pays them automatically; <code>claim()</code> is optional. Figures are rebuilt from BROKER/EDEL <code>Transfer</code> logs to/from the tracker (its source is unverified). BROKER is valued at the last price (${price(mark)}${usdOK() ? '' : ' EDEL'}).${R.api ? ` Cross-check with the launchpad API: rewardsToken ${compact(R.api.rewardsToken)} BROKER, rewardsPair ${compact(R.api.rewardsPair)} EDEL, ${nf(R.api.holders, 0)} holders.` : ''}`)}
    <div class="grid two">
      ${win(`TOP_RECIPIENTS.CHART <span class="muted">(value in ${usdOK() ? 'USD' : 'EDEL'})</span>`, '<div class="chartbox"><canvas id="c-rw"></canvas></div>')}
      ${win('DISTRIBUTION_STATS.TXT', `<table><tbody>
        <tr><td class="l">Median reward per address</td><td>${money(median(R.holders.map(val)))}</td></tr>
        <tr><td class="l">Average reward per address</td><td>${money(totalVal / (R.holders.length || 1))}</td></tr>
        <tr><td class="l">Top 10 share of all rewards</td><td>${pct(R.holders.slice(0, 10).reduce((a, h) => a + val(h), 0) / (totalVal || 1))}</td></tr>
        <tr><td class="l">EDEL deposited by hook / PoolManager</td><td>${money(R.EDEL.inFromHook)}</td></tr>
        <tr><td class="l">EDEL deposited from elsewhere</td><td>${money(R.EDEL.inOther)}</td></tr>
        <tr><td class="l">BROKER deposited by hook / PoolManager</td><td>${compact(R.BROKER.inFromHook)}</td></tr>
        <tr><td class="l">BROKER deposited from elsewhere</td><td>${compact(R.BROKER.inOther)}</td></tr>
      </tbody></table>`)}
    </div>
    <div style="height:18px"></div>
    ${win('REWARD_RECIPIENTS.LOG', `<div class="toolbar"><input type="search" id="rq" placeholder="Search address…"><select id="rk"><option value="all">All recipients</option><option value="wallet">EOAs only</option><option value="contract">Contracts / smart wallets only</option></select><span class="muted small" id="rcount"></span></div>
      <div class="tablewrap"><table><thead><tr><th class="l">Address</th><th>Type</th><th>BROKER received</th><th>EDEL received</th><th>Total value</th><th>Claims</th><th>Last claim block</th><th>Trading PnL</th></tr></thead><tbody></tbody></table></div>`)}`;
  const fill = () => {
    const q = $('#rq').value.trim().toLowerCase(), k = $('#rk').value;
    const rows = R.holders.filter((h) => (!q || h.address.includes(q)) && (k === 'all' || (k === 'contract') === h.isContract));
    $('#rcount').textContent = `${rows.length} addresses${rows.length > 500 ? ' (showing top 500)' : ''}`;
    $('#rewards tbody').innerHTML = rows.slice(0, 500).map((h) => {
      const w = pnl.get(h.address);
      return `<tr><td class="l">${addr(h.address)}</td><td>${h.isContract ? '<span class="tag">contract</span>' : 'EOA'}</td><td>${compact(h.broker)}</td><td>${compact(h.edel)}</td><td>${money(val(h))}</td><td>${h.claims}</td><td>${h.lastBlock}</td><td>${w ? sgn(w.total) : '<span class="muted">–</span>'}</td></tr>`;
    }).join('');
  };
  $('#rq').oninput = fill; $('#rk').onchange = fill; fill();
  const top = R.holders.slice(0, 15);
  draw('c-rw', { type: 'bar', data: { labels: top.map((h) => short(h.address)), datasets: [{ data: top.map((h) => moneyPlain(val(h))), ...bar(top.map((h) => (h.isContract ? css('cyan') : css('acid')))) }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
}

// ---------- reward calculator ----------
// Expected holder reward = daily volume x holder reward rate x (your BROKER / eligible supply).
// Part 1 looks up an address (rewards received so far, live balance, yield). Part 2 is a what-if with
// market-cap and volume multipliers. Everything is an estimate.
const RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];
const calcState = { addr: '', balance: null, mcapMult: 1, volMult: 1, volBase: '24h', rate: 1.8, touched: false };
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
try { calcState.addr = localStorage.getItem('bca-addr') || ''; } catch { /* storage may be unavailable */ }

async function rpcBalance(a) {
  const data = '0x70a08231' + a.slice(2).toLowerCase().padStart(64, '0');
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: D.token.address, data }, 'latest'] }) });
      const j = await r.json();
      if (j.result && j.result !== '0x') return Number(BigInt(j.result)) / 1e18;
    } catch { /* try next RPC */ }
  }
  return null;
}

function priceAtTs(ts) { // EDEL per BROKER at the nearest trade
  const T = D.trades; let lo = 0, hi = T.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (T[m].ts < ts) lo = m + 1; else hi = m; }
  return T[lo].price;
}

function renderCalc() {
  if (!D.edelUsd) { $('#calc').innerHTML = note('EDEL/USD rate unavailable, so the calculator (which works in USD) cannot run. Re-run the indexer.'); return; }
  const s = calcState;
  const supply = D.token.totalSupply || 1e9;
  const T = D.trades, tEnd = T[T.length - 1].ts, tStart = T[0].ts;
  const priceNow = D.markPrice * D.edelUsd, mcapNow = priceNow * supply;
  const totalVolUsd = T.reduce((a, t) => a + t.edel, 0) * D.edelUsd;
  const vol24 = T.filter((t) => t.ts > tEnd - 86400).reduce((a, t) => a + t.edel, 0) * D.edelUsd;
  const volAvg = totalVolUsd / Math.max(1, (tEnd - tStart) / 86400);
  const buyShare = T.filter((t) => t.side === 'buy').reduce((a, t) => a + t.edel, 0) / (T.reduce((a, t) => a + t.edel, 0) || 1);
  const ex = R?.excluded;
  const excluded = ex ? ex.poolManager + ex.dead + ex.tracker : (D.token.poolManagerBalance || 0);
  const eligible = Math.max(1, supply - excluded);
  const usd = (v) => '$' + (Math.abs(v) >= 100 ? nf(v, 0) : Math.abs(v) >= 1 ? nf(v, 2) : nf(v, 4));
  const apy = (apr) => (Math.pow(1 + apr / 365, 365) - 1);

  $('#calc').innerHTML = `
    ${win('MY_WALLET.EXE <span class="muted">— rewards received so far</span>', `
      <div class="toolbar">
        <input type="search" id="k-addr" placeholder="Paste your wallet address (0x…)" value="${s.addr}" style="flex:1;min-width:280px">
        <button class="pill" id="k-look" type="button">Look up</button>
        <span class="muted small" id="k-status"></span>
      </div>
      <div id="k-wallet"></div>
      ${note('Runs entirely in your browser. The address is only used to read your public BROKER balance from a public Base RPC and to look it up in the indexed data; it is not sent to any server of ours. It is remembered in this browser only.')}`)}
    <div style="height:18px"></div>
    ${win('WHAT_IF.EXE <span class="muted">— scale market cap and volume</span>', `
      <div class="grid two" style="margin-bottom:12px">
        <div class="grid" style="gap:12px">
          <label>BROKER held<br><input type="number" id="k-amount" min="0" step="any" style="width:100%"></label>
          <label>Market cap multiplier: <b id="k-mm-v"></b> <span class="muted small">(price × same; now ${'$' + compact(mcapNow)}, ${'$' + priceNow.toPrecision(3)} per BROKER)</span><br>
            <input type="range" id="k-mm-r" min="-1" max="2" step="0.01" style="width:100%">
            <span class="chips" data-for="mcapMult">${[0.5, 1, 2, 5, 10, 25].map((m) => `<button class="pill chip" type="button" data-v="${m}">${m}×</button>`).join(' ')}</span></label>
          <label>Volume multiplier: <b id="k-vm-v"></b> <span class="muted small">(base ${'$' + compact(s.volBase === 'avg' ? volAvg : vol24)} / day)</span><br>
            <input type="range" id="k-vm-r" min="-1" max="2" step="0.01" style="width:100%">
            <span class="chips" data-for="volMult">${[0.25, 0.5, 1, 2, 5, 10].map((m) => `<button class="pill chip" type="button" data-v="${m}">${m}×</button>`).join(' ')}</span></label>
        </div>
        <div class="grid" style="gap:12px">
          <label>Base daily volume<br><select id="k-vbase"><option value="24h">Last 24h of data (${'$' + compact(vol24)})</option><option value="avg">Period average (${'$' + compact(volAvg)})</option></select></label>
          <label>Holder reward rate (% of volume) — observed ~1.8%, theory 1.70%<br><input type="number" id="k-rate" min="0" step="0.01" style="width:100%"></label>
          <div class="small muted">Buys are ${(buyShare * 100).toFixed(0)}% of volume (they pay the reward in BROKER, sells in EDEL). Supply that earns nothing: ${compact(excluded)} BROKER (PoolManager + dead + tracker), so ${compact(eligible)} BROKER share the pool.</div>
        </div>
      </div>
      <div id="k-out"></div>`)}`;

  const $k = (id) => document.getElementById(id);
  const toLog = (m) => Math.log10(m), fromLog = (x) => +(10 ** x).toPrecision(3);
  $k('k-amount').value = s.balance ?? 10_000_000;
  $k('k-rate').value = s.rate; $k('k-vbase').value = s.volBase;

  const scenario = () => {
    const tokens = +$k('k-amount').value || 0;
    const volBase = s.volBase === 'avg' ? volAvg : vol24;
    const cases = [
      { name: 'Now', mm: 1, vm: 1 },
      { name: 'Scenario', mm: s.mcapMult, vm: s.volMult },
    ].map((c) => {
      const mcap = mcapNow * c.mm, price = mcap / supply, vol = volBase * c.vm;
      const share = tokens / eligible, pool = vol * (s.rate / 100), daily = pool * share, pos = tokens * price;
      const apr = pos > 0 ? (daily * 365) / pos : 0;
      return { ...c, mcap, price, vol, share, pool, daily, pos, apr,
        brokerDay: (daily * buyShare) / price, edelDay: (daily * (1 - buyShare)) / D.edelUsd };
    });
    const [a, b] = cases;
    const row = (l, f, cls = '') => `<tr><td class="l">${l}</td><td>${f(a)}</td><td class="${cls}"><b>${f(b)}</b></td></tr>`;
    $k('k-mm-v').textContent = s.mcapMult + '×'; $k('k-vm-v').textContent = s.volMult + '×';
    $k('k-out').innerHTML = `
      <div class="grid two">
        ${win('NOW_vs_SCENARIO.TABLE', `<div class="tablewrap"><table><thead><tr><th class="l"></th><th>Now</th><th>Scenario (${s.mcapMult}× cap, ${s.volMult}× volume)</th></tr></thead><tbody>
          ${row('Market cap', (c) => usd(c.mcap))}
          ${row('Price per BROKER', (c) => '$' + c.price.toPrecision(3))}
          ${row('Your position value', (c) => usd(c.pos))}
          ${row('Daily volume', (c) => usd(c.vol))}
          ${row('Holder reward pool / day', (c) => usd(c.pool))}
          ${row('Your share of eligible supply', (c) => (c.share * 100).toFixed(c.share < 0.01 ? 4 : 2) + '%')}
          ${row('Your reward / day', (c) => usd(c.daily), 'pos')}
          ${row('Per week', (c) => usd(c.daily * 7))}
          ${row('Per month', (c) => usd(c.daily * 30))}
          ${row('Per year', (c) => usd(c.daily * 365), 'pos')}
          ${row('APR (reward ÷ position value)', (c) => nf(c.apr * 100, 1) + '%', 'pos')}
          ${row('APY if rewards were re-invested daily (theoretical)', (c) => c.apr > 20 ? 'not meaningful' : nf(apy(c.apr) * 100, 1) + '%')}
          ${row('Paid in kind / day', (c) => `${compact(c.brokerDay)} BROKER + ${compact(c.edelDay)} EDEL`)}
        </tbody></table></div>
        <div class="small muted" style="margin-top:8px">With a fixed token count, a higher market cap raises your position value but <b>not</b> your reward (reward = volume × rate × your share). So APR scales as <b>volume ÷ market cap</b>: ${s.volMult}× volume with ${s.mcapMult}× cap changes APR by ${(s.volMult / s.mcapMult).toFixed(2)}×.</div>`)}
        ${win('SENSITIVITY.TABLE <span class="muted">(your reward / day · APR)</span>', (() => {
          const vms = [0.25, 0.5, 1, 2, 5, 10], mms = [0.5, 1, 2, 5, 10, 25];
          const cell = (vm, mm) => { const daily = volBase * vm * (s.rate / 100) * (tokens / eligible), pos = tokens * (mcapNow * mm / supply); return `<td>${usd(daily)} · ${nf(pos > 0 ? daily * 365 / pos * 100 : 0, 0)}%</td>`; };
          return `<div class="tablewrap"><table><thead><tr><th class="l">Volume ↓ / Cap →</th>${mms.map((m) => `<th>${m}×</th>`).join('')}</tr></thead><tbody>
            ${vms.map((vm) => `<tr><td class="l">${vm}× (${'$' + compact(volBase * vm)})</td>${mms.map((mm) => cell(vm, mm)).join('')}</tr>`).join('')}</tbody></table></div>`;
        })())}
      </div>`;
    $k('k-mm-r').value = toLog(s.mcapMult); $k('k-vm-r').value = toLog(s.volMult);
  };

  // ----- wallet lookup -----
  const lookup = async () => {
    const a = $k('k-addr').value.trim();
    const out = $k('k-wallet'), st = $k('k-status');
    if (!ADDR_RE.test(a)) { st.textContent = 'Not a valid 0x address.'; return; }
    s.addr = a; try { localStorage.setItem('bca-addr', a); } catch { /* ignore */ }
    st.textContent = 'reading balance…';
    const al = a.toLowerCase();
    const rec = R?.holders.find((h) => h.address === al);
    const w = D.wallets.find((x) => x.address === al);
    const bal = await rpcBalance(a);
    st.textContent = bal == null ? 'Could not read the balance from public RPCs — enter it manually below.' : '';
    s.balance = bal ?? s.balance;
    if (bal != null) $k('k-amount').value = bal;
    const pos = (s.balance ?? 0) * priceNow;
    if (!rec) {
      out.innerHTML = note(`No holder-reward payouts found for <code>${short(a)}</code> in the indexed data (through block ${R?.lastBlock ?? '–'}). ${bal != null ? `It holds ${compact(bal)} BROKER now. ` : ''}It may have bought after the last index run, hold through a contract, or be excluded.`) +
        (s.balance ? `<div class="grid kpis">${kpi('BROKER balance now', compact(s.balance) + ` <span class="muted small">${usd(pos)}</span>`)}</div>` : '');
      scenario(); return;
    }
    const earnedUsd = rec.valueEdel * D.edelUsd;
    const startTs = rec.firstTs, days = Math.max(1, (tEnd - startTs) / 86400);
    const realizedApr = pos > 0 ? (earnedUsd / pos) * (365 / days) : null;
    const share = (s.balance ?? 0) / eligible;
    const fwd = (v) => v * (s.rate / 100) * share;
    const fwd24 = fwd(vol24), fwdAvg = fwd(volAvg);
    out.innerHTML = `
      <div class="grid kpis">
        ${kpi('Rewards received (BROKER)', compact(rec.broker) + ' BROKER')}
        ${kpi('Rewards received (EDEL)', compact(rec.edel) + ' EDEL')}
        ${kpi('Total value at receipt', usd(earnedUsd) + ` <span class="muted small">${compact(rec.valueEdel)} EDEL</span>`)}
        ${kpi('Payout transfers', `${nf(rec.claims, 0)} <span class="muted small">${dt(rec.firstTs).slice(0, 10)} → ${dt(rec.lastTs).slice(0, 10)}</span>`)}
        ${kpi('BROKER balance now', s.balance == null ? '–' : compact(s.balance) + ` <span class="muted small">${usd(pos)}</span>`)}
        ${kpi('Realized APR on current balance', realizedApr == null ? '–' : nf(realizedApr * 100, 0) + '%' + ` <span class="muted small">over ${days.toFixed(1)} days</span>`)}
        ${kpi('Forward: reward / day (24h volume)', usd(fwd24))}
        ${kpi('Forward: yearly at today’s conditions', `${usd(fwd24 * 365)} <span class="muted small">≈ ${pos > 0 ? nf(fwd24 * 365 / pos * 100, 0) + '% APR' : '–'}</span>`)}
      </div>
      <div class="grid two">
        ${win('CUMULATIVE_REWARDS.CHART <span class="muted">(USD at receipt)</span>', '<div class="chartbox" style="height:220px"><canvas id="c-mine"></canvas></div>')}
        ${win('YIELD_NOTES.TXT', `<table><tbody>
          <tr><td class="l">Realized: rewards ÷ current position × 365 ÷ ${days.toFixed(1)}d</td><td>${realizedApr == null ? '–' : nf(realizedApr * 100, 0) + '% APR'}</td></tr>
          <tr><td class="l">Forward, 24h volume ${'$' + compact(vol24)}</td><td>${usd(fwd24 * 365)} / yr · ${pos > 0 ? nf(fwd24 * 365 / pos * 100, 0) : '–'}% APR</td></tr>
          <tr><td class="l">Forward, period-average volume ${'$' + compact(volAvg)}</td><td>${usd(fwdAvg * 365)} / yr · ${pos > 0 ? nf(fwdAvg * 365 / pos * 100, 0) : '–'}% APR</td></tr>
          <tr><td class="l">APY if re-invested daily (theoretical)</td><td>${pos > 0 && fwd24 * 365 / pos < 20 ? nf(apy(fwd24 * 365 / pos) * 100, 0) + '%' : 'not meaningful at this APR'}</td></tr>
          ${w ? `<tr><td class="l">Your trading PnL in this pool</td><td>${sgn(w.total)}</td></tr>` : ''}
        </tbody></table>
        ${note('“Realized APR” divides what you earned by your <i>current</i> position, so it is only meaningful if your balance was roughly constant. “Forward” assumes today’s volume and price hold for a year. Neither includes price changes of BROKER itself, which usually dominate.')}`)}
      </div>`;
    let cum = 0;
    const pts = rec.ev.map(([ts, tok, amt]) => { cum += (tok ? amt : amt * priceAtTs(ts)) * D.edelUsd; return { x: ts, y: +cum.toFixed(4) }; });
    draw('c-mine', { type: 'line', data: { datasets: [{ data: pts, borderColor: '#000', backgroundColor: css('acid'), pointRadius: 0, borderWidth: 2, stepped: true, fill: true }] },
      options: { plugins: { legend: { display: false } }, scales: { x: timeAxis } } });
    scenario();
  };

  // ----- wiring -----
  $k('k-look').addEventListener('click', lookup);
  $k('k-addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
  $k('k-amount').addEventListener('input', (e) => { s.balance = +e.target.value || 0; scenario(); });
  $k('k-rate').addEventListener('input', (e) => { s.rate = +e.target.value || 0; scenario(); });
  $k('k-vbase').addEventListener('change', (e) => { s.volBase = e.target.value; renderCalc(); });
  $k('k-mm-r').addEventListener('input', (e) => { s.mcapMult = fromLog(+e.target.value); scenario(); });
  $k('k-vm-r').addEventListener('input', (e) => { s.volMult = fromLog(+e.target.value); scenario(); });
  document.querySelectorAll('#calc .chips').forEach((box) => box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; s[box.dataset.for] = +b.dataset.v; scenario();
  }));
  scenario();
  if (s.addr && ADDR_RE.test(s.addr)) lookup();
}

// ---------- LP ----------
function renderLp() {
  const L = D.liq;
  const byPos = {};
  for (const l of L) {
    const k = `${l.sender}|${l.salt}|${l.tickLower}|${l.tickUpper}`;
    (byPos[k] ??= { sender: l.sender, salt: l.salt, lo: l.tickLower, hi: l.tickUpper, net: 0n, n: 0, last: 0 });
    byPos[k].net += BigInt(l.delta); byPos[k].n++; byPos[k].last = l.ts;
  }
  const pos = Object.values(byPos);
  const zero = '0x' + '0'.repeat(64);
  $('#lp').innerHTML = `
    <div class="grid kpis">
      ${kpi('ModifyLiquidity events', L.length)}
      ${kpi('Positions with liquidity', pos.filter((p) => p.net > 0n).length)}
      ${kpi('Adds / removes', `${L.filter((l) => BigInt(l.delta) > 0n).length} / ${L.filter((l) => BigInt(l.delta) < 0n).length}`)}
      ${kpi('TVL (DexScreener)', D.dex?.liquidityUsd ? '$' + compact(D.dex.liquidityUsd) : '–')}
    </div>
    ${win('LP_POSITIONS.LOG', `<div class="tablewrap"><table><thead><tr><th class="l">Sender</th><th class="l">Salt / tokenId</th><th>Tick range</th><th>Net liquidity</th><th>Events</th><th>Last</th></tr></thead><tbody>
    ${pos.sort((a, b) => (b.net > a.net ? 1 : -1)).map((p) => `<tr><td class="l">${addr(p.sender)}${p.sender === D.pool.hookAddress.toLowerCase() ? ' <span class="tag">hook</span>' : ''}</td><td class="l">${p.salt === zero ? '0' : BigInt(p.salt).toString()}</td><td>${p.lo} … ${p.hi}</td><td>${p.net.toLocaleString('en-US')}</td><td>${p.n}</td><td>${dt(p.last)}</td></tr>`).join('')}
    </tbody></table></div>
    ${note(`<b>sender</b> is usually the Uniswap PositionManager and <b>salt</b> is the position NFT’s tokenId — read the owner with <code>ownerOf(tokenId)</code> on the PositionManager. The hook (<code>${short(D.pool.hookAddress)}</code>) adds its own one-sided positions with salt 0.`)}`)}`;
}

// ---------- risks ----------
function renderRisk() {
  const T = D.token, c = D.hook?.cfg;
  const pmShare = T.totalSupply ? (T.poolManagerBalance ?? 0) / T.totalSupply : null;
  const maxShare = T.maxWalletBps ? T.maxWalletBps / 10000 : null;
  const live = [];
  live.push([T.poolManagerExempt === true ? 'low' : T.poolManagerExempt === false ? 'high' : 'med', 'PoolManager max-wallet exemption',
    T.poolManagerExempt === true ? 'PoolManager is exempt, so LP deposits and swaps are not blocked by the max-wallet rule.' : T.poolManagerExempt === false ? 'PoolManager is NOT exempt from max wallet — large deposits/swaps could revert.' : 'Could not be read.']);
  if (pmShare != null) live.push([pmShare > (maxShare ?? 1) ? 'med' : 'low', 'Token concentration in PoolManager', `The PoolManager holds ${pct(pmShare)} of supply (max wallet ${maxShare ? pct(maxShare) : '–'}); it also holds other pools’ tokens.`]);
  if (c) live.push([Math.max(c.buyTaxBps, c.sellTaxBps) > 2000 ? 'high' : 'low', 'Tax rates', `Buy ${c.buyTaxBps / 100}% · Sell ${c.sellTaxBps / 100}%. Fixed at configuration time (configurePool can only be called once).`]);
  const top = [...D.wallets].sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0)).slice(0, 10);
  const topShare = T.totalSupply ? top.reduce((a, w) => a + (w.balance ?? 0), 0) / T.totalSupply : null;
  if (topShare != null) live.push([topShare > 0.25 ? 'med' : 'low', 'Concentration among traders', `The 10 largest trading wallets hold ${pct(topShare)} of supply.`]);

  const st = [
    ['med', 'Sandwich / MEV on the buyback-and-burn', '`_buybackAndBurn` swaps inside afterSwap with no price limit. An attacker can push the price before a large sell so the hook buys back at a worse price. The loss is bounded by the burn share of the tax, but it is a direct leak.'],
    ['med', 'Flash loans and the reward tracker', 'If the tracker distributes by balance at transfer time, a borrowed balance could claim rewards. The 2.5% max wallet limits this, but the tracker source needs to be reviewed.'],
    ['med', 'Tax avoidance via other venues', 'Tax applies only to swaps in this pool. Empty V2 pairs and other pools (e.g. BROKER/USDC with a different hook) do not apply it, so routing through them avoids tax. The launcher is also fully exempt and sniperExempt addresses skip the sniper decay.'],
    ['med', 'Burns could silently fail', '`_payOut(BURN)` uses take with try/catch. If a BROKER transfer to dEaD reverts (e.g. max wallet), the amount becomes an ERC-6909 claim instead of being burned. dEaD is currently exempt and holds well under 2.5%, but this must be watched as it grows.'],
    ['med', 'Reward payouts run inside every BROKER transfer', 'BROKER’s `_update` calls `tracker.ping` with up to 5M gas after each transfer and ignores failure. Swaps therefore carry the payout gas (sampled swaps averaged ~1.6M gas), and if `ping` reverts or runs out of gas the transfer still succeeds while the tracker silently misses that update. The tracker is unverified, so its accounting cannot be reviewed. Payouts to a holder near the 2.5% max wallet would also revert on the token side.'],
    ['low', 'JIT liquidity', 'Standard v4 vector: add LP before a swap, remove after. Profit is limited to the LP fee because tax does not go to LPs.'],
    ['low', 'Spot-price manipulation with flash loans', 'The PoolManager’s flash accounting allows moving the price inside one transaction. It only matters if another contract (lending, oracle, tracker) reads the pool’s spot price or slot0. The hook itself reads slot0 only to place its own ranges.'],
    ['low', 'Centralization', 'platformAdmin can change payees and sniperExempt; the launcher finalizes the launch. Nobody can raise the tax or pull other LPs’ liquidity via this hook (no liquidity hooks, donate disabled).'],
    ['low', 'Reentrancy in payouts', 'take has a 500k gas cap and try/catch (PayoutDeferred), so a failing payee cannot block swaps. Plain ERC-20s have no callbacks.'],
    ['low', 'Compiler note (0.8.28)', 'TransientStorageClearingHelperCollision only affects IR compilation that uses transient storage. Check whether the token uses transient storage.'],
  ];
  const cls = (r) => `<div class="risk ${r[0]}"><b>${r[1]}</b><div class="small">${r[2].replace(/`([^`]+)`/g, '<code>$1</code>')}</div></div>`;
  $('#risk').innerHTML = `
    ${win('LIVE_CHECKS.SYS', live.map(cls).join(''))}
    <div style="height:18px"></div>
    ${win('KNOWN_VECTORS.TXT <span class="muted">(code review of the hook — not an audit)</span>', st.map(cls).join(''))}`;
}

// ---------- wiring ----------
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach((s) => (s.hidden = s.id !== b.dataset.tab));
});
document.querySelectorAll('input[name=unit]').forEach((r) => r.addEventListener('change', () => { unit = r.value; if (D) renderAll(); }));
load().catch((e) => {
  $('#loading').innerHTML = `Error: ${e.message}. Run <code>npm run index</code>, then <code>npm start</code>.`;
  $('#asof').textContent = 'NO DATA';
});
