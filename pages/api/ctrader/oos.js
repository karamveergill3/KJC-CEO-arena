// pages/api/ctrader/oos.js
// Fetches closed deals from cTrader for the last 3 months and computes OOS stats
export default async function handler(req, res) {
  const { token, accountId, months = 3 } = req.query;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    // 1. Get accounts list if no accountId provided
    let accId = accountId;
    if (!accId) {
      const accRes = await fetch("https://api.spotware.com/connect/tradingaccounts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!accRes.ok) return res.status(accRes.status).json({ error: "Failed to fetch accounts" });
      const accData = await accRes.json();
      const accounts = accData.data || accData;
      if (!accounts?.length) return res.status(404).json({ error: "No accounts found" });
      accId = accounts[0].accountId || accounts[0].ctidTraderAccountId;
    }

    // 2. Fetch closed deals for last N months
    const toDate = Date.now();
    const fromDate = toDate - (months * 30 * 24 * 60 * 60 * 1000);

    const dealsRes = await fetch(
      `https://api.spotware.com/connect/tradingaccounts/${accId}/deals?from=${fromDate}&to=${toDate}&limit=1000`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!dealsRes.ok) return res.status(dealsRes.status).json({ error: "Failed to fetch deals" });
    const dealsData = await dealsRes.json();
    const deals = dealsData.data || dealsData.deal || dealsData || [];

    if (!deals.length) return res.status(200).json({ trades: 0, pf: 0, wr: 0, dd: 0, netProfit: 0, message: "No deals found in period" });

    // 3. Compute stats
    const closed = deals.filter(d => d.dealStatus === "FILLED" || d.closePositionDetail);
    const profits = closed.map(d => parseFloat(d.closePositionDetail?.grossProfit || d.profit || 0));
    const wins = profits.filter(p => p > 0);
    const losses = profits.filter(p => p < 0);
    const grossProfit = wins.reduce((s, p) => s + p, 0);
    const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
    const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 9.99 : 0;
    const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const netProfit = profits.reduce((s, p) => s + p, 0);

    // Drawdown: peak-to-trough on cumulative equity
    let peak = 0, trough = 0, maxDD = 0, cum = 0;
    profits.forEach(p => {
      cum += p;
      if (cum > peak) { peak = cum; trough = cum; }
      if (cum < trough) trough = cum;
      const dd = peak > 0 ? ((peak - trough) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    });

    res.status(200).json({
      trades: closed.length,
      wins: wins.length,
      losses: losses.length,
      pf: Math.round(pf * 100) / 100,
      wr: Math.round(wr * 10) / 10,
      dd: Math.round(maxDD * 10) / 10,
      netProfit: Math.round(netProfit * 100) / 100,
      accountId: accId,
      period: `Last ${months} months`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
