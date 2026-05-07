import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { supabase } from "../lib/supabase";

const DEFAULT_CODE = `using System;
using System.Linq;
using cAlgo.API;
using cAlgo.API.Indicators;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.EasternStandardTime, AccessRights = AccessRights.None)]
    public class SilverScalper_v8 : Robot
    {
        [Parameter("London Start Hour (ET)", DefaultValue = 3)]
        public int LondonStartHour { get; set; }
        [Parameter("London End Hour (ET)", DefaultValue = 6)]
        public int LondonEndHour { get; set; }
        [Parameter("NY Start Hour (ET)", DefaultValue = 8)]
        public int NYStartHour { get; set; }
        [Parameter("NY Start Minute (ET)", DefaultValue = 30)]
        public int NYStartMinute { get; set; }
        [Parameter("NY End Hour (ET)", DefaultValue = 11)]
        public int NYEndHour { get; set; }
        [Parameter("EMA Period", DefaultValue = 9)]
        public int EmaPeriod { get; set; }
        [Parameter("Fib POI Min Level (%)", DefaultValue = 44.0)]
        public double FibPOIMinLevel { get; set; }
        [Parameter("Fib POI Max Level (%)", DefaultValue = 62.0)]
        public double FibPOIMaxLevel { get; set; }
        [Parameter("Session Lookback (x5m bars)", DefaultValue = 96)]
        public int SessionLookback { get; set; }
        [Parameter("Sweep ATR Fraction", DefaultValue = 0.15)]
        public double SweepAtrFraction { get; set; }
        [Parameter("Sweep Pips Floor", DefaultValue = 2.0)]
        public double SweepPipsFloor { get; set; }
        [Parameter("Min Session Range Pips", DefaultValue = 15.0)]
        public double MinRangePips { get; set; }
        [Parameter("Min Fib Range Pips", DefaultValue = 10.0)]
        public double MinFibRangePips { get; set; }
        [Parameter("Min Bars To Lock Range", DefaultValue = 20)]
        public int MinBarsToLockRange { get; set; }
        [Parameter("ATR Period", DefaultValue = 14)]
        public int AtrPeriod { get; set; }
        [Parameter("ATR Trend Multiplier", DefaultValue = 1.5)]
        public double AtrTrendMultiplier { get; set; }
        [Parameter("Use ATR Regime Filter", DefaultValue = true)]
        public bool UseAtrFilter { get; set; }
        [Parameter("ATR SL Multiplier", DefaultValue = 1.5)]
        public double AtrSlMultiplier { get; set; }
        [Parameter("Min SL Pips (ATR floor)", DefaultValue = 5.0)]
        public double MinSlPips { get; set; }
        [Parameter("ATR TP Multiplier", DefaultValue = 3.0)]
        public double AtrTpMultiplier { get; set; }
        [Parameter("Min TP Pips (ATR floor)", DefaultValue = 10.0)]
        public double MinTpPips { get; set; }
        [Parameter("Risk % Per Trade", DefaultValue = 1.0)]
        public double RiskPercent { get; set; }
        [Parameter("Max Trades Per Session", DefaultValue = 1)]
        public int MaxTradesPerSession { get; set; }
        [Parameter("Max Daily Loss %", DefaultValue = 3.0)]
        public double MaxDailyLossPercent { get; set; }
        [Parameter("Use Breakeven", DefaultValue = true)]
        public bool UseBreakeven { get; set; }
        [Parameter("Breakeven ATR Multiplier", DefaultValue = 1.0)]
        public double BreakevenAtrMultiplier { get; set; }
        [Parameter("Breakeven Buffer Pips", DefaultValue = 0.5)]
        public double BreakevenBufferPips { get; set; }

        private ExponentialMovingAverage _ema9;
        private AverageTrueRange _atr;
        private Bars _bars5m;
        private Bars _bars1h;
        private double _sessionHigh = double.MinValue;
        private double _sessionLow = double.MaxValue;
        private bool _rangeLocked = false;
        private double _sessionAtr = 0;
        private bool _sweepDetected = false;
        private bool _sweepUp = false;
        private bool _inTrade = false;
        private bool _breakevenApplied = false;
        private int _tradesThisSession = 0;
        private double _fibRange = 0;
        private double _fibOrigin = 0;
        private double _fibTarget = 0;
        private double _dailyStartBalance = 0;
        private DateTime _lastDailyReset = DateTime.MinValue;
        private bool _dailyKillActive = false;

        protected override void OnBar()
        {
            var now = Server.Time;
            if (_lastDailyReset.Date != now.Date)
            {
                _dailyStartBalance = Account.Balance;
                _dailyKillActive = false;
                _lastDailyReset = now;
            }
            if (!_dailyKillActive)
            {
                double drawdown = (_dailyStartBalance - Account.Balance) / _dailyStartBalance * 100.0;
                if (drawdown >= MaxDailyLossPercent) _dailyKillActive = true;
            }
            if (_dailyKillActive) return;
            if (!IsInTradingWindow(now)) return;
            if (_tradesThisSession >= MaxTradesPerSession) return;
            if (_inTrade) { if (UseBreakeven) CheckBreakeven(); return; }
            if (!_rangeLocked) { BuildAndLockSessionRange(); return; }
            if (!_sweepDetected) { DetectLiquiditySweep(); return; }
            CheckEntrySignal();
        }

        private void BuildAndLockSessionRange()
        {
            int availableBars = Math.Min(_bars5m.Count - 1, SessionLookback);
            if (availableBars < MinBarsToLockRange) return;
            double high = double.MinValue, low = double.MaxValue;
            int start = Math.Max(0, _bars5m.Count - 1 - SessionLookback);
            for (int i = start; i < _bars5m.Count - 1; i++)
            {
                if (_bars5m.HighPrices[i] > high) high = _bars5m.HighPrices[i];
                if (_bars5m.LowPrices[i] < low) low = _bars5m.LowPrices[i];
            }
            _sessionHigh = high; _sessionLow = low; _rangeLocked = true;
            _sessionAtr = (_atr.Result.Count >= 2) ? _atr.Result.Last(1) : 0;
        }

        private void DetectLiquiditySweep()
        {
            double rangePips = (_sessionHigh - _sessionLow) / Symbol.PipSize;
            if (rangePips < MinRangePips) return;
            double lastHigh = _bars5m.HighPrices.Last(1);
            double lastLow = _bars5m.LowPrices.Last(1);
            double lastClose = _bars5m.ClosePrices.Last(1);
            double sessionAtrPips = _sessionAtr > 0 ? _sessionAtr / Symbol.PipSize : SweepPipsFloor;
            double sweepThreshPips = Math.Max(SweepPipsFloor, SweepAtrFraction * sessionAtrPips);
            double sweepDist = sweepThreshPips * Symbol.PipSize;
            bool sweptHigh = lastHigh > (_sessionHigh + sweepDist) && lastClose < _sessionHigh;
            bool sweptLow = lastLow < (_sessionLow - sweepDist) && lastClose > _sessionLow;
            if (sweptLow) { ComputeFibs(true); _sweepDetected = true; _sweepUp = false; }
            else if (sweptHigh) { ComputeFibs(false); _sweepDetected = true; _sweepUp = true; }
        }

        private void ComputeFibs(bool isBullish)
        {
            int totalBars = _bars5m.Count;
            int confirm = 2;
            int startIdx = Math.Max(0, totalBars - 1 - SessionLookback * 2);
            int endIdx = totalBars - 2;
            if (isBullish)
            {
                _fibOrigin = _bars5m.LowPrices.Last(1);
                double bestHigh = double.MinValue; bool found = false;
                for (int i = endIdx - confirm; i >= startIdx + confirm; i--)
                {
                    double h = _bars5m.HighPrices[i];
                    if (h < _fibOrigin + 10.0 * Symbol.PipSize) continue;
                    bool ok = true;
                    for (int j = 1; j <= confirm; j++)
                        if (_bars5m.HighPrices[i-j] >= h || _bars5m.HighPrices[i+j] >= h) { ok = false; break; }
                    if (ok) { bestHigh = h; found = true; break; }
                }
                _fibTarget = found ? bestHigh : Enumerable.Range(startIdx, endIdx - startIdx).Select(i => _bars5m.HighPrices[i]).Max();
                _fibRange = _fibTarget - _fibOrigin;
            }
            else
            {
                _fibOrigin = _bars5m.HighPrices.Last(1);
                double bestLow = double.MaxValue; bool found = false;
                for (int i = endIdx - confirm; i >= startIdx + confirm; i--)
                {
                    double l = _bars5m.LowPrices[i];
                    if (l > _fibOrigin - 10.0 * Symbol.PipSize) continue;
                    bool ok = true;
                    for (int j = 1; j <= confirm; j++)
                        if (_bars5m.LowPrices[i-j] <= l || _bars5m.LowPrices[i+j] <= l) { ok = false; break; }
                    if (ok) { bestLow = l; found = true; break; }
                }
                _fibTarget = found ? bestLow : Enumerable.Range(startIdx, endIdx - startIdx).Select(i => _bars5m.LowPrices[i]).Min();
                _fibRange = _fibOrigin - _fibTarget;
            }
        }

        private double GetFibPrice(double level) =>
            !_sweepUp ? _fibOrigin + (level / 100.0) * _fibRange : _fibOrigin - (level / 100.0) * _fibRange;

        private void CheckEntrySignal()
        {
            if (UseAtrFilter && !IsMarketActive()) return;
            if (_atr.Result.Count < 2) return;
            double currentAtr = _atr.Result.Last(1);
            double currentClose = _bars5m.ClosePrices.Last(1);
            double emaValue = _ema9.Result.Last(1);
            double poiLow = !_sweepUp ? GetFibPrice(FibPOIMinLevel) : GetFibPrice(FibPOIMaxLevel);
            double poiHigh = !_sweepUp ? GetFibPrice(FibPOIMaxLevel) : GetFibPrice(FibPOIMinLevel);
            if (currentClose < poiLow || currentClose > poiHigh) return;
            if (!_sweepUp && currentClose > emaValue) PlaceTrade(TradeType.Buy, currentAtr);
            else if (_sweepUp && currentClose < emaValue) PlaceTrade(TradeType.Sell, currentAtr);
        }

        private bool IsMarketActive()
        {
            if (_sessionAtr <= 0) return false;
            if (_atr.Result.Count < AtrPeriod * 2) return false;
            double avgAtr = 0;
            for (int i = 2; i <= AtrPeriod + 1; i++)
                if (i < _atr.Result.Count) avgAtr += _atr.Result.Last(i);
            avgAtr /= AtrPeriod;
            return _sessionAtr >= avgAtr * AtrTrendMultiplier;
        }

        private void PlaceTrade(TradeType direction, double currentAtr)
        {
            double atrPips = currentAtr / Symbol.PipSize;
            double slPips = Math.Max(MinSlPips, AtrSlMultiplier * atrPips);
            double tpPips = Math.Max(MinTpPips, AtrTpMultiplier * atrPips);
            var result = ExecuteMarketOrder(direction, SymbolName, CalculateVolume(slPips), "SilverScalper", slPips, tpPips);
            if (result.IsSuccessful) { _inTrade = true; _tradesThisSession++; }
        }

        private double CalculateVolume(double slPips)
        {
            double riskBase = Math.Min(Account.Balance, Account.Equity);
            double riskAmount = riskBase * (RiskPercent / 100.0);
            double slValue = slPips * Symbol.PipValue;
            double volumeUnits = slValue > 0 ? riskAmount / slValue : Symbol.VolumeInUnitsMin;
            return Symbol.NormalizeVolumeInUnits(Math.Max(Symbol.VolumeInUnitsMin, Math.Min(Symbol.VolumeInUnitsMax, volumeUnits)));
        }

        private void CheckBreakeven()
        {
            if (_breakevenApplied) return;
            var position = Positions.Find("SilverScalper", SymbolName);
            if (position == null) return;
            double atrPips = _atr.Result.Last(1) / Symbol.PipSize;
            double triggerPips = BreakevenAtrMultiplier * atrPips;
            if (position.Pips < triggerPips) return;
            double bufferPrice = BreakevenBufferPips * Symbol.PipSize;
            double newSlPrice = position.TradeType == TradeType.Buy
                ? position.EntryPrice + bufferPrice : position.EntryPrice - bufferPrice;
            var result = ModifyPosition(position, newSlPrice, position.TakeProfit);
            if (result.IsSuccessful) _breakevenApplied = true;
        }

        protected override void OnPositionClosed(Position position)
        {
            if (position.Label != "SilverScalper" || position.SymbolName != SymbolName) return;
            _inTrade = false; _breakevenApplied = false;
        }

        private bool IsInTradingWindow(DateTime t)
        {
            bool inLondon = t.Hour >= LondonStartHour && t.Hour < LondonEndHour;
            bool inNY = (t.Hour > NYStartHour || (t.Hour == NYStartHour && t.Minute >= NYStartMinute)) && t.Hour < NYEndHour;
            return inLondon || inNY;
        }
    }
}`;

