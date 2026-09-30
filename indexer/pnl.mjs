// Per-wallet trading PnL, average-cost method, denominated in EDEL (the pool's quote token).
// Only flows through the BROKER/EDEL pool are counted. Tokens that arrive by other routes
// (transfers, airdrops, other pools) have unknown cost: when such tokens are sold they are
// booked at zero cost and reported in `untrackedSold` so the number can be discounted.

export function computePnl(trades, markPrice) {
  const wallets = new Map();
  const get = (a) => {
    let w = wallets.get(a);
    if (!w) {
      w = {
        address: a, buys: 0, sells: 0, boughtBroker: 0, soldBroker: 0, spentEdel: 0, receivedEdel: 0,
        position: 0, costBasis: 0, realized: 0, untrackedSold: 0, wins: 0, losses: 0,
        firstTs: null, lastTs: null, viaRouter: 0, series: [],
      };
      wallets.set(a, w);
    }
    return w;
  };

  for (const t of trades) {
    const w = get(t.trader);
    w.firstTs ??= t.ts;
    w.lastTs = t.ts;
    if (t.viaRouter) w.viaRouter++;

    if (t.side === 'buy') {
      w.buys++;
      w.boughtBroker += t.broker;
      w.spentEdel += t.edel;
      w.position += t.broker;
      w.costBasis += t.edel;
    } else {
      w.sells++;
      w.soldBroker += t.broker;
      w.receivedEdel += t.edel;
      const tracked = Math.min(t.broker, w.position);
      const untracked = t.broker - tracked;
      const avg = w.position > 0 ? w.costBasis / w.position : 0;
      const proceedsTracked = t.broker > 0 ? t.edel * (tracked / t.broker) : 0;
      const cost = avg * tracked;
      const pnl = t.edel - cost; // untracked portion has zero cost
      w.realized += pnl;
      w.untrackedSold += untracked;
      if (tracked > 0) {
        if (proceedsTracked - cost >= 0) w.wins++;
        else w.losses++;
      }
      w.position -= tracked;
      w.costBasis -= cost;
      if (w.position < 1e-9) { w.position = 0; w.costBasis = 0; }
    }
    const unreal = w.position * markPrice - w.costBasis;
    w.series.push([t.ts, w.realized, unreal]);
  }

  const out = [];
  for (const w of wallets.values()) {
    const unrealized = w.position * markPrice - w.costBasis;
    out.push({
      address: w.address,
      buys: w.buys, sells: w.sells, trades: w.buys + w.sells,
      boughtBroker: w.boughtBroker, soldBroker: w.soldBroker,
      spentEdel: w.spentEdel, receivedEdel: w.receivedEdel,
      position: w.position,
      avgCost: w.position > 0 ? w.costBasis / w.position : 0,
      realized: w.realized, unrealized, total: w.realized + unrealized,
      roi: w.spentEdel > 0 ? (w.realized + unrealized) / w.spentEdel : null,
      winRate: w.wins + w.losses > 0 ? w.wins / (w.wins + w.losses) : null,
      untrackedSold: w.untrackedSold,
      firstTs: w.firstTs, lastTs: w.lastTs,
      viaRouter: w.viaRouter,
      series: w.series.length > 400 ? downsample(w.series, 400) : w.series,
    });
  }
  return out;
}

function downsample(arr, n) {
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}
