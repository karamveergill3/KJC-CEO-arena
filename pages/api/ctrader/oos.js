export default async function handler(req, res) {
  const { token, months = 3 } = req.query;
  if (!token) return res.status(401).json({ error: "No token" });

  const proxyUrl = process.env.CTRADER_PROXY_URL;
  if (!proxyUrl) return res.status(500).json({ error: "CTRADER_PROXY_URL not set" });

  try {
    const response = await fetch(`${proxyUrl}/oos?token=${encodeURIComponent(token)}&months=${months}`);
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "Proxy failed: " + e.message });
  }
}
