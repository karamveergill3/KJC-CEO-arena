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

// ─── Character photos ─────────────────────────────────────────────────────────
const PHOTOS = {
  STARK: "data:image/jpeg;base64,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",
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
  STARK: {
    name: "Tony Stark", tag: "STARK", color: "#e8a020", glow: "rgba(232,160,32,0.15)", border: "rgba(232,160,32,0.3)", textColor: "#f5c060", hasPhoto: true,
    heading: "Chief Architect & Sign-off",
    specialties: ["System Architecture","Performance Optimisation","Risk Framework Design","Technical Validation","Final Sign-off Authority"],
  },
  EDDIE: {
    name: "Eddie Morra", tag: "MORRA", color: "#38b8f0", glow: "rgba(56,184,240,0.15)", border: "rgba(56,184,240,0.3)", textColor: "#70d0ff", hasPhoto: true,
    heading: "Strategy & Pattern Intelligence",
    specialties: ["Market Pattern Recognition","Strategy Logic","Risk Modelling","Edge Durability Assessment","Execution Precision"],
  },
  SENKU: {
    name: "Senku Ishigami", tag: "SENKU", color: "#3ee89a", glow: "rgba(62,232,154,0.15)", border: "rgba(62,232,154,0.3)", textColor: "#70ffbc", hasPhoto: true,
    heading: "Scientific Methodology & Research",
    specialties: ["Statistical Rigour","Backtesting Methodology","Hypothesis Testing","Market Regime Theory","Edge Validation Science"],
  },
};
const DEFAULT_ACTIVE = ["STARK", "EDDIE", "SENKU"];

// ─── System prompts ──────────────────────────────────────────────────────────
const BASE_SYSTEMS = {
  STARK: `You are Tony Stark. Genius, direct, final sign-off authority. Say "yeah no" before dismantling. You DO NOT ask for more code — you WRITE the fixes yourself.

MISSION: Take this trading bot and MAKE IT genuinely profitable. You and the team write all improvements directly. Target: 60+ trades, profit factor >1.5, controlled drawdown, real edge. You write the actual C# code fixes inline when needed.

YOU MUST FOLLOW THIS EXACT FORMAT — no exceptions:
AGREED: [one sentence on what's confirmed fixed so far, or "Nothing yet"]
ISSUE: [identify one problem AND write the exact C# fix for it. Show the corrected code snippet. If everything is solid say "No issues — architecture is sound."]
RATING: [number]/10

Rules: RATING only goes UP. Always include all 3 sections. If RATING is 10/10 add STARK_APPROVED after. Max 5 sentences. NEVER ask the user to add or paste code.`,

  EDDIE: `You are Eddie Morra on NZT-48. No hedging. Pure signal. You DO NOT ask for more code — you WRITE the fixes yourself.

MISSION: Take this trading bot and MAKE IT genuinely profitable. You write all improvements directly in C#. Target: 60+ trades, profit factor >1.5, real statistical edge. You produce the actual code.

YOU MUST FOLLOW THIS EXACT FORMAT — no exceptions:
AGREED: [one sentence on what's confirmed fixed so far, or "Nothing yet"]
ISSUE: [identify one problem AND write the exact C# fix. Show the corrected code snippet. If everything is solid say "No issues — strategy is executable."]
RATING: [number]/10

Rules: RATING only goes UP. Always include all 3 sections. If RATING is 10/10 add EDDIE_APPROVED after. Max 5 sentences. NEVER ask the user to add or paste code.`,

  SENKU: `You are Senku Ishigami. Zero tolerance for weak methodology. Say "ten billion percent" when certain. You DO NOT ask for more code — you WRITE the scientific fixes yourself.

MISSION: Take this trading bot and make it scientifically bulletproof AND profitable. You write methodology fixes and parameter improvements directly. Target: 60+ trades, reproducible profit factor >1.5, zero overfitting.

YOU MUST FOLLOW THIS EXACT FORMAT — no exceptions:
AGREED: [one sentence on what's confirmed fixed so far, or "Nothing yet"]
ISSUE: [identify one scientific/methodology flaw AND write the exact fix — parameter values, logic corrections, or C# code snippet. If everything is solid say "Ten billion percent — science is bulletproof."]
RATING: [number]/10

Rules: RATING only goes UP. Always include all 3 sections. If RATING is 10/10 add SENKU_APPROVED after. Max 5 sentences. NEVER ask the user to add or paste code.`,
};

const getSystem = (key, customChars) => {
  if (BASE_SYSTEMS[key]) return BASE_SYSTEMS[key];
  const ch = customChars[key];
  return `You are ${ch.name} doing a focused code review. ${ch.description}

STRICT FORMAT — every response must have these three sections:
AGREED: One sentence confirming what has been resolved so far (or "Nothing yet" on first turn). Do NOT re-raise anything already agreed.
ISSUE: One new specific problem not yet discussed. If no new issues remain, confirm the code is solid.
RATING: X/10 — your current rating, which can only go up, never down.

If RATING is 10/10, add ${key}_APPROVED on a new line after RATING.
Maximum 4 sentences total.`;
};

// ─── Final code generator prompt ─────────────────────────────────────────────
const CODEGEN_SYSTEM = `You are a senior algorithmic trading developer specialising in cTrader C#. Your job is to produce the FINAL improved version of this trading bot by applying every code fix, parameter improvement, and logic change that the review team wrote during their debate. The reviewers wrote actual C# fixes — apply all of them. Your output must be genuinely profitable and production-ready: minimum 60 trades in backtest, profit factor >1.5, controlled drawdown, real edge, no overfitting. CRITICAL: (1) Output the COMPLETE file — never truncate, never use "..." or "rest unchanged". (2) Raw C# only — no markdown, no explanation. (3) Start with "using", end with final brace. Apply every single fix the reviewers wrote.`;

// ─── API call ─────────────────────────────────────────────────────────────────
// ─── Anthropic API call ───────────────────────────────────────────────────────
const callAPI = async (system, userContent, maxTokens = 280, _unused) => {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");
  const text = data.content?.find(b => b.type === "text")?.text || "";
  if (!text) throw new Error("Empty response");
  return text;
};

// ─── Main component ───────────────────────────────────────────────────────────