const PHOTOS = {
  STARK: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCABQAFADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5eKVGwwambdjpUTg9a89M9ewzac1XmvJUV0hYqoGCw6k1ab5ULegzWTcudgXJA6n3ranG+5zVpcuiI0fDFskGo97E8sT6ZqS1t5Z32xKXqd9Lux/yxcj6VvdI5lGT1SLWlas9sVQySog/55sB+PPWul0u4a4i83du3d/X3rhpFZCVZSuODkVreFb9re9S1bmOZsZ9D2rnr0k4trc6cPXcZKMtjsbdf3vTrUOrj5wBTzIyzcdqrajIXcc156Wp68bGWynbULIabq1+IZPIt1DyH9Kl0XTtU1KKd4pbdGhjMmyRsFwOw967IwdrnBKouay1IplJgYYJzWfcR4iDOvOcCtrRgLq6tY5BtDzIrgjOPmAIrS1vw7ZpcWEulXVxNDc3bRmOaEI0ZU88jr3z6VcJqL5WZVKTmueOxJ4A0zzlkQxH5hnkV1EuiKgLseB0Ga6C50+e10vz7KOImNMt8yoBgdSTXL2Grz3+pTafcWD/AGmM8mJw2PY9Oa45SlNuSO+k400oXMjWNLgCONi88kY61x2j/YrHXpVvUYxx5MbA/cbscd67Txff21gWt3MktwrbHVV4Bx0J9a8/1Al7ySUqUJwSM5wcV1YZNp32Zx46UU1y7o7lR9ptDdWx82M/xDqPqKz3JZqwtIv762LfZ5ML3BHWtoytJCt1IEi3/wAPvU1aKjrE1weJbdpo5qwjZ7xt5AY85PSup8Ny2cjFW80SIQOBkfnWBIuyaPcMHOCK6jw5FdpfeXbC0jVyCd4y2K1qO5lho2lYfrWn/YLxJomUJctnB4x716B4elt9btU+1wRC7tJTIZF48xmUAuR2Jxzjvz3rH8Q2MV3qdrZkISE3FfT6Vf8ACcMVjqtyPMyFCIynscE/yIrmqPmR1KChJtHQywmMC4c/KowUYZVh6EVgam1gsj30cHlzMeFBJJwO3pwP0FdNfMrRMx5UDOK8w1XW9btrrzbMxWcwO4q8p3EZ/iBG38KwjBy0RcZq17XKN6fNnumuA3l+aW/r/Wsp9Ntbm4K4ZJCoc+hzSXmt3shnm1NUkUsC7QgLu56AYwDjNTnUrOVvOtpd0bDgHgr7EV2RjOKujnnKlOVn+JRurWO1U4HI4GO9VJGW6hMBlKPGPXrU9/djyQSeOtYskpub5TbRtubAA7k1tCLlqzmqTUNIkV5f3F1cedKRkHIA4ArufD3i3RtM08ypaSSX23GGGR9c154BmpjKwTYg2KeuOp+prZwi1Y5YV5wlzJnS+IvGuq6tfWN0nl2j2UbRxmIctuOSW9a9J+A2oWOtaVrWi6xM7X0t2t5HNn95koFJU+2Bx0wa8OHWtHQ9RuLC5ka2keOSWJow6MVZcjGQRVqK6ozc5b38z23xbNd6BfRtvS4MXAYcB0+h+6w/Ee9cJ418SPrEca20rxRxnJYYRjkcg1w8mqanJjzdQu5MdN8rNj8zUAW4mDFVkcH5m2r29eKw+rwvdG6xVRKzNSTVLZ9PubWaGQysg8qQNnDAg8/X1rJWUq29DtPtTSpB5GPrSCtkklYwlJyd2XmuopbWRWLLLjCrjg+vPaodOeWG8ikiOJFbK/Wq2O9OR2RgynBHSly2Wg+dt6iHpQKBRVEBmrOmxCe/hhLBPMbaCex7frVbvTo3aN1kQ4ZSGB9xQB2vhnwbFd6ozatI0FqD8iL1kb0J7D+dd74b07T9L0SP7Pb7vNyWOASM9s+lZmi3UF/psLsuYpVDD2PcVraNLE2mYDBQMgJnpjtWiRm2YfjjRtK/s+S5NpGkqKSHUYOccZryOvXfHdwP+EeuiDn5QK8iqZFRDtS0dqBUlH//2Q==",
  EDDIE: "data:image/jpeg;base64,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",
SENKU: "data:image/jpeg;base64,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",
};

