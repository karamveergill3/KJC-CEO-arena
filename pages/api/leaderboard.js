import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace("Bearer ", "");

  if (req.method === "GET") {
    try {
      const { data: entries, error } = await supabase
        .from("leaderboard")
        .select("*")
        .eq("approved", true)
        .order("score", { ascending: false })
        .limit(100);

      if (error) throw error;

      let mine = null;
      if (token) {
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          mine = entries?.find(e => e.user_id === user.id) || null;
        }
      }

      return res.status(200).json({ entries: entries || [], mine });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const { strategy_name, win_rate, profit_factor, trade_count, drawdown, instrument_type, characters } = req.body;

      // Validate green verdict minimums
      if (!win_rate || win_rate < 60) return res.status(400).json({ error: "Win rate must be >= 60%" });
      if (!profit_factor || profit_factor < 1.5) return res.status(400).json({ error: "Profit factor must be >= 1.5" });
      if (!trade_count || trade_count < 60) return res.status(400).json({ error: "Trade count must be >= 60" });
      if (!drawdown || drawdown > 15) return res.status(400).json({ error: "Drawdown must be <= 15%" });

      const score = Math.round((profit_factor * 40) + (win_rate * 25) + (Math.min(trade_count / 60, 1) * 20) + ((1 - drawdown / 30) * 15));

      // Upsert — one entry per user
      const { error } = await supabase.from("leaderboard").upsert({
        user_id: user.id,
        strategy_name: strategy_name || "Anonymous Strategy",
        win_rate, profit_factor, trade_count, drawdown,
        instrument_type: instrument_type || "unknown",
        characters: characters || [],
        score,
        approved: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      if (error) throw error;
      return res.status(200).json({ ok: true, score });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
