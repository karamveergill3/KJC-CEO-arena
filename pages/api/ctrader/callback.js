// pages/api/ctrader/callback.js
export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "No code" });

  const clientId = process.env.CTRADER_CLIENT_ID;
  const clientSecret = process.env.CTRADER_CLIENT_SECRET;
  const redirectUri = process.env.CTRADER_REDIRECT_URI || "https://ceoarena.vercel.app/api/ctrader/callback";

  try {
    const tokenRes = await fetch("https://connect.spotware.com/apps/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) return res.status(400).json({ error: tokenData });

    // Redirect back to app with token in query (stored client-side)
    res.redirect(`/?ctrader_token=${tokenData.access_token}&expires_in=${tokenData.expires_in}`);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