function Avatar({ who, size = 30, color, active = false, approved = false }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
      border: `2px solid ${approved ? color : active ? color : "rgba(255,255,255,0.12)"}`,
      boxShadow: approved || active ? `0 0 10px ${color}88` : "none",
      transition: "all 0.35s",
    }}>
      <img src={PHOTOS[who]} alt={who} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
    </div>
  );
}

// ─── Character registry (all available characters) ──────────────────────────
const ALL_CHARS = {
  STARK: { name: "Tony Stark", color: "#ff3e3e", desc: "Genius, billionaire, playboy, philanthropist." },
  EDDIE: { name: "Eddie Morra", color: "#3ec1ff", desc: "NZT-enhanced limitless cognitive speed." },
  SENKU: { name: "Senku Ishigami", color: "#3eff7e", desc: "10 billion percent scientific mastery." }
};

const MESSAGES = [
  { sender: "STARK", text: "Alright team, the SilverScalper v8 is live. 9 EMA is our backbone. Let's cook." },
  { sender: "EDDIE", text: "Processing the 5m range data... liquidity sweep detected. The Fibonacci POI is lining up perfectly with the session low." },
  { sender: "SENKU", text: "This is exhilarating! 10 billion percent certainty on the entry signal. The science of the market never lies." },
];