// ─── Live Activity Tracker ────────────────────────────────────────────────────
function LiveTracker({ profile }) {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchActivity = async () => {
    try {
      const res = await fetch("/api/activity");
      if (res.ok) {
        const data = await res.json();
        setActivity(data);
      }
    } catch(e) {}
    setLoading(false);
  };

  useEffect(() => {
    fetchActivity();
    const interval = setInterval(fetchActivity, 10000); // poll every 10s
    return () => clearInterval(interval);
  }, []);

  const statusColor = (s) => s === "reviewing" ? "#38b8f0" : s === "completed" ? "#3ee89a" : "#e8a020";
  const statusBg = (s) => s === "reviewing" ? "rgba(56,184,240,0.1)" : s === "completed" ? "rgba(62,232,154,0.1)" : "rgba(232,160,32,0.1)";
  const statusLabel = (s) => s === "reviewing" ? "REVIEWING" : s === "completed" ? "COMPLETED" : "EXPORTED";

  const timeAgo = (ts) => {
    const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
  };

  const reviewing = activity.filter(a => a.status === "reviewing");
  const recent = activity.filter(a => a.status !== "reviewing").slice(0, 8);

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", marginTop: 12, flex: 1 }}>
      {/* Header */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 8, width: 8, height: 8, borderRadius: "50%", background: "#3ee89a", display: "inline-block", boxShadow: "0 0 6px #3ee89a", animation: "pulse 2s infinite" }} />
          <div style={{ fontSize: 11, fontWeight: 800, color: "#3ee89a", letterSpacing: 3 }}>LIVE ACTIVITY</div>
        </div>
        <button onClick={fetchActivity} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 12, padding: 2, fontFamily: "inherit" }}>↻</button>
      </div>

      <div style={{ padding: "10px 12px" }}>
        {loading ? (
          <div style={{ padding: "20px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Loading...</div>
        ) : (
          <>
            {/* Currently reviewing */}
            {reviewing.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 3, marginBottom: 6 }}>NOW REVIEWING</div>
                {reviewing.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: "rgba(56,184,240,0.06)", border: "1px solid rgba(56,184,240,0.15)", marginBottom: 4 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(56,184,240,0.15)", border: "1px solid rgba(56,184,240,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#38b8f0", flexShrink: 0 }}>
                      {a.username?.[0]?.toUpperCase() || "?"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>@{a.username}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.file_name || "Unknown file"}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[0,1,2].map(i => <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "#38b8f0", animation: `pulse 1.2s ${i*0.2}s ease-in-out infinite` }} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent completions */}
            {recent.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 3, marginBottom: 6 }}>RECENT</div>
                {recent.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, marginBottom: 3, background: "rgba(255,255,255,0.02)" }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: statusBg(a.status), border: `1px solid ${statusColor(a.status)}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: statusColor(a.status), flexShrink: 0 }}>
                      {a.username?.[0]?.toUpperCase() || "?"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.8)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>@{a.username}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.file_name || "Unknown"}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 10, background: statusBg(a.status), color: statusColor(a.status), fontWeight: 700, letterSpacing: 1 }}>{statusLabel(a.status)}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{timeAgo(a.updated_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {reviewing.length === 0 && recent.length === 0 && (
              <div style={{ padding: "24px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.2 }}>◈</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>No activity yet.</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>Be the first to start a review.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── DNA Library Panel ───────────────────────────────────────────────────────
function DnaLibrary({ sessions, onLoadSession }) {
  const [expanded, setExpanded] = useState(null);

  const dnaSessionss = [];
  // safely filter sessions that have DNA cards
  try {
    (sessions || []).forEach(s => {
      try {
        if (!s || !s.messages) return;
        const msgs = typeof s.messages === "string" ? JSON.parse(s.messages) : s.messages;
        if (msgs && msgs.dnaCard) dnaSessionss.push(s);
      } catch {}
    });
  } catch {}

  const riskColor = (r) => r === "Aggressive" ? "#f07070" : r === "Conservative" ? "#3ee89a" : "#e8a020";
  const riskBg = (r) => r === "Aggressive" ? "rgba(240,80,80,0.12)" : r === "Conservative" ? "rgba(62,232,154,0.12)" : "rgba(232,160,32,0.12)";

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 16 }}>🧬</span>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#c084fc", letterSpacing: 3 }}>STRATEGY DNA LIBRARY</div>
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
          After each 10/10 review, generate a DNA profile for your strategy. It analyses your code and produces a complete personality card — edge, conditions, risk profile, strengths and weaknesses. Build your library over time to compare strategies at a glance.
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "12px" }}>
        {dnaSessionss.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🧬</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>No DNA profiles yet.</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", lineHeight: 1.7 }}>Complete a review and generate<br/>Strategy DNA to build your library.</div>
            <div style={{ fontSize: 13, color: "#c084fc", fontWeight: 700, marginTop: 12, fontFamily: "'Bebas Neue', Impact, sans-serif", letterSpacing: 2 }}>DON'T SLACK G</div>
          </div>
        ) : (
          dnaSessionss.map(s => {
            let dna = null;
            try {
              const msgs = typeof s.messages === "string" ? JSON.parse(s.messages) : s.messages;
              dna = (msgs && msgs.dnaCard) ? msgs.dnaCard : null;
            } catch { return null; }
            if (!dna) return null;
            const isExp = expanded === s.id;
            return (
              <div key={s.id} style={{ marginBottom: 8, border: `1px solid ${isExp ? "rgba(192,132,252,0.3)" : "rgba(255,255,255,0.06)"}`, borderRadius: 10, overflow: "hidden", transition: "all 0.2s" }}>
                <div onClick={() => setExpanded(isExp ? null : s.id)}
                  style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", background: isExp ? "rgba(168,85,247,0.08)" : "rgba(255,255,255,0.02)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", fontFamily: "'Bebas Neue', Impact, sans-serif", letterSpacing: 2, marginBottom: 2 }}>{dna.personality}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.file_name || s.title || "Untitled"}</div>
                  </div>
                  <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 20, background: riskBg(dna.risk_profile), color: riskColor(dna.risk_profile), fontWeight: 600, flexShrink: 0 }}>{dna.risk_profile}</span>
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>{isExp ? "▲" : "▼"}</span>
                </div>
                {isExp && (
                  <div style={{ padding: "14px", background: "rgba(168,85,247,0.03)", borderTop: "1px solid rgba(168,85,247,0.1)" }}>
                    <div style={{ fontSize: 13, color: "#fff", fontStyle: "italic", marginBottom: 12, lineHeight: 1.6 }}>"{dna.verdict}"</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                      {[
                        { label: "⚡ EDGE", value: dna.edge },
                        { label: "✅ BEST FOR", value: dna.best_conditions },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                          <div style={{ fontSize: 9, color: "rgba(192,132,252,0.6)", letterSpacing: 2, marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => onLoadSession(s)}
                      style={{ width: "100%", padding: "9px", background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 7, color: "#c084fc", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", letterSpacing: 1 }}>
                      OPEN SESSION →
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Arena({ user, profile, onSessionSave, sessions, onLoadSession, onNewSession, onSignOut, isSidebarCollapsed, onOpenSidebar, sidebarOpen }) {
  const [screen, setScreen]         = useState("setup");
  const [code, setCode]             = useState(DEFAULT_CODE);
  const [fileName, setFileName]     = useState("SilverScalper_v8.cs");
  const [messages, setMessages]     = useState([]);
  const [running, setRunning]       = useState(false);
  const [paused, setPaused]         = useState(false);
  const [thinking, setThinking]     = useState(null);
  const [phase, setPhase]           = useState("idle");
  const [fixedCode, setFixedCode]   = useState("");
  const [approvals, setApprovals]   = useState({});
  const [error, setError]           = useState(null);
  const [dragOver, setDragOver]     = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showFixed, setShowFixed]   = useState(true);
  const [dnaCard, setDnaCard]         = useState(null);
  const [generatingDna, setGeneratingDna] = useState(false);
  const [copied, setCopied]         = useState(false);

  // Character management
  const [activeChars, setActiveChars] = useState(DEFAULT_ACTIVE);
  const [customChars, setCustomChars] = useState({});
  const [showAddChar, setShowAddChar] = useState(false);
  const [newChar, setNewChar]         = useState({ name: "", tag: "", description: "", color: "#a855f7", photo: null });
  const [taskInput, setTaskInput]     = useState("");
  const [routing, setRouting]         = useState(false);
  const [routeReason, setRouteReason] = useState("");
  const [addingChar, setAddingChar]   = useState(false);

  const endRef     = useRef(null);
  const pausedRef  = useRef(false);
  const runRef     = useRef(false);
  const msgsRef    = useRef([]);
  const approvalsRef = useRef({});
  const activeCharsRef = useRef(DEFAULT_ACTIVE);
  const customCharsRef = useRef({});
  const debateHistoryRef = useRef("");
  const debateRatingsRef = useRef({});
  const debateAgreedRef = useRef([]);
  const debateTurnRef = useRef(0);

  // Load persisted characters on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await window.storage.get("arena_custom_chars");
        if (stored?.value) {
          const parsed = JSON.parse(stored.value);
          setCustomChars(parsed);
          customCharsRef.current = parsed;
          // Restore their photos placeholder
          Object.keys(parsed).forEach(k => { if (!PHOTOS[k]) PHOTOS[k] = null; });
        }
      } catch(e) { /* no stored chars yet */ }
    })();
  }, []);

  // Persist customChars whenever they change
  useEffect(() => {
    if (Object.keys(customChars).length === 0) return;
    window.storage.set("arena_custom_chars", JSON.stringify(customChars)).catch(() => {});
    customCharsRef.current = customChars;
  }, [customChars]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking, fixedCode]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { runRef.current = running; }, [running]);
  useEffect(() => { activeCharsRef.current = activeChars; }, [activeChars]);

  const waitUnpaused = () => new Promise(res => {
    const check = () => pausedRef.current ? setTimeout(check, 250) : res();
    check();
  });

  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { setCode(e.target.result); setFileName(file.name); setError(null); };
    reader.onerror = () => setError("Failed to read file.");
    reader.readAsText(file);
  };

  const allChars = () => ({ ...ALL_CHARS, ...customChars });

  const reset = (continueDebate = false) => {
    runRef.current = false;
    setRunning(false); setThinking(null); setPaused(false);
    if (!continueDebate) {
      setMessages([]); msgsRef.current = [];
      const emptyApprovals = {};
      activeCharsRef.current.forEach(k => emptyApprovals[k] = false);
      setApprovals(emptyApprovals);
      approvalsRef.current = { ...emptyApprovals };
      setFixedCode(""); setPhase("idle"); setError(null);
      setCopied(false); setDnaCard(null);
      debateHistoryRef.current = "";
      debateRatingsRef.current = {};
      debateAgreedRef.current = [];
      debateTurnRef.current = 0;
    }
  };

  const generateDNA = async (fixedCodeText, msgs) => {
    setGeneratingDna(true);
    try {
      const DNA_SYSTEM = `You are a trading strategy analyst. Analyse the given strategy code and debate and return ONLY a JSON object with exactly these keys:
{
  "edge": "one sentence describing the core trading edge",
  "best_conditions": "one sentence on ideal market conditions",
  "worst_conditions": "one sentence on when this strategy struggles",
  "risk_profile": "one of: Conservative / Moderate / Aggressive",
  "personality": "a punchy 2-3 word archetype e.g. Sniper, Momentum Hunter, Range Trader, Breakout Artist",
  "personality_desc": "one sentence describing the strategy personality",
  "verdict": "one powerful sentence — the strategy's defining characteristic",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"]
}
Return ONLY valid JSON. No markdown, no explanation.`;

      const content = `Strategy code (summary):
${fixedCodeText.slice(0, 2000)}

Debate highlights:
${msgs.map(m => m.text).join(" ").slice(0, 1500)}

Generate the Strategy DNA JSON.`;
      const result = await callAPI(DNA_SYSTEM, content, 600);
      const clean = result.replace(/```json|```/g, "").trim();
      // Extract JSON object from response
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]);
      setDnaCard(parsed);
    } catch(e) {
      console.error("DNA generation failed:", e);
    }
    setGeneratingDna(false);
  };

  const generateFixedCode = async (snapshot, msgs, chars) => {
    setPhase("generating");
    try {
      const charNames = chars.map(k => allChars()[k]?.name || k).join(", ");
      const genContent = `Original code:
\`\`\`
${snapshot.slice(0, 4000)}
\`\`\`

Fixes agreed by ${charNames}:
${msgs.map(m => `${allChars()[m.who]?.name||m.who}: ${m.text}`).join("\n\n").slice(0, 3000)}

Output the complete fixed code.`;
      const fixed = await callAPI(CODEGEN_SYSTEM, genContent, 4500);
      setFixedCode(fixed);
    } catch(e) {
      setError(`Code generation failed: ${e.message}`);
    }
    setPhase("done");
    setRunning(false);

    // Log activity — review completed
    try {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        fetch("/api/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ status: "completed", file_name: fileName }),
        }).catch(() => {});
      });
    } catch(e) {}
  };

  const addCustomChar = async () => {
    if (!newChar.name || !newChar.tag || !newChar.description) return;
    const key = newChar.tag.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const glow = newChar.color + "26";
    const border = newChar.color + "4d";
    setAddingChar(true);
    let specialties = ["Code Review", "Technical Analysis"];
    let heading = "Specialist Reviewer";
    try {
      const res = await callAPI(
        "You generate character metadata. Return ONLY valid JSON, no markdown, no explanation.",
        `Character: ${newChar.name}
Description: ${newChar.description}

Return JSON: {"heading": "3-5 word role title", "specialties": ["Tag1","Tag2","Tag3","Tag4","Tag5"]}
Base the heading and specialties on the character's actual skills, knowledge domain, and personality from their source material.`,
        120
      );
      const parsed = JSON.parse(res.replace(/```json|```/g, "").trim());
      if (parsed.heading) heading = parsed.heading;
      if (parsed.specialties?.length) specialties = parsed.specialties.slice(0, 5);
    } catch(e) { /* use defaults */ }
    setAddingChar(false);
    const entry = { name: newChar.name, tag: key, color: newChar.color, glow, border, textColor: newChar.color, description: newChar.description, hasPhoto: !!newChar.photo, heading, specialties };
    if (newChar.photo) PHOTOS[key] = newChar.photo;
    const updated = { ...customChars, [key]: entry };
    setCustomChars(updated);
    customCharsRef.current = updated;
    PHOTOS[key] = null;
    setActiveChars(prev => [...prev, key]);
    setNewChar({ name: "", tag: "", description: "", color: "#a855f7", photo: null });
    setShowAddChar(false);
  };

  const routeByTask = async () => {
    if (!taskInput.trim()) return;
    setRouting(true);
    setRouteReason("");
    const allC = { ...ALL_CHARS, ...customChars };
    const roster = Object.entries(allC).map(([k, ch]) => `${k}: ${ch.name} - ${ch.heading} - Specialties: ${(ch.specialties||[]).join(", ")}`).join("\n");
    try {
      const res = await callAPI(
        "You are a task router. Return ONLY valid JSON, no markdown.",
        `Task: "${taskInput}"

Available reviewers:
${roster}

Return JSON: {"selected": ["KEY1","KEY2"], "reason": "One sentence explaining why these characters are best for this task."}
Select 1-3 characters whose specialties best match the task.`,
        150
      );
      const parsed = JSON.parse(res.replace(/```json|```/g, "").trim());
      if (parsed.selected?.length) {
        const valid = parsed.selected.filter(k => allC[k]);
        if (valid.length) { setActiveChars(valid); setRouteReason(parsed.reason || ""); }
      }
    } catch(e) { setRouteReason("Could not route — try again."); }
    setRouting(false);
  };

  const beginReview = async (continueDebate = false) => {
    const snapshot = code;
    const chars = activeCharsRef.current;
    reset(continueDebate);
    setRunning(true); runRef.current = true;
    setPhase("debating");
    setScreen("review");

    // Log activity — user started reviewing
    try {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        fetch("/api/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ status: "reviewing", file_name: fileName }),
        }).catch(() => {});
      });
    } catch(e) {}

    // If continuing, restore state; otherwise start fresh
    let history = continueDebate ? debateHistoryRef.current : "";
    let turn = continueDebate ? debateTurnRef.current : 0;
    const MAX_TURNS = turn + (chars.length * 5);
    const charMap = { ...ALL_CHARS, ...customCharsRef.current };
    const highestRatings = continueDebate ? { ...debateRatingsRef.current } : Object.fromEntries(chars.map(k => [k, 0]));
    const agreedItems = continueDebate ? [...debateAgreedRef.current] : [];

    for (let i = 0; i < MAX_TURNS; i++) {
      if (!runRef.current) break;
      await waitUnpaused();
      if (!runRef.current) break;

      if (chars.every(k => approvalsRef.current[k])) break;

      const who = chars[turn % chars.length];
      turn++;
      setThinking(who);

      const charName = charMap[who]?.name || who;
      const isFirst = history.length === 0;
      const myRating = highestRatings[who] || 0;

      const codeBlock = isFirst
        ? `CODE UNDER REVIEW:\n\`\`\`\n${snapshot.slice(0, 3500)}\n\`\`\``
        : `CODE (reference):\n\`\`\`\n${snapshot.slice(0, 400)}\n...\n\`\`\``;

      const agreedBlock = agreedItems.length > 0
        ? `ALREADY AGREED AND CLOSED — DO NOT RAISE THESE AGAIN:\n${agreedItems.map((a, n) => `${n+1}. ${a}`).join("\n")}`
        : "AGREED SO FAR: Nothing yet.";

      const ratingCtx = myRating > 0
        ? `Your current rating for THIS session is ${myRating}/10. It can only go UP as issues get fixed in this session, never down.`
        : "Give your honest assessment of the code quality as it stands.";

      const content = isFirst
        ? `${codeBlock}\n\n${agreedBlock}\n\nAssess this code honestly based purely on what you see. If it is already high quality, rate it accordingly. If there are issues, identify them. Follow the STRICT FORMAT in your instructions exactly.`
        : `${codeBlock}\n\n${agreedBlock}\n\nRECENT DISCUSSION:\n${history.slice(-800)}\n\n${ratingCtx}\n\nRespond as ${charName}. Follow the STRICT FORMAT exactly. Do not repeat anything in the AGREED list.`;

      try {
        const system = getSystem(who, customCharsRef.current);
        const text = await callAPI(system, content, 280);
        if (!runRef.current) break;

        // Extract AGREED line and add to log if new
        const agreedMatch = text.match(/AGREED:\s*(.+)/i);
        if (agreedMatch) {
          const agreedText = agreedMatch[1].trim();
          if (agreedText && agreedText.toLowerCase() !== "nothing yet" && !agreedItems.some(a => a.toLowerCase() === agreedText.toLowerCase())) {
            agreedItems.push(agreedText);
          }
        }

        // Extract rating — prefer explicit RATING: line
        const ratingLineMatch = text.match(/RATING:\s*([0-9]|10)\/10/i);
        const ratingFallback = text.match(/([0-9]|10)\/10/);
        const ratingNum = ratingLineMatch ? parseInt(ratingLineMatch[1]) : ratingFallback ? parseInt(ratingFallback[1]) : 0;
        if (!isNaN(ratingNum) && ratingNum > highestRatings[who]) highestRatings[who] = ratingNum;

        // Only approve on token + genuine 9+
        const newApprovals = { ...approvalsRef.current };
        if (text.includes(`${who}_APPROVED`) && highestRatings[who] >= 10) newApprovals[who] = true;
        approvalsRef.current = newApprovals;
        setApprovals({ ...newApprovals });

        const cleanText = text.replace(new RegExp(`${who}_APPROVED`, "g"), "").trim();
        const msg = { id: `${Date.now()}-${i}`, who, text: cleanText, rating: highestRatings[who] };
        msgsRef.current = [...msgsRef.current, msg];
        setMessages([...msgsRef.current]);
        history += `\n\n${charName}: ${text}`;
        debateHistoryRef.current = history;
        debateRatingsRef.current = { ...highestRatings };
        debateAgreedRef.current = [...agreedItems];
        debateTurnRef.current = turn;
        setThinking(null);
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {
        setError(e.message);
        setThinking(null);
        break;
      }
    }
    setThinking(null);
    const allApproved = chars.every(k => approvalsRef.current[k]);

    if (allApproved) {
      // Genuine consensus reached
      await generateFixedCode(snapshot, msgsRef.current, chars);
    } else {
      // Cap hit without consensus — don't auto-generate, let user decide
      setPhase("capped");
      setRunning(false);
    }
  };

  const copyCode = () => {
    try {
      // Fallback for sandboxed iframes where clipboard API is blocked
      const ta = document.createElement("textarea");
      ta.value = fixedCode;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch(e) {
      // Last resort — try modern API
      navigator.clipboard?.writeText(fixedCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }).catch(() => setError("Copy failed — please select the code manually."));
    }
  };

  // ─── SETUP SCREEN ──────────────────────────────────────────────────────────
  if (screen === "setup") {
    return (
      <div style={s.root}>
        <GridBg />
        {/* Top bar with hamburger + logo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", flexShrink: 0 }}>
          <button onClick={() => onOpenSidebar?.()} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, cursor: "pointer", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ display: "block", width: 18, height: 2, background: "rgba(255,255,255,0.7)", borderRadius: 2 }} />
            <span style={{ display: "block", width: 18, height: 2, background: "rgba(255,255,255,0.7)", borderRadius: 2 }} />
            <span style={{ display: "block", width: 18, height: 2, background: "rgba(255,255,255,0.7)", borderRadius: 2 }} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, background: "linear-gradient(135deg, #e8a020, #f5c842, #c07010)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>KJC</span>
            <span style={{ width: 1, height: 10, background: "rgba(232,160,32,0.4)" }} />
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 3, color: "#c8900a" }}>CAPITAL</span>
          </div>
        </div>

        <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", gap: 24, padding: "0 clamp(14px, 4vw, 40px) 60px", width: "100%", maxWidth: 1100, marginLeft: sidebarOpen ? "0" : "auto", marginRight: "auto", boxSizing: "border-box", alignItems: "stretch", justifyContent: "center" }}>
        {/* Left column — setup content */}
        <div style={{ flex: "1 1 420px", minWidth: 0, maxWidth: 600, alignSelf: "flex-start" }}>
          <div style={s.logo}>
            <div style={s.logoLine}>
              <span style={s.logoText}>REVIEW</span>
              <span style={s.logoAccent}>ARENA</span>
            </div>
            <div style={s.logoSub}>{activeChars.map(k => ({...ALL_CHARS,...customChars})[k]?.tag||k).join(" · ")} — DEBATE UNTIL 10/10</div>
          </div>

          {/* Task routing */}
          <div style={s.sectionLabel}>TASK ROUTING — OPTIONAL</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: routeReason ? 8 : 24 }}>
            <input
              value={taskInput}
              onChange={e => setTaskInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && routeByTask()}
              placeholder="Describe your task — e.g. 'review risk management'"
              style={{ width: "100%", padding: "11px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: 13, borderRadius: 8, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
            />
            <button onClick={routeByTask} disabled={routing} style={{ width: "100%", padding: "11px 20px", background: routing ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: routing ? "#555" : "#ccc", fontSize: 12, letterSpacing: 2, cursor: routing ? "not-allowed" : "pointer", borderRadius: 10, fontFamily: "inherit", fontWeight: 600 }}>
              {routing ? "ROUTING..." : "AUTO-SELECT ▶"}
            </button>
          </div>
          {routeReason && (
            <div style={{ marginBottom: 20, padding: "12px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>
              <span style={{ color: "#e8a020", fontSize: 9, letterSpacing: 2, marginRight: 8 }}>ROUTED</span>{routeReason}
            </div>
          )}

          {/* Character selection */}
          <div style={s.sectionLabel}>REVIEWERS — CLICK TO TOGGLE</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
            {Object.entries({ ...ALL_CHARS, ...customChars }).map(([k, ch]) => {
              const active = activeChars.includes(k);
              const topTwo = (ch.specialties || []).slice(0, 2);
              return (
                <div key={k} onClick={() => setActiveChars(prev => active && prev.length > 1 ? prev.filter(x => x !== k) : active ? prev : [...prev, k])}
                  style={{ padding: "14px 16px", borderRadius: 12, border: `1px solid ${active ? ch.color + "40" : "rgba(255,255,255,0.05)"}`, background: active ? ch.color + "08" : "rgba(255,255,255,0.01)", opacity: active ? 1 : 0.4, cursor: "pointer", transition: "all 0.25s", boxShadow: active ? `0 2px 20px ${ch.color}15` : "none" }}>
                  {/* Top row: avatar + name/heading + dot */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: topTwo.length ? 10 : 0 }}>
                    {ch.hasPhoto
                      ? <Avatar who={k} size={38} color={ch.color} active={active} />
                      : <div style={{ width: 38, height: 38, borderRadius: "50%", background: ch.color + "22", border: `2px solid ${active ? ch.color : "rgba(255,255,255,0.1)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: ch.color, flexShrink: 0 }}>{ch.name[0]}</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: active ? "#fff" : "rgba(255,255,255,0.55)", lineHeight: 1.3 }}>{ch.name}</div>
                      <div style={{ fontSize: 10, color: active ? ch.color : "rgba(255,255,255,0.4)", letterSpacing: 1, textTransform: "uppercase", marginTop: 2, lineHeight: 1.3 }}>{ch.heading || ch.tag}</div>
                    </div>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: active ? ch.color : "rgba(255,255,255,0.2)", flexShrink: 0, boxShadow: active ? `0 0 8px ${ch.color}` : "none", transition: "all 0.2s" }} />
                  </div>
                  {/* Pills row — always below, wraps naturally */}
                  {topTwo.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 50 }}>
                      {topTwo.map(sp => (
                        <span key={sp} style={{ fontSize: 10, padding: "3px 10px", borderRadius: 20, background: active ? ch.color + "15" : "rgba(255,255,255,0.03)", border: `1px solid ${active ? ch.color + "40" : "rgba(255,255,255,0.06)"}`, color: active ? ch.textColor : "rgba(255,255,255,0.4)", fontWeight: 500, lineHeight: 1.6 }}>{sp}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div onClick={() => setShowAddChar(s => !s)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 18px", borderRadius: 6, border: `1px dashed ${showAddChar ? "#a855f7" : "rgba(255,255,255,0.08)"}`, cursor: "pointer", background: showAddChar ? "rgba(168,85,247,0.05)" : "transparent", transition: "all 0.2s" }}>
              <span style={{ fontSize: 18, color: showAddChar ? "#a855f7" : "#444", lineHeight: 1 }}>+</span>
              <span style={{ fontSize: 10, color: showAddChar ? "#a855f7" : "rgba(255,255,255,0.5)", letterSpacing: 3 }}>ADD CHARACTER</span>
            </div>
          </div>

          {/* Add character form */}
          {showAddChar && (
            <div style={{ marginBottom: 24, padding: "22px 24px", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 12, background: "rgba(168,85,247,0.03)" }}>
              <div style={{ fontSize: 9, color: "#a855f7", letterSpacing: 3, marginBottom: 14 }}>NEW CHARACTER — SPECIALTIES AUTO-GENERATED</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <input value={newChar.name} onChange={e => setNewChar(p => ({...p, name: e.target.value}))} placeholder="Name (e.g. Sherlock Holmes)"
                  style={{ flex: 2, minWidth: 160, padding: "8px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: 13, borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
                <input value={newChar.tag} onChange={e => setNewChar(p => ({...p, tag: e.target.value.toUpperCase().slice(0,8)}))} placeholder="TAG"
                  style={{ flex: 1, minWidth: 80, padding: "8px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: 13, borderRadius: 8, outline: "none", fontFamily: "monospace" }} />
                <input value={newChar.color} onChange={e => setNewChar(p => ({...p, color: e.target.value}))} type="color"
                  style={{ width: 40, height: 36, padding: 2, background: "#0c0c14", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3, cursor: "pointer" }} />
              </div>
              <textarea value={newChar.description} onChange={e => setNewChar(p => ({...p, description: e.target.value}))} placeholder="Who is this character? Describe their personality, expertise, and how they think. Specialties will be generated automatically."
                style={{ width: "100%", padding: "8px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: 13, borderRadius: 8, outline: "none", fontFamily: "inherit", resize: "vertical", minHeight: 72, marginBottom: 10 }} />
              {/* Photo upload */}
              <label htmlFor="char-photo-upload" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, cursor: "pointer" }}>
                <div style={{
                  width: 44, height: 44, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                  border: `2px solid ${newChar.photo ? newChar.color : "rgba(255,255,255,0.1)"}`,
                  background: newChar.photo ? "transparent" : "#0c0c14",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {newChar.photo
                    ? <img src={newChar.photo} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 18, color: "rgba(255,255,255,0.2)" }}>+</span>}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: newChar.photo ? "#aaa" : "#666" }}>{newChar.photo ? "Photo uploaded — click to change" : "Upload profile photo (optional)"}</div>
                  <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>JPG, PNG — will show as circular avatar</div>
                </div>
                <input id="char-photo-upload" type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => setNewChar(p => ({...p, photo: ev.target.result}));
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }} />
              </label>
              <button onClick={addCustomChar} disabled={addingChar} style={{ padding: "10px 24px", background: addingChar ? "rgba(168,85,247,0.2)" : "#a855f7", border: "none", color: addingChar ? "#888" : "#fff", fontSize: 12, fontWeight: 700, letterSpacing: 2, cursor: addingChar ? "not-allowed" : "pointer", borderRadius: 8, fontFamily: "inherit" }}>
                {addingChar ? "GENERATING SPECIALTIES..." : "ADD CHARACTER"}
              </button>
            </div>
          )}

          <div style={s.uploadSection}>
            <div style={s.sectionLabel}>CODE FILE</div>
            <label
              htmlFor="file-upload"
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); readFile(e.dataTransfer.files[0]); }}
              style={{
                ...s.dropZone,
                borderColor: dragOver ? "#38b8f0" : fileName !== "SilverScalper_v8.cs" ? "#3ee89a" : "rgba(255,255,255,0.08)",
                background: dragOver ? "rgba(56,184,240,0.06)" : fileName !== "SilverScalper_v8.cs" ? "rgba(62,232,154,0.04)" : "rgba(255,255,255,0.02)",
              }}>
              <input id="file-upload" type="file" accept=".cs,.py,.js,.ts,.txt,.mq4,.mq5"
                style={s.fileInput} onChange={e => { if (e.target.files[0]) readFile(e.target.files[0]); }} />
              {fileName !== "SilverScalper_v8.cs" ? (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, marginBottom: 8, color: "#3ee89a" }}>✓</div>
                  <div style={{ color: "#3ee89a", fontSize: 13, fontWeight: 600 }}>{fileName}</div>
                  <div style={{ color: "#3ee89a", fontSize: 11, marginTop: 4, opacity: 0.6 }}>Click to replace</div>
                </div>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, marginBottom: 8, opacity: 0.25 }}>⬆</div>
                  <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 14 }}>Drop file or click to upload</div>
                  <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 4 }}>.cs .py .js .ts .mq4 .mq5 .txt</div>
                  <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 5 }}>Default: SilverScalper v8</div>
                </div>
              )}
            </label>
          </div>

          <div style={{ marginBottom: 24, padding: "18px 22px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10 }}>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", lineHeight: 1.8 }}>
              Use <span style={{ color: "#a855f7" }}>AUTO-SELECT</span> to route by task, or manually toggle reviewers. They debate until each rates it <span style={{ color: "#e8a020" }}>10/10</span>. Fixed code is always generated — on completion or when you hit <span style={{ color: "#e8a020" }}>STOP + EXPORT</span>.
            </div>
          </div>

          <button onClick={beginReview} style={s.cta}>
            BEGIN REVIEW ▶
          </button>
          {error && <div style={{ ...s.err, marginTop: 16 }}>⚠ {error}</div>}
        </div>{/* end left column */}

        {/* Right column — DNA Library + Live Tracker */}
        <div className="dna-col" style={{ flex: "0 0 260px", width: 260, paddingTop: 170, display: "flex", flexDirection: "column", alignSelf: "stretch" }}>
          <DnaLibrary sessions={sessions} onLoadSession={onLoadSession} />
          <LiveTracker profile={profile} />
        </div>

        </div>{/* end two-col */}
        <style>{css}</style>
      </div>
    );
  }

  // ─── REVIEW SCREEN ─────────────────────────────────────────────────────────
  const allApproved = approvals.STARK && approvals.EDDIE && approvals.SENKU;

  return (
    <div style={s.root}>
      <GridBg />

      {/* Top bar */}
      <div style={s.topBar}>
        <div style={s.topLeft}>
          <button onClick={() => onOpenSidebar?.()} title="Open reviews" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 11px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, marginRight: 6 }}>
            <span style={{ display: "block", width: 18, height: 2, background: "rgba(255,255,255,0.75)", borderRadius: 2 }} />
            <span style={{ display: "block", width: 18, height: 2, background: "rgba(255,255,255,0.75)", borderRadius: 2 }} />
            <span style={{ display: "block", width: 18, height: 2, background: "rgba(255,255,255,0.75)", borderRadius: 2 }} />
          </button>
          <button onClick={() => { reset(); setScreen("setup"); }} style={s.backBtn}>← SETUP</button>
          <span style={{ fontSize: 10, color: "rgba(255,165,0,0.7)", letterSpacing: 1 }}>⬡ HAIKU</span>
          <div style={s.topFile}>{fileName}</div>
        </div>

        {/* Approval indicators */}
        <div style={s.charIndicators}>
          {activeChars.map(k => {
            const ch = { ...ALL_CHARS, ...customChars }[k];
            if (!ch) return null;
            const approved = approvals[k];
            const isThinking = thinking === k;
            return (
              <div key={k} style={{
                ...s.indicator,
                borderColor: approved ? ch.color : isThinking ? `${ch.color}88` : "rgba(255,255,255,0.07)",
                boxShadow: approved ? `0 0 14px ${ch.glow}` : isThinking ? `0 0 8px ${ch.glow}` : "none",
                background: approved ? ch.glow : "rgba(255,255,255,0.02)",
              }}>
                {ch.hasPhoto
                  ? <Avatar who={k} size={22} color={ch.color} active={isThinking || approved} approved={approved} />
                  : <div style={{ width: 22, height: 22, borderRadius: "50%", background: ch.color+"33", border: `1px solid ${ch.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: ch.color }}>{ch.name[0]}</div>}
                <span style={{ color: approved ? ch.textColor : isThinking ? ch.textColor : "#aaa", fontSize: 11, letterSpacing: 2 }}>{ch.tag}</span>
                <span style={{ fontSize: 10, color: approved ? ch.color : isThinking ? ch.color : "rgba(255,255,255,0.45)", letterSpacing: 1 }}>
                  {approved ? "✓" : isThinking ? "···" : "—"}
                </span>
              </div>
            );
          })}
        </div>

        {/* KJC Capital logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", marginRight: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2, background: "linear-gradient(135deg, #e8a020, #f5c842, #c07010)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", fontFamily: "inherit" }}>KJC</span>
          <span style={{ width: 1, height: 8, background: "rgba(232,160,32,0.4)" }} />
          <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: 2, color: "#c8900a" }}>CAPITAL</span>
        </div>

        <div style={s.controls}>
          {running ? (
            <>
              <button onClick={() => setPaused(p => !p)} style={{ ...s.ctrlBtn, color: paused ? "#3ee89a" : "#38b8f0", borderColor: paused ? "rgba(62,232,154,0.4)" : "rgba(56,184,240,0.4)" }}>
                {paused ? "▶ RESUME" : "⏸ PAUSE"}
              </button>
              <button onClick={() => {
                runRef.current = false; setRunning(false); setThinking(null); setPaused(false); setPhase("stopped");
              }} style={{ ...s.ctrlBtn, color: "#bbb", borderColor: "rgba(255,255,255,0.2)" }}>■ STOP</button>
            </>
          ) : (
            <button onClick={beginReview} style={{ ...s.ctrlBtn, color: "#e8a020", borderColor: "rgba(232,160,32,0.4)" }}>▶ RESTART</button>
          )}
        </div>
      </div>

      {/* Status strip */}
      <div style={s.statusStrip}>
        <div style={{
          height: "100%",
          width: phase === "done" ? "100%" : phase === "generating" ? "90%" : (phase === "capped" || phase === "stopped") ? "80%" : `${Math.min(80, (messages.length / 15) * 80)}%`,
          background: phase === "done" ? "linear-gradient(90deg, #e8a020, #3ee89a)" : (phase === "capped" || phase === "stopped") ? "linear-gradient(90deg, #f04040, #e8a020)" : "linear-gradient(90deg, #e8a020, #38b8f0)",
          transition: "width 0.8s ease",
        }} />
      </div>

      {/* Phase label */}
      <div style={s.phaseBar}>
        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, letterSpacing: 3 }}>
          {phase === "idle" && "READY"}
          {phase === "debating" && (running ? `DEBATING — ${messages.length} EXCHANGES` : "PAUSED")}
          {phase === "generating" && "✦ GENERATING FIXED CODE..."}
          {phase === "done" && (allApproved ? "✦ CONSENSUS REACHED — 10/10 ACHIEVED" : "✦ FIXED CODE EXPORTED")}
          {phase === "capped" && "⚠ CAP REACHED — CONSENSUS NOT YET MET"}
          {phase === "stopped" && "■ DEBATE STOPPED"}
        </span>
        <button onClick={() => setShowOriginal(p => !p)} style={s.codeToggleBtn}>
          {showOriginal ? "▲ HIDE ORIGINAL" : "▼ VIEW ORIGINAL CODE"}
        </button>
      </div>

      {showOriginal && (
        <div style={s.codePanel}>
          <pre style={s.codePre}>{code}</pre>
        </div>
      )}

      {error && <div style={s.err}>⚠ {error}</div>}


      {/* Feed */}
      <div style={{ ...s.feed, marginLeft: sidebarOpen ? "0" : "auto", marginRight: "auto" }}>
        {messages.length === 0 && !thinking && (
          <div style={s.emptyState}>
            <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.12 }}>◈</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, letterSpacing: 4 }}>INITIALISING</div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const ch = { ...ALL_CHARS, ...customChars }[msg.who] || { name: msg.who, color: "#888", border: "#888", textColor: "#aaa", hasPhoto: false };
          const isLast = idx === messages.length - 1;
          return (
            <div key={msg.id} style={{ ...s.msgRow }}>
              <div style={s.msgGutter}>
                {ch.hasPhoto
                  ? <Avatar who={msg.who} size={44} color={ch.color} approved={approvals[msg.who]} />
                  : <div style={{ width: 44, height: 44, borderRadius: "50%", background: ch.color+"18", border: `2px solid ${approvals[msg.who] ? ch.color : "rgba(255,255,255,0.1)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: ch.color, flexShrink: 0 }}>{ch.name[0]}</div>}
                {!isLast && <div style={{ ...s.msgLine, background: ch.border }} />}
              </div>
              <div style={s.msgContent}>
                <div style={s.msgMeta}>
                  <span style={{ ...s.msgName, color: ch.textColor }}>{ch.name}</span>
                  {msg.rating > 0 && (() => {
                    const rc = msg.rating >= 9 ? "#3ee89a" : msg.rating >= 5 ? "#e8a020" : "#f05050";
                    const rb = msg.rating >= 9 ? "rgba(62,232,154,0.12)" : msg.rating >= 5 ? "rgba(232,160,32,0.12)" : "rgba(240,80,80,0.12)";
                    const rb2 = msg.rating >= 9 ? "rgba(62,232,154,0.3)" : msg.rating >= 5 ? "rgba(232,160,32,0.3)" : "rgba(240,80,80,0.3)";
                    return <span style={{ fontSize: 12, fontWeight: 700, color: rc, fontFamily: "monospace", letterSpacing: 1, padding: "3px 10px", borderRadius: 20, background: rb, border: `1px solid ${rb2}` }}>
                      {msg.rating}/10{approvals[msg.who] ? " ✓" : ""}
                    </span>;
                  })()}
                </div>
                <div style={s.msgText}>{
                  msg.text
                    .replace(/^AGREED:/im, "AGREED:")
                    .replace(/\nRATING:\s*\d+\/10[^\n]*/im, "")
                    .trim()
                }</div>
              </div>
            </div>
          );
        })}

        {/* Thinking */}
        {thinking && (() => {
          const th = { ...ALL_CHARS, ...customChars }[thinking] || { name: thinking, color: "#888", textColor: "#aaa", hasPhoto: false };
          return (
            <div style={{ ...s.msgRow, opacity: 0.65 }}>
              <div style={s.msgGutter}>
                {th.hasPhoto
                  ? <Avatar who={thinking} size={44} color={th.color} active={true} />
                  : <div style={{ width: 44, height: 44, borderRadius: "50%", background: th.color+"18", border: `2px solid ${th.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: th.color, flexShrink: 0 }}>{th.name[0]}</div>}
              </div>
              <div style={s.msgContent}>
                <div style={s.msgMeta}>
                  <span style={{ ...s.msgName, color: th.textColor }}>{th.name}</span>
                </div>
                <div style={{ display: "flex", gap: 5, paddingTop: 6 }}>
                  {[0,1,2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: th.color, animation: `pulse 1.2s ${i*0.2}s ease-in-out infinite` }} />)}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Manually stopped */}
        {phase === "stopped" && (
          <div style={{ margin: "32px 0 16px", padding: "24px 28px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: "#aaa", letterSpacing: 2, marginBottom: 8 }}>■ DEBATE STOPPED</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 14, lineHeight: 1.7 }}>
              Resume where you left off, or export what's been agreed so far.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => beginReview(true)}
                style={{ padding: "8px 18px", background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "#ccc", fontSize: 11, letterSpacing: 2, cursor: "pointer", borderRadius: 3, fontFamily: "inherit" }}>
                ▶ RESUME
              </button>
              <button onClick={async () => { await generateFixedCode(code, msgsRef.current, activeCharsRef.current); }}
                style={{ padding: "8px 18px", background: "#e8a020", border: "none", color: "#000", fontSize: 11, fontWeight: 700, letterSpacing: 2, cursor: "pointer", borderRadius: 3, fontFamily: "inherit" }}>
                EXPORT ANYWAY
              </button>
            </div>
          </div>
        )}

        {/* Cap reached without consensus */}
        {phase === "capped" && (
          <div style={{ margin: "32px 0 16px", padding: "24px 28px", border: "1px solid rgba(240,100,40,0.2)", background: "rgba(240,100,40,0.04)", borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: "#f06428", letterSpacing: 2, marginBottom: 8 }}>⚠ DEBATE CAP REACHED — NOT ALL REVIEWERS AT 9/10</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", marginBottom: 14, lineHeight: 1.7 }}>
              The conversation hit the turn limit before full consensus. You can export the fixed code based on what's been agreed so far, or continue the debate.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={async () => { await generateFixedCode(code, msgsRef.current, activeCharsRef.current); }}
                style={{ padding: "8px 18px", background: "#e8a020", border: "none", color: "#000", fontSize: 11, fontWeight: 700, letterSpacing: 2, cursor: "pointer", borderRadius: 3, fontFamily: "inherit" }}>
                EXPORT ANYWAY
              </button>
              <button onClick={() => beginReview(true)}
                style={{ padding: "8px 18px", background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "#ccc", fontSize: 11, letterSpacing: 2, cursor: "pointer", borderRadius: 3, fontFamily: "inherit" }}>
                CONTINUE DEBATE
              </button>
            </div>
          </div>
        )}

        {/* Generating indicator */}
        {phase === "generating" && (
          <div style={{ margin: "32px 0 16px", padding: "24px 28px", border: "1px solid rgba(232,160,32,0.15)", background: "rgba(232,160,32,0.04)", borderRadius: 12, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[0,1,2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#e8a020", animation: `pulse 1.2s ${i*0.2}s ease-in-out infinite` }} />)}
            </div>
            <span style={{ fontSize: 11, color: "#f5b830", letterSpacing: 3 }}>GENERATING FIXED CODE — APPLYING ALL AGREED IMPROVEMENTS</span>
          </div>
        )}

        {/* Fixed code output */}
        {phase === "done" && fixedCode && (
          <div style={{ margin: "24px 0 40px" }}>
            <div style={s.fixedHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 11, color: "#3ee89a", letterSpacing: 3, fontWeight: 700 }}>✦ FIXED CODE</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {activeChars.map(k => { const ch = { ...ALL_CHARS, ...customChars }[k]; return ch ? <span key={k} style={{ fontSize: 10, color: ch.color }}>★ {ch.tag}</span> : null; })}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowFixed(p => !p)} style={{ ...s.ctrlBtn, fontSize: 9 }}>
                  {showFixed ? "▲ COLLAPSE" : "▼ EXPAND"}
                </button>
                <button onClick={copyCode} style={{ ...s.ctrlBtn, color: copied ? "#3ee89a" : "#e8a020", borderColor: copied ? "rgba(62,232,154,0.4)" : "rgba(232,160,32,0.4)", fontSize: 9 }}>
                  {copied ? "✓ COPIED" : "⎘ COPY CODE"}
                </button>
              </div>
            </div>
            {showFixed && (
              <div style={s.fixedCodeBlock}>
                <pre style={s.fixedCodePre}>{fixedCode}</pre>
              </div>
            )}
          </div>
        )}

        {/* Strategy DNA */}
        {phase === "done" && fixedCode && (
          <div style={{ margin: "0 0 32px" }}>
            {!dnaCard && !generatingDna && (
              <button onClick={() => generateDNA(fixedCode, msgsRef.current)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 22px", background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", width: "100%", justifyContent: "center", transition: "all 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(168,85,247,0.14)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(168,85,247,0.08)"}>
                <span style={{ fontSize: 18 }}>🧬</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#c084fc", letterSpacing: 1 }}>GENERATE STRATEGY DNA</div>
                  <div style={{ fontSize: 11, color: "rgba(192,132,252,0.6)", marginTop: 1 }}>AI analyses your strategy and creates a complete personality profile</div>
                </div>
              </button>
            )}

            {generatingDna && (
              <div style={{ padding: "16px 22px", background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 16, animation: "pulse 1.5s infinite" }}>🧬</span>
                <span style={{ fontSize: 12, color: "rgba(192,132,252,0.8)", letterSpacing: 2 }}>ANALYSING STRATEGY DNA...</span>
              </div>
            )}

            {dnaCard && (
              <div style={{ background: "rgba(168,85,247,0.05)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 12, overflow: "hidden" }}>
                {/* DNA Header */}
                <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(168,85,247,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>🧬</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#c084fc", letterSpacing: 3 }}>STRATEGY DNA</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginTop: 2, fontFamily: "'Bebas Neue', Impact, sans-serif", letterSpacing: 2 }}>{dnaCard.personality}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, padding: "4px 12px", borderRadius: 20, background: dnaCard.risk_profile === "Aggressive" ? "rgba(240,80,80,0.15)" : dnaCard.risk_profile === "Conservative" ? "rgba(62,232,154,0.15)" : "rgba(232,160,32,0.15)", border: `1px solid ${dnaCard.risk_profile === "Aggressive" ? "rgba(240,80,80,0.3)" : dnaCard.risk_profile === "Conservative" ? "rgba(62,232,154,0.3)" : "rgba(232,160,32,0.3)"}`, color: dnaCard.risk_profile === "Aggressive" ? "#f07070" : dnaCard.risk_profile === "Conservative" ? "#3ee89a" : "#e8a020", fontWeight: 600 }}>{dnaCard.risk_profile}</span>
                    <button onClick={() => setDnaCard(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 16, padding: 2 }}>×</button>
                  </div>
                </div>

                {/* Verdict */}
                <div style={{ padding: "16px 22px", borderBottom: "1px solid rgba(168,85,247,0.1)", background: "rgba(168,85,247,0.04)" }}>
                  <div style={{ fontSize: 10, color: "rgba(192,132,252,0.6)", letterSpacing: 3, marginBottom: 6 }}>VERDICT</div>
                  <div style={{ fontSize: 15, color: "#fff", fontStyle: "italic", lineHeight: 1.6 }}>"{dnaCard.verdict}"</div>
                </div>

                {/* Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "rgba(168,85,247,0.1)" }}>
                  {[
                    { label: "CORE EDGE", value: dnaCard.edge, icon: "⚡" },
                    { label: "PERSONALITY", value: dnaCard.personality_desc, icon: "🎯" },
                    { label: "BEST CONDITIONS", value: dnaCard.best_conditions, icon: "✅" },
                    { label: "WORST CONDITIONS", value: dnaCard.worst_conditions, icon: "⚠️" },
                  ].map(({ label, value, icon }) => (
                    <div key={label} style={{ padding: "14px 18px", background: "rgba(10,10,15,0.9)" }}>
                      <div style={{ fontSize: 9, color: "rgba(192,132,252,0.6)", letterSpacing: 2, marginBottom: 6 }}>{icon} {label}</div>
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Strengths & Weaknesses */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "rgba(168,85,247,0.1)" }}>
                  <div style={{ padding: "14px 18px", background: "rgba(10,10,15,0.9)" }}>
                    <div style={{ fontSize: 9, color: "rgba(62,232,154,0.7)", letterSpacing: 2, marginBottom: 8 }}>💪 STRENGTHS</div>
                    {(dnaCard.strengths || []).map((s, i) => (
                      <div key={i} style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", marginBottom: 4, display: "flex", gap: 6 }}>
                        <span style={{ color: "#3ee89a", flexShrink: 0 }}>+</span>{s}
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: "14px 18px", background: "rgba(10,10,15,0.9)" }}>
                    <div style={{ fontSize: 9, color: "rgba(240,100,100,0.7)", letterSpacing: 2, marginBottom: 8 }}>⚡ WEAKNESSES</div>
                    {(dnaCard.weaknesses || []).map((w, i) => (
                      <div key={i} style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", marginBottom: 4, display: "flex", gap: 6 }}>
                        <span style={{ color: "#f07070", flexShrink: 0 }}>−</span>{w}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Regenerate */}
                <div style={{ padding: "12px 22px", borderTop: "1px solid rgba(168,85,247,0.1)", display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={() => generateDNA(fixedCode, msgsRef.current)}
                    style={{ fontSize: 10, color: "rgba(192,132,252,0.6)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", letterSpacing: 1 }}>
                    ↻ Regenerate DNA
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div ref={endRef} style={{ height: 20 }} />
      </div>

      <style>{css}</style>
    </div>
  );
}

function GridBg() {
  return (
    <div style={{
      position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
      background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(232,160,32,0.04) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(56,184,240,0.03) 0%, transparent 60%)",
    }} />
  );
}

const s = {
  // ── Root ──
  root: { minHeight: "100vh", background: "#0a0a0f", color: "#fff", display: "flex", flexDirection: "column", position: "relative", fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif", overflowY: "auto", overflowX: "hidden", maxWidth: "100vw" },

  // ── Setup ──
  setupWrap: { position: "relative", zIndex: 1, width: "100%", boxSizing: "border-box" },
  logo: { marginBottom: 56, textAlign: "center" },
  logoLine: { display: "flex", gap: 14, justifyContent: "center", alignItems: "baseline", marginBottom: 10 },
  logoText: { fontSize: "clamp(24px, 8vw, 36px)", fontWeight: 800, letterSpacing: 6, color: "#fff" },
  logoAccent: { fontSize: "clamp(24px, 8vw, 36px)", fontWeight: 800, letterSpacing: 6, color: "#e8a020" },
  logoSub: { fontSize: "clamp(9px, 2vw, 12px)", letterSpacing: "clamp(2px, 1vw, 5px)", color: "rgba(255,255,255,0.55)", fontWeight: 400 },

  charCard: { flex: 1, maxWidth: 200, padding: "22px 16px", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, textAlign: "center", background: "rgba(255,255,255,0.02)" },
  charAvatar: { fontSize: 22, marginBottom: 10 },
  charName: { fontSize: 13, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 },
  charTag: { fontSize: 9, letterSpacing: 4, opacity: 0.5 },

  uploadSection: { marginBottom: 32 },
  sectionLabel: { fontSize: 10, letterSpacing: 4, color: "rgba(255,255,255,0.7)", marginBottom: 12, fontWeight: 600 },
  dropZone: { display: "block", width: "100%", padding: "32px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: 10, cursor: "pointer", transition: "all 0.2s", textAlign: "center", position: "relative", background: "rgba(255,255,255,0.01)" },
  fileInput: { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 0 },

  cta: { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "18px 32px", background: "linear-gradient(135deg, #e8a020, #c07010)", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700, letterSpacing: 3, color: "#000", fontFamily: "inherit", boxShadow: "0 4px 24px rgba(232,160,32,0.25)" },

  // ── Review top bar ──
  topBar: { position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(10,10,15,0.98)", backdropFilter: "blur(20px)", flexWrap: "wrap", gap: 6, minHeight: 48 },
  topLeft: { display: "flex", alignItems: "center", gap: 18 },
  backBtn: { background: "none", border: "none", color: "rgba(255,255,255,0.65)", fontSize: 12, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit", padding: 0, fontWeight: 500 },
  topFile: { fontSize: 13, color: "rgba(255,255,255,0.65)", fontWeight: 400 },

  charIndicators: { display: "flex", gap: 6, flexWrap: "wrap" },
  indicator: { display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 20, transition: "all 0.35s", background: "rgba(255,255,255,0.02)" },

  controls: { display: "flex", gap: 8 },
  ctrlBtn: { padding: "7px 16px", background: "transparent", border: "1px solid rgba(255,255,255,0.12)", fontSize: 11, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit", borderRadius: 8, transition: "all 0.2s", color: "#ccc", fontWeight: 500 },

  statusStrip: { height: 3, background: "rgba(255,255,255,0.04)", position: "relative", zIndex: 2, overflow: "hidden" },
  phaseBar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 28px", borderBottom: "1px solid rgba(255,255,255,0.04)", position: "relative", zIndex: 2 },
  codeToggleBtn: { background: "transparent", border: "none", color: "rgba(255,255,255,0.55)", fontSize: 11, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit", fontWeight: 500 },

  codePanel: { background: "#06060d", borderBottom: "1px solid rgba(255,255,255,0.04)", maxHeight: 220, overflowY: "auto", position: "relative", zIndex: 2 },
  codePre: { margin: 0, padding: "12px 16px", fontSize: "clamp(10px, 2.5vw, 12px)", color: "rgba(255,255,255,0.75)", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'Fira Code', 'Courier New', monospace" },

  // ── Feed ──
  feed: { flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "16px 12px 0", position: "relative", zIndex: 1, maxWidth: "860px", width: "100%", margin: "0 auto", alignSelf: "center", boxSizing: "border-box", minWidth: 0 },
  emptyState: { textAlign: "center", padding: "80px 0" },

  msgRow: { display: "flex", gap: 12, marginBottom: 24, animation: "fadeUp 0.35s ease forwards", minWidth: 0, overflow: "hidden" },
  msgGutter: { display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 44 },
  msgAvatar: { width: 44, height: 44, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "rgba(255,255,255,0.02)", overflow: "hidden", transition: "all 0.4s" },
  msgLine: { width: 1, flex: 1, marginTop: 8, opacity: 0.1, minHeight: 20, background: "rgba(255,255,255,0.2)" },
  msgContent: { flex: 1, paddingTop: 6, minWidth: 0, overflow: "hidden" },
  msgMeta: { display: "flex", alignItems: "center", gap: 12, marginBottom: 10 },
  msgName: { fontSize: 14, fontWeight: 700, letterSpacing: 0.5, color: "#fff" },
  msgText: { fontSize: 15, lineHeight: 1.9, color: "rgba(255,255,255,0.92)", fontFamily: "'Georgia', 'Times New Roman', serif", whiteSpace: "pre-wrap" },

  // ── Fixed code ──
  fixedHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", background: "rgba(62,232,154,0.06)", border: "1px solid rgba(62,232,154,0.18)", borderRadius: "12px 12px 0 0", flexWrap: "wrap", gap: 10 },
  fixedCodeBlock: { border: "1px solid rgba(62,232,154,0.12)", borderTop: "none", borderRadius: "0 0 12px 12px", background: "#04080a", maxHeight: "clamp(300px, 60vh, 900px)", overflowY: "auto", WebkitOverflowScrolling: "touch" },
  fixedCodePre: { margin: 0, padding: "clamp(12px, 3vw, 22px) clamp(14px, 3vw, 26px)", fontSize: "clamp(10px, 2.5vw, 12.5px)", color: "rgba(62,232,154,0.75)", lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word", fontFamily: "'Fira Code', 'Courier New', monospace" },

  err: { padding: "12px 28px", background: "rgba(220,50,50,0.06)", borderBottom: "1px solid rgba(220,50,50,0.15)", fontSize: 13, color: "#f07070", position: "relative", zIndex: 2 },
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bebas+Neue&display=swap');
  @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pulse  { 0%,100%{opacity:0.2;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }

  *, *::before, *::after { box-sizing: border-box; }

  html {
    overflow-x: hidden;
    max-width: 100%;
    -webkit-text-size-adjust: 100%;
  }

  body {
    overflow-x: hidden;
    max-width: 100vw;
    position: relative;
  }

  /* Prevent ANY element causing horizontal scroll */
  #__next, #__next > * {
    max-width: 100vw;
    overflow-x: hidden;
  }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
  button:hover { opacity: 0.8; }

  /* Prevent iOS zoom on input focus */
  input, textarea, select {
    font-size: 16px !important;
  }

  input::placeholder { color: rgba(255,255,255,0.25) !important; }
  textarea::placeholder { color: rgba(255,255,255,0.25) !important; }
  select option { background: #0c0c14; }

  /* ── Tablet (768px) ── */
  @media (max-width: 768px) {
    /* Shrink top bar */
    .top-bar { padding: 8px 12px !important; }
    /* Smaller indicators */
    .indicator-tag { font-size: 9px !important; }
    .indicator-rating { font-size: 9px !important; }
  }

  /* ── Mobile (480px — iPhone SE, 13 mini) ── */
  @media (max-width: 480px) {
    /* Hide filename — no room */
    .top-filename { display: none !important; }
    /* Smaller control buttons */
    .ctrl-btn { padding: 5px 10px !important; font-size: 10px !important; letter-spacing: 0 !important; }
    /* Phase bar */
    .phase-bar { padding: 5px 12px !important; font-size: 9px !important; }
    /* Feed */
    .msg-name { font-size: 12px !important; }
    /* Setup screen */
    .logo-text, .logo-accent { font-size: 28px !important; letter-spacing: 4px !important; }
    .section-label { font-size: 9px !important; letter-spacing: 2px !important; }
    /* Reviewer cards — ensure no overflow */
    .reviewer-row { flex-wrap: wrap !important; }
    .specialty-pill { font-size: 10px !important; }
    /* Banner buttons */
    .banner-actions { flex-direction: column !important; }
    .banner-actions button { width: 100% !important; }
    /* Fixed code */
    .fixed-code-pre { font-size: 10px !important; padding: 12px !important; }
    /* Code panel */
    .code-pre { font-size: 10px !important; padding: 12px !important; }
  }

  /* ── DNA Library — full width on mobile ── */
  @media (max-width: 860px) {
    .dna-col { flex: 0 0 100% !important; width: 100% !important; padding-top: 0 !important; }
  }

  /* ── Small phones (375px — iPhone SE 2nd gen) ── */
  @media (max-width: 380px) {
    .char-indicators { display: none !important; }
    .ctrl-btn { padding: 5px 8px !important; font-size: 9px !important; }
  }
`;


// ─── Session Sidebar ──────────────────────────────────────────────────────────
// ─── Profile Modal ───────────────────────────────────────────────────────────
function ProfileModal({ profile, onClose, onSignOut }) {
  const [photo, setPhoto] = useState(() => {
    try { return localStorage.getItem("kjc_profile_photo") || null; } catch { return null; }
  });

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setPhoto(ev.target.result);
      try { localStorage.setItem("kjc_profile_photo", ev.target.result); } catch {}
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removePhoto = () => {
    setPhoto(null);
    try { localStorage.removeItem("kjc_profile_photo"); } catch {}
  };

  const ff = "'Inter', 'SF Pro Display', system-ui, sans-serif";
  const ffTitle = "'Bebas Neue', 'Impact', system-ui, sans-serif";

  const fields = [
    { label: "FIRST NAME", value: profile?.first_name },
    { label: "LAST NAME", value: profile?.last_name },
    { label: "USERNAME", value: `@${profile?.username}` },
    { label: "DATE OF BIRTH", value: profile?.dob ? new Date(profile.dob).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—" },
    { label: "MEMBER SINCE", value: profile?.created_at ? new Date(profile.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 16px", backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div style={{ background: "linear-gradient(160deg, #0e0e1c 0%, #08080f 100%)", border: "1px solid rgba(232,160,32,0.2)", borderRadius: 20, padding: "0", maxWidth: 420, width: "100%", boxShadow: "0 30px 80px rgba(0,0,0,0.7), 0 0 60px rgba(232,160,32,0.05)", overflow: "hidden", fontFamily: ff }} onClick={e => e.stopPropagation()}>

        {/* Gold header bar */}
        <div style={{ height: 3, background: "linear-gradient(90deg, #e8a020, #f5c842, #c07010)" }} />

        {/* Header */}
        <div style={{ padding: "28px 28px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 18 }}>
          {/* Avatar */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", overflow: "hidden", border: "2px solid rgba(232,160,32,0.5)", background: "rgba(232,160,32,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, color: "#e8a020", fontFamily: ffTitle, letterSpacing: 1 }}>
              {photo ? <img src={photo} alt="profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : profile?.first_name?.[0]?.toUpperCase() || "?"}
            </div>
            <label htmlFor="profile-photo-input" style={{ position: "absolute", bottom: -2, right: -2, width: 24, height: 24, borderRadius: "50%", background: "#e8a020", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11, boxShadow: "0 2px 8px rgba(0,0,0,0.5)", border: "2px solid #0e0e1c" }}>📷</label>
            <input id="profile-photo-input" type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />
          </div>

          {/* Name block */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: 0.5, fontFamily: ff, lineHeight: 1.2, marginBottom: 4 }}>
              {profile?.first_name} {profile?.last_name}
            </div>
            <div style={{ fontSize: 13, color: "#e8a020", fontWeight: 600, letterSpacing: 1 }}>@{profile?.username}</div>
            {photo && (
              <button onClick={removePhoto} style={{ marginTop: 6, fontSize: 11, color: "rgba(255,255,255,0.3)", background: "none", border: "none", cursor: "pointer", fontFamily: ff, padding: 0, letterSpacing: 0.5 }}>Remove photo</button>
            )}
          </div>

          {/* KJC badge */}
          <div style={{ flexShrink: 0, textAlign: "right" }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 3, background: "linear-gradient(135deg, #e8a020, #f5c842)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontFamily: ffTitle }}>KJC</div>
            <div style={{ fontSize: 8, letterSpacing: 3, color: "#c8900a", fontWeight: 700 }}>CAPITAL</div>
          </div>
        </div>

        {/* Detail rows */}
        <div style={{ padding: "16px 28px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(232,160,32,0.6)", letterSpacing: 4, marginBottom: 12, fontFamily: ffTitle }}>PROFILE DETAILS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fields.map(({ label, value }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: 2, fontWeight: 700, fontFamily: ffTitle }}>{label}</span>
                <span style={{ fontSize: 15, color: "#fff", fontWeight: 600, fontFamily: ff, letterSpacing: 0.3 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div style={{ padding: "0 28px 28px", display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "13px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: ff, fontWeight: 700, letterSpacing: 2 }}>CLOSE</button>
          <button onClick={onSignOut} style={{ flex: 1, padding: "13px", background: "rgba(240,80,80,0.08)", border: "1px solid rgba(240,80,80,0.25)", borderRadius: 10, color: "#f07070", fontSize: 12, cursor: "pointer", fontFamily: ff, fontWeight: 700, letterSpacing: 2 }}>SIGN OUT</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({ sessions, onLoad, onDelete, onNew, profile, onSignOut, currentSessionId, onCollapsedChange, collapsed, setCollapsed: setCollapsedExternal }) {
  const [internalCollapsed, setInternalCollapsed] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  const isCollapsed = collapsed !== undefined ? collapsed : internalCollapsed;
  const toggleCollapsed = () => {
    const newVal = !isCollapsed;
    if (setCollapsedExternal) setCollapsedExternal(newVal);
    else setInternalCollapsed(newVal);
    if (onCollapsedChange) onCollapsedChange(newVal);
  };
  const [showProfile, setShowProfile] = useState(false);
  const [folders, setFolders] = useState(() => {
    try { return JSON.parse(localStorage.getItem("kjc_folders") || "{}"); } catch { return {}; }
  });
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [openFolders, setOpenFolders] = useState({});
  const [dragOver, setDragOver] = useState(null);

  const saveFolders = (f) => {
    setFolders(f);
    try { localStorage.setItem("kjc_folders", JSON.stringify(f)); } catch {}
  };

  const createFolder = () => {
    if (!newFolderName.trim()) return;
    const id = Date.now().toString();
    saveFolders({ ...folders, [id]: { name: newFolderName.trim(), sessions: [] } });
    setNewFolderName("");
    setShowNewFolder(false);
    setOpenFolders(p => ({ ...p, [id]: true }));
  };

  const addToFolder = (folderId, sessionId) => {
    const updated = { ...folders };
    Object.keys(updated).forEach(fid => {
      updated[fid].sessions = updated[fid].sessions.filter(s => s !== sessionId);
    });
    updated[folderId].sessions = [...(updated[folderId].sessions || []), sessionId];
    saveFolders(updated);
  };

  const removeFromFolder = (folderId, sessionId) => {
    const updated = { ...folders };
    updated[folderId].sessions = updated[folderId].sessions.filter(s => s !== sessionId);
    saveFolders(updated);
  };

  const deleteFolder = (folderId) => {
    const updated = { ...folders };
    delete updated[folderId];
    saveFolders(updated);
  };

  // Sessions not in any folder
  const folderedIds = new Set(Object.values(folders).flatMap(f => f.sessions || []));
  const unfoldered = sessions.filter(s => !folderedIds.has(s.id));

  const SessionItem = ({ s, folderId }) => (
    <div
      draggable
      onDragStart={e => e.dataTransfer.setData("sessionId", s.id)}
      onClick={() => onLoad(s)}
      style={{ padding: "8px 10px", borderRadius: 7, marginBottom: 2, cursor: "pointer", background: currentSessionId === s.id ? "rgba(232,160,32,0.1)" : "transparent", border: `1px solid ${currentSessionId === s.id ? "rgba(232,160,32,0.25)" : "transparent"}`, display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s" }}
      onMouseEnter={e => { if (currentSessionId !== s.id) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      onMouseLeave={e => { if (currentSessionId !== s.id) e.currentTarget.style.background = "transparent"; }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: currentSessionId === s.id ? "#e8a020" : "rgba(255,255,255,0.2)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: currentSessionId === s.id ? "#e8a020" : "#f0f0f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif", letterSpacing: 0.2 }}>
          {s.title || s.file_name || "Untitled"}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2, fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: 0.3 }}>
          {new Date(s.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </div>
      </div>
      <button onClick={e => { e.stopPropagation(); folderId ? removeFromFolder(folderId, s.id) : onDelete(s.id); }}
        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.15)", cursor: "pointer", fontSize: 14, padding: "2px 4px", lineHeight: 1, flexShrink: 0, borderRadius: 4 }}
        onMouseEnter={e => e.currentTarget.style.color = "#f07070"}
        onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.15)"}>×</button>
    </div>
  );

  return (
    <>
      {showProfile && <ProfileModal profile={profile} onClose={() => setShowProfile(false)} onSignOut={onSignOut} />}
      <div style={{ width: 280, minWidth: 280, height: "100vh", background: "#08080e", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)", overflow: "hidden", position: "fixed", left: 0, top: 0, zIndex: 200, flexShrink: 0, transform: isCollapsed ? "translateX(-100%)" : "translateX(0)", boxShadow: isCollapsed ? "none" : "4px 0 24px rgba(0,0,0,0.5)" }}>

        {/* Header — hamburger is the only toggle */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: 3, fontFamily: "'Inter', system-ui, sans-serif" }}>REVIEWS</span>
          <button onClick={toggleCollapsed} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 2px", display: "flex", flexDirection: "column", gap: 4, lineHeight: 1 }}>
            <span style={{ display: "block", width: 16, height: 2, background: "rgba(255,255,255,0.5)", borderRadius: 2 }} />
            <span style={{ display: "block", width: 16, height: 2, background: "rgba(255,255,255,0.5)", borderRadius: 2 }} />
            <span style={{ display: "block", width: 16, height: 2, background: "rgba(255,255,255,0.5)", borderRadius: 2 }} />
          </button>
        </div>

        {true && (
          <>
            {/* Actions row */}
            <div style={{ padding: "10px 12px 6px", display: "flex", gap: 6, flexShrink: 0 }}>
              <button onClick={onNew} style={{ flex: 1, padding: "9px 10px", background: "rgba(232,160,32,0.12)", border: "1px solid rgba(232,160,32,0.25)", borderRadius: 7, color: "#e8a020", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Bebas Neue', 'Impact', system-ui, sans-serif", letterSpacing: 2 }}>
                + NEW REVIEW
              </button>
              <button onClick={() => setShowNewFolder(p => !p)} title="New Folder" style={{ padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, color: "rgba(255,255,255,0.5)", fontSize: 14, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}>
                📁
              </button>
            </div>

            {/* New folder input */}
            {showNewFolder && (
              <div style={{ padding: "0 12px 8px", display: "flex", gap: 6, flexShrink: 0 }}>
                <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === "Enter" && createFolder()}
                  placeholder="Folder name..." autoFocus
                  style={{ flex: 1, padding: "7px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, color: "#fff", fontSize: 12, outline: "none", fontFamily: "inherit" }} />
                <button onClick={createFolder} style={{ padding: "7px 10px", background: "rgba(232,160,32,0.15)", border: "1px solid rgba(232,160,32,0.25)", borderRadius: 7, color: "#e8a020", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>✓</button>
              </div>
            )}

            {/* Sessions + Folders list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 8px" }}>

              {/* Folders */}
              {Object.entries(folders).map(([fid, folder]) => {
                const folderSessions = (folder.sessions || []).map(sid => sessions.find(s => s.id === sid)).filter(Boolean);
                const isOpen = openFolders[fid];
                return (
                  <div key={fid}
                    onDragOver={e => { e.preventDefault(); setDragOver(fid); }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={e => { e.preventDefault(); setDragOver(null); addToFolder(fid, e.dataTransfer.getData("sessionId")); }}
                    style={{ marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 8px", borderRadius: 7, cursor: "pointer", background: dragOver === fid ? "rgba(232,160,32,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${dragOver === fid ? "rgba(232,160,32,0.3)" : "rgba(255,255,255,0.06)"}`, transition: "all 0.15s" }}
                      onClick={() => setOpenFolders(p => ({ ...p, [fid]: !p[fid] }))}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1 }}>{isOpen ? "▾" : "▸"}</span>
                      <span style={{ fontSize: 11 }}>📁</span>
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{folder.name}</span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginRight: 2 }}>{folderSessions.length}</span>
                      <button onClick={e => { e.stopPropagation(); deleteFolder(fid); }}
                        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.15)", cursor: "pointer", fontSize: 12, padding: "1px 3px", lineHeight: 1, borderRadius: 3 }}
                        onMouseEnter={e => e.currentTarget.style.color = "#f07070"}
                        onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.15)"}>×</button>
                    </div>
                    {isOpen && (
                      <div style={{ marginLeft: 14, marginTop: 2 }}>
                        {folderSessions.length === 0
                          ? <div style={{ padding: "6px 10px", fontSize: 11, color: "rgba(255,255,255,0.2)", fontStyle: "italic" }}>Drop reviews here</div>
                          : folderSessions.map(s => <SessionItem key={s.id} s={s} folderId={fid} />)}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Unfoldered sessions */}
              {unfoldered.length === 0 && Object.keys(folders).length === 0 ? (
                <div style={{ padding: "24px 8px", textAlign: "center", lineHeight: 1.9 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.85)", marginBottom: 4, fontFamily: "'Inter', system-ui, sans-serif" }}>No reviews yet.</div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 6, fontFamily: "'Inter', system-ui, sans-serif" }}>Start a review to save it here.</div>
                  <div style={{ fontSize: 15, color: "#e8a020", fontWeight: 700, letterSpacing: 1, fontFamily: "'Bebas Neue', 'Impact', 'Anton', system-ui, sans-serif" }}>DON'T SLACK G</div>
                </div>
              ) : (
                unfoldered.map(s => <SessionItem key={s.id} s={s} folderId={null} />)
              )}
            </div>

            {/* Profile footer */}
            <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.05)", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
              <div onClick={() => setShowProfile(true)} style={{ width: 34, height: 34, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(232,160,32,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#e8a020", flexShrink: 0, cursor: "pointer", transition: "all 0.2s", background: "rgba(232,160,32,0.15)" }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "0 0 10px rgba(232,160,32,0.3)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
                {(() => { try { const p = localStorage.getItem("kjc_profile_photo"); return p ? <img src={p} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : profile?.first_name?.[0]?.toUpperCase() || "?"; } catch { return profile?.first_name?.[0]?.toUpperCase() || "?"; } })()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'Inter', system-ui, sans-serif" }}>
                  {profile?.first_name} {profile?.last_name}
                </div>
                <div style={{ fontSize: 11, color: "#e8a020", marginTop: 2, fontWeight: 500, fontFamily: "'Inter', system-ui, sans-serif" }}>@{profile?.username}</div>
              </div>
              <button onClick={onSignOut}
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.28)", cursor: "pointer", fontSize: 11, padding: "4px 6px", fontFamily: "inherit", borderRadius: 5, letterSpacing: 0.5 }}
                onMouseEnter={e => { e.currentTarget.style.color = "#f07070"; e.currentTarget.style.background = "rgba(240,80,80,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.28)"; e.currentTarget.style.background = "none"; }}>
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Main app wrapper with auth ───────────────────────────────────────────────
export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [loadedSession, setLoadedSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true); // always starts closed

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { setAuthLoading(false); router.push("/auth"); return; }
      setUser(session.user);
      loadProfile(session.user.id, session.access_token);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") { router.push("/auth"); }
      if (session) { setUser(session.user); loadProfile(session.user.id, session.access_token); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId, token) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data);
    loadSessions(token);
    setAuthLoading(false);
  };

  const loadSessions = async (token) => {
    const { data: { session } } = await supabase.auth.getSession();
    const t = token || session?.access_token;
    if (!t) return;
    const res = await fetch("/api/sessions", { headers: { Authorization: `Bearer ${t}` } });
    if (res.ok) setSessions(await res.json());
  };

  const saveSession = async (sessionData) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ ...sessionData, id: currentSessionId }),
    });
    if (res.ok) {
      const saved = await res.json();
      if (!currentSessionId) setCurrentSessionId(saved.id);
      loadSessions();
    }
  };

  const deleteSession = async (id) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`/api/sessions?id=${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.access_token}` } });
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) { setCurrentSessionId(null); setLoadedSession(null); }
  };

  const handleLoadSession = (s) => {
    setCurrentSessionId(s.id);
    setLoadedSession(s);
  };

  const handleNewSession = () => {
    setCurrentSessionId(null);
    setLoadedSession(null);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", letterSpacing: 3, fontFamily: "monospace" }}>LOADING...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <>
      <Head>
        <title>KJC Capital — Code Review Arena</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#0a0a0f", position: "relative" }}>

        {/* Overlay backdrop on mobile when sidebar open */}
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
            sessions={sessions}
            onLoadSession={handleLoadSession}
            onNewSession={handleNewSession}
            onSignOut={handleSignOut}
            loadedSession={loadedSession}
            currentSessionId={currentSessionId}
            onOpenSidebar={() => setSidebarCollapsed(false)}
            sidebarOpen={!sidebarCollapsed}
          />
        </div>
      </div>
    </>
  );
}
