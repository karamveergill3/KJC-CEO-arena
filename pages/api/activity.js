import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // GET — fetch recent activity
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("activity")
      .select("username, file_name, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  // POST — log activity (requires auth)
  if (req.method === "POST") {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

    // Get username from profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    const { status, file_name } = req.body;

    // Upsert — one row per user, updated on each action
    const { error } = await supabase
      .from("activity")
      .upsert({
        user_id: user.id,
        username: profile?.username || "unknown",
        file_name: file_name || "Unknown",
        status,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