// ─── Sidebar components ──────────────────────────────────────────────────────
function SidebarHeader({ onNew, onSignOut, profile, collapsed, setCollapsed }) {
  return (
    <div style={{ padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: "12px", justifyContent: collapsed ? "center" : "space-between" }}>
      {!collapsed && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "linear-gradient(135deg, #6366f1, #a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "18px" }}>A</div>
          <span style={{ fontWeight: "700", fontSize: "1.1rem", letterSpacing: "-0.5px" }}>ARENA</span>
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onNew} style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)", padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem", fontWeight: "600", display: collapsed ? "none" : "block" }}>New</button>
        <button onClick={() => setCollapsed(!collapsed)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "1.2rem", padding: "4px" }}>{collapsed ? "»" : "«"}</button>
      </div>
    </div>
  );
}

function SidebarSessionItem({ session, active, onClick, onDelete, collapsed }) {
  return (
    <div onClick={() => onClick(session)} style={{ padding: "12px 16px", cursor: "pointer", background: active ? "rgba(255,255,255,0.05)" : "transparent", display: "flex", alignItems: "center", gap: "12px", borderLeft: `3px solid ${active ? "#6366f1" : "transparent"}`, transition: "all 0.2s", justifyContent: collapsed ? "center" : "flex-start", position: "relative" }}>
      <div style={{ fontSize: "1.2rem" }}>{session.emoji || "📁"}</div>
      {!collapsed && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: "500", fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session.name}</div>
          <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)" }}>{new Date(session.updated_at).toLocaleDateString()}</div>
        </div>
      )}
      {!collapsed && active && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(session.id); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.2)", cursor: "pointer", padding: "4px", fontSize: "0.9rem" }}>×</button>
      )}
    </div>
  );
}

