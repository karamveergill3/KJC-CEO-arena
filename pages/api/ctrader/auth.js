// pages/api/ctrader/auth.js
export default function handler(req, res) {
  const clientId = process.env.CTRADER_CLIENT_ID;
  const redirectUri = process.env.CTRADER_REDIRECT_URI || "https://ceoarena.vercel.app/api/ctrader/callback";
  const authUrl = `https://connect.spotware.com/apps/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=accounts`;
  res.redirect(authUrl);
}
