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
const renderAll = () => { renderOverview(); renderWallets(); renderTrades(); renderHook(); renderRewards(); renderCalc(); renderLp(); renderRisk(); };

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

// ---------- trades ----------
function renderTrades() {
  $('#trades').innerHTML = win('TRADES.LOG', `
    <div class="toolbar"><input type="search" id="tq" placeholder="Filter by address…"><select id="ts"><option value="">All sides</option><option value="buy">Buys</option><option value="sell">Sells</option></select>
    <select id="tmin"><option value="0">Any size</option><option value="1000">≥ 1k EDEL</option><option value="10000">≥ 10k EDEL</option><option value="100000">≥ 100k EDEL</option></select>
    <span class="muted small">latest 600 matches</span></div>
    <div class="tablewrap"><table><thead><tr><th class="l">Time (UTC)</th><th>Side</th><th class="l">Wallet</th><th>BROKER</th><th>EDEL</th><th>Price</th><th>Note</th><th></th></tr></thead><tbody></tbody></table></div>`);
  const fill = () => {
    const q = $('#tq').value.trim().toLowerCase(), s = $('#ts').value, m = +$('#tmin').value;
    const rows = D.trades.filter((t) => (!q || t.trader.includes(q)) && (!s || t.side === s) && t.edel >= m).slice(-600).reverse();
    $('#trades tbody').innerHTML = rows.map((t) => `<tr><td class="l">${dt(t.ts)}</td><td><span class="tag ${t.side}">${t.side}</span></td><td class="l">${addr(t.trader)}</td><td>${compact(t.broker)}</td><td>${compact(t.edel)}</td><td>${price(t.price)}</td><td class="muted small">${t.viaRouter ? 'via router ' : ''}${t.multi ? 'multi-swap' : ''}</td><td>${txl(t.tx)}</td></tr>`).join('');
  };
  ['tq', 'ts', 'tmin'].forEach((i) => ($('#' + i).oninput = fill));
  fill();
}

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
// Inputs are editable; defaults come from the indexed data. All numbers are estimates.
const calcState = {};
function renderCalc() {
  if (!D.edelUsd) { $('#calc').innerHTML = note('EDEL/USD rate unavailable, so the calculator (which works in USD) cannot run. Re-run the indexer.'); return; }
  const supply = D.token.totalSupply || 1e9;
  const priceUsdNow = D.markPrice * D.edelUsd;
  const mcapNow = priceUsdNow * supply;
  const T = D.trades, tEnd = T[T.length - 1].ts;
  const dayVol = (from, to) => T.filter((t) => t.ts > from && t.ts <= to).reduce((a, t) => a + t.edel, 0) * D.edelUsd;
  const vol24 = dayVol(tEnd - 86400, tEnd), volAvg = T.reduce((a, t) => a + t.edel, 0) * D.edelUsd / Math.max(1, (tEnd - T[0].ts) / 86400);
  const buyShareNow = T.filter((t) => t.side === 'buy').reduce((a, t) => a + t.edel, 0) / (T.reduce((a, t) => a + t.edel, 0) || 1);
  const ex = R?.excluded;
  const excludedNow = ex ? ex.poolManager + ex.dead + ex.tracker : (D.token.poolManagerBalance || 0);
  // observed: value deposited into the tracker / traded volume (see README); theory is 1.70%
  const defaults = { mode: 'tokens', amount: 10_000_000, mcap: Math.round(mcapNow), vol: Math.round(vol24), rate: 1.8, buyShare: Math.round(buyShareNow * 100), excluded: Math.round(excludedNow) };
  const kept = calcState.touched ? { ...calcState } : {}; // keep the user's edits across tab re-renders (e.g. EDEL/USD toggle)
  Object.assign(calcState, defaults, kept);
  const s = calcState;

  $('#calc').innerHTML = `
    <div class="grid two">
      ${win('YOUR_POSITION.EXE', `
        <div class="grid" style="gap:12px">
          <label>I enter my holding as
            <select id="k-mode"><option value="tokens">BROKER tokens</option><option value="usd">USD value</option></select></label>
          <label><span id="k-amount-l">BROKER held</span><br><input type="number" id="k-amount" min="0" step="any" value="${s.amount}" style="width:100%"></label>
          <label>Market cap (USD, FDV of ${compact(supply)} BROKER) — now ${'$' + compact(mcapNow)}<br>
            <input type="range" id="k-mcap-r" min="4" max="9" step="0.01" style="width:100%"><input type="number" id="k-mcap" min="1" step="any" value="${s.mcap}" style="width:100%"></label>
          <label>Daily trading volume (USD) — last 24h ${'$' + compact(vol24)}, period average ${'$' + compact(volAvg)}<br>
            <input type="range" id="k-vol-r" min="3" max="8" step="0.01" style="width:100%"><input type="number" id="k-vol" min="0" step="any" value="${s.vol}" style="width:100%"></label>
        </div>`)}
      ${win('ASSUMPTIONS.SYS', `
        <div class="grid" style="gap:12px">
          <label>Holder reward rate (% of volume) — observed ~1.8%, theory 1.70%<br><input type="number" id="k-rate" min="0" step="0.01" value="${s.rate}" style="width:100%"></label>
          <label>Share of volume that is buys (%) — buys pay the reward in BROKER, sells in EDEL<br><input type="number" id="k-buy" min="0" max="100" step="1" value="${s.buyShare}" style="width:100%"></label>
          <label>Supply that earns nothing (BROKER) — PoolManager + dead + tracker now<br><input type="number" id="k-excl" min="0" step="any" value="${s.excluded}" style="width:100%"></label>
          <button class="pill" id="k-reset" type="button">reset to live values</button>
        </div>
        ${note('Model: your expected reward = volume × rate × your share of the <i>eligible</i> supply. Real payouts are queue-based and lumpy, depend on <i>when</i> you held, and change with volume, price and who else holds. Not financial advice.')}`)}
    </div>
    <div style="height:18px"></div>
    <div id="k-out"></div>`;

  const $k = (id) => document.getElementById(id);
  $k('k-mode').value = s.mode;
  const logToVal = (x) => 10 ** x, valToLog = (v) => Math.log10(Math.max(1, v));
  $k('k-mcap-r').value = valToLog(s.mcap); $k('k-vol-r').value = valToLog(s.vol);

  const calc = () => {
    const price = s.mcap / supply;
    const tokens = s.mode === 'tokens' ? s.amount : s.amount / price;
    const holdUsd = tokens * price;
    const eligible = Math.max(1, supply - s.excluded);
    const share = tokens / eligible;
    const pool = s.vol * (s.rate / 100);
    const daily = pool * share;
    const apr = holdUsd > 0 ? (daily * 365) / holdUsd : 0;
    const brokerDaily = (daily * (s.buyShare / 100)) / price;
    const edelDaily = (daily * (1 - s.buyShare / 100)) / D.edelUsd;
    const usd = (v) => '$' + (Math.abs(v) >= 100 ? nf(v, 0) : nf(v, 2));
    const cell = (v, daysN) => `<td>${usd(v * daysN)}</td>`;
    const volMult = [0.25, 0.5, 1, 2, 5], capMult = [0.5, 1, 2, 5, 10];
    const gridDaily = volMult.map((vm) => `<tr><td class="l">${'$' + compact(s.vol * vm)} / day</td>${capMult.map((cm) => {
      const p = (s.mcap * cm) / supply, tk = s.mode === 'tokens' ? s.amount : s.amount / (s.mcap / supply); // USD mode: same token count, price moves
      return `<td>${usd(s.vol * vm * (s.rate / 100) * (tk / eligible))}</td>`;
    }).join('')}</tr>`).join('');
    const gridApr = volMult.map((vm) => `<tr><td class="l">${'$' + compact(s.vol * vm)} / day</td>${capMult.map((cm) =>
      `<td>${nf((s.vol * vm * (s.rate / 100) * 365) / ((s.mcap * cm / supply) * eligible) * 100, 1)}%</td>`).join('')}</tr>`).join('');
    $k('k-out').innerHTML = `
      <div class="grid kpis">
        ${kpi('Position value', usd(holdUsd) + ` <span class="muted small">${compact(tokens)} BROKER @ $${(price).toPrecision(3)}</span>`)}
        ${kpi('Your share of eligible supply', (share * 100).toFixed(share < 0.01 ? 4 : 2) + '%')}
        ${kpi('Total holder reward pool / day', usd(pool))}
        ${kpi('Your expected reward / day', usd(daily))}
        ${kpi('Per week / month / year', `${usd(daily * 7)} / ${usd(daily * 30)} / ${usd(daily * 365)}`)}
        ${kpi('Yield (APR on position value)', nf(apr * 100, 1) + '%')}
        ${kpi('Paid in kind, per day', `${compact(brokerDaily)} BROKER + ${compact(edelDaily)} EDEL`)}
        ${kpi('Days of rewards to offset a 5% price drop', daily > 0 ? nf((holdUsd * 0.05) / daily, 1) + ' days' : '–')}
      </div>
      <div class="grid two">
        ${win('DAILY_REWARD.TABLE <span class="muted">(USD, rows: volume · cols: market cap ×)</span>', `<div class="tablewrap"><table><thead><tr><th class="l">Volume</th>${capMult.map((m) => `<th>${m}× cap</th>`).join('')}</tr></thead><tbody>${gridDaily}</tbody></table></div>
          <div class="small muted" style="margin-top:6px">${s.mode === 'tokens' ? 'You hold a fixed token count, so market cap changes your position value, not your reward.' : 'You fixed a USD amount at the current market cap; a higher cap on the same tokens changes the value only.'}</div>`)}
        ${win('APR.TABLE <span class="muted">(% per year, same axes)</span>', `<div class="tablewrap"><table><thead><tr><th class="l">Volume</th>${capMult.map((m) => `<th>${m}× cap</th>`).join('')}</tr></thead><tbody>${gridApr}</tbody></table></div>
          <div class="small muted" style="margin-top:6px">APR = rate × volume × 365 ÷ eligible market cap — the same for any holding size.</div>`)}
      </div>`;
  };
  const bind = (id, key, fn = Number) => $k(id).addEventListener('input', (e) => { s[key] = fn(e.target.value) || 0; s.touched = true; sync(); calc(); });
  const sync = () => { $k('k-mcap-r').value = valToLog(s.mcap); $k('k-vol-r').value = valToLog(s.vol); };
  bind('k-amount', 'amount'); bind('k-mcap', 'mcap'); bind('k-vol', 'vol'); bind('k-rate', 'rate'); bind('k-buy', 'buyShare'); bind('k-excl', 'excluded');
  $k('k-mcap-r').addEventListener('input', (e) => { s.mcap = Math.round(logToVal(+e.target.value)); $k('k-mcap').value = s.mcap; s.touched = true; calc(); });
  $k('k-vol-r').addEventListener('input', (e) => { s.vol = Math.round(logToVal(+e.target.value)); $k('k-vol').value = s.vol; s.touched = true; calc(); });
  $k('k-mode').addEventListener('change', (e) => {
    s.mode = e.target.value; s.touched = true;
    $k('k-amount-l').textContent = s.mode === 'tokens' ? 'BROKER held' : 'USD value held';
    if (s.mode === 'usd') s.amount = Math.round(s.amount * (s.mcap / supply)); else s.amount = Math.round(s.amount / (s.mcap / supply));
    $k('k-amount').value = s.amount; calc();
  });
  $k('k-reset').addEventListener('click', () => { calcState.touched = false; Object.assign(calcState, defaults); renderCalc(); });
  $k('k-amount-l').textContent = s.mode === 'tokens' ? 'BROKER held' : 'USD value held';
  calc();
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