function Sidebar({ sessions, onLoad, onDelete, onNew, profile, onSignOut, currentSessionId, collapsed, setCollapsed }) {
  return (
    <div style={{ width: collapsed ? "70px" : "280px", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", background: "#0d0d12", transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)", zIndex: 100, position: "relative" }}>
      <SidebarHeader onNew={onNew} onSignOut={onSignOut} profile={profile} collapsed={collapsed} setCollapsed={setCollapsed} />
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {!collapsed && <div style={{ padding: "0 16px 8px", fontSize: "0.75rem", fontWeight: "600", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "1px" }}>Recent Simulations</div>}
        {sessions.map(s => (
          <SidebarSessionItem key={s.id} session={s} active={s.id === currentSessionId} onClick={onLoad} onDelete={onDelete} collapsed={collapsed} />
        ))}
      </div>
      <div style={{ padding: "16px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", justifyContent: collapsed ? "center" : "flex-start" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#222", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
             <img src={profile?.avatar_url || "https://ui-avatars.com/api/?name=User&background=333&color=fff"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.85rem", fontWeight: "600", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{profile?.full_name || "Simulation Pilot"}</div>
              <button onClick={onSignOut} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "0.75rem", padding: 0, marginTop: "2px" }}>Sign Out</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function Arena({ user, profile, onSessionSave, loadedSession, onOpenSidebar }) {
  const [task, setTask] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeChars, setActiveChars] = useState(["STARK", "EDDIE", "SENKU"]);
  const [messages, setMessages] = useState([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (loadedSession) {
      setTask(loadedSession.task || "");
      setMessages(loadedSession.messages || []);
    }
  }, [loadedSession]);

  const runSimulation = () => {
    if (!task) return;
    setIsSimulating(true);
    setProgress(0);
    setMessages([]);

    let step = 0;
    const interval = setInterval(() => {
      step++;
      setProgress(step * 33.4);
      if (step <= MESSAGES.length) {
        setMessages(prev => [...prev, MESSAGES[step - 1]]);
      }
      if (step >= 3) {
        clearInterval(interval);
        setIsSimulating(false);
        onSessionSave({
          name: task.substring(0, 30) + "...",
          task,
          messages: MESSAGES,
          emoji: "🧪"
        });
      }
    }, 1500);
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "40px 20px", background: "#0a0a0f" }}>
      <style jsx global>{`
        @media (max-width: 860px) {
          .arena-grid { flex-direction: column !important; }
          .arena-col { width: 100% !important; }
        }
      `}</style>

      {/* Main Arena Container - Centered for responsiveness */}
      <div className="arena-grid" style={{ 
        maxWidth: "1200px", 
        margin: "0 auto", 
        display: "flex", 
        gap: "30px", 
        alignItems: "flex-start" 
      }}>
        
        {/* LEFT COLUMN: Setup & Input */}
        <div className="arena-col" style={{ flex: 2, display: "flex", flexDirection: "column", gap: "24px" }}>
          <header style={{ marginBottom: "10px" }}>
            <button onClick={onOpenSidebar} style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontSize: "0.9rem", fontWeight: "600", marginBottom: "8px", display: "flex", alignItems: "center", gap: "5px" }}>
              <span>←</span> View History
            </button>
            <h1 style={{ fontSize: "2.5rem", fontWeight: "800", letterSpacing: "-1px", margin: 0 }}>Strategic Arena</h1>
            <p style={{ color: "rgba(255,255,255,0.5)", marginTop: "8px" }}>Deploy high-level personas to solve complex problems.</p>
          </header>

          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", padding: "24px" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "700", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: "12px" }}>Describe your task</label>
            <textarea 
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. Optimize a high-frequency trading bot for silver markets..."
              style={{ width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", padding: "16px", color: "white", fontSize: "1rem", minHeight: "120px", outline: "none", resize: "none" }}
            />
            <button 
              onClick={runSimulation}
              disabled={isSimulating || !task}
              style={{ width: "100%", marginTop: "16px", padding: "14px", borderRadius: "12px", background: isSimulating ? "#222" : "#6366f1", color: "white", fontWeight: "700", border: "none", cursor: isSimulating ? "default" : "pointer", transition: "all 0.2s" }}
            >
              {isSimulating ? "SIMULATION IN PROGRESS..." : "INITIATE SIMULATION"}
            </button>
          </div>

          {/* Tracker: Fixed to flex: 1 to match height of right column */}
          <div style={{ 
            background: "rgba(255,255,255,0.02)", 
            border: "1px solid rgba(255,255,255,0.06)", 
            borderRadius: "16px", 
            padding: "24px",
            flex: 1,
            display: "flex",
            flexDirection: "column"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "rgba(255,255,255,0.4)" }}>LIVE ACTIVITY</span>
              {isSimulating && <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 10px #10b981" }} />}
            </div>
            
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
              {messages.length === 0 && !isSimulating && (
                <div style={{ color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: "40px" }}>Waiting for initialization...</div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: "12px", animation: "fadeIn 0.5s ease-out" }}>
                  <Avatar who={m.sender} color={ALL_CHARS[m.sender].color} active />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: "700", color: ALL_CHARS[m.sender].color }}>{ALL_CHARS[m.sender].name}</div>
                    <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.8)", marginTop: "4px", lineHeight: "1.5" }}>{m.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Library & Management */}
        <div className="arena-col" style={{ width: "340px", display: "flex", flexDirection: "column", gap: "24px" }}>
          
          {/* DNA Library Column - Added top margin to align with Input box */}
          <div style={{ 
            background: "rgba(255,255,255,0.03)", 
            border: "1px solid rgba(255,255,255,0.08)", 
            borderRadius: "16px", 
            padding: "24px",
            marginTop: "170px" 
          }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: "700", marginBottom: "20px" }}>DNA LIBRARY</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {Object.keys(ALL_CHARS).map(key => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", background: "rgba(255,255,255,0.03)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <Avatar who={key} color={ALL_CHARS[key].color} size={40} active={activeChars.includes(key)} />
                  <div>
                    <div style={{ fontSize: "0.85rem", fontWeight: "600" }}>{ALL_CHARS[key].name}</div>
                    <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)" }}>Status: Ready</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(168,85,247,0.1))", border: "1px solid rgba(99,102,241,0.2)", borderRadius: "16px", padding: "24px" }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: "700", marginBottom: "8px" }}>ADD CHARACTER</h3>
            <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", marginBottom: "16px" }}>Synthesize new intelligence personas.</p>
            <button style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", cursor: "pointer" }}>+ Open Forge</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [loadedSession, setLoadedSession] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
      fetchProfile(session.user.id);
      fetchSessions(session.user.id);
    });
  }, []);

  async function fetchProfile(uid) {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    if (data) setProfile(data);
  }

  async function fetchSessions(uid) {
    const { data } = await supabase.from("simulations").select("*").eq("user_id", uid).order("updated_at", { ascending: false });
    if (data) setSessions(data);
  }

  async function saveSession(sessionData) {
    const { data, error } = await supabase.from("simulations").upsert({
      id: currentSessionId || undefined,
      user_id: user.id,
      ...sessionData,
      updated_at: new Date()
    }).select().single();
    if (!error && data) {
      setCurrentSessionId(data.id);
      fetchSessions(user.id);
    }
  }

  async function deleteSession(id) {
    await supabase.from("simulations").delete().eq("id", id);
    if (currentSessionId === id) { handleNewSession(); }
    fetchSessions(user.id);
  }

  const handleLoadSession = (session) => {
    setCurrentSessionId(session.id);
    setLoadedSession(session);
  };

  const handleNewSession = () => {
    setCurrentSessionId(null);
    setLoadedSession({ task: "", messages: [] });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (!user) return null;

  return (
    <>
      <Head>
        <title>Arena | Autonomous Intelligence</title>
      </Head>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#0a0a0f", position: "relative" }}>

        {/* Mobile Backdrop */}
        {!sidebarCollapsed && (
          <div onClick={() => setSidebarCollapsed(true)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99, display: typeof window !== "undefined" && window.innerWidth < 768 ? "block" : "none" }} />
        )}

        <Sidebar
          sessions={sessions}
          onLoad={(s) => { handleLoadSession(s); setSidebarCollapsed(true); }}
          onDelete={deleteSession}
          onNew={() => { handleNewSession(); setSidebarCollapsed(true); }}
          profile={profile}
          onSignOut={handleSignOut}
          currentSessionId={currentSessionId}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
        />

        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <Arena
            user={user}
            profile={profile}
            onSessionSave={saveSession}
            loadedSession={loadedSession}
            onOpenSidebar={() => setSidebarCollapsed(false)}
          />
        </div>
      </div>
    </>
  );
}
