export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const response = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, */*',
        'Referer': 'https://www.forexfactory.com/',
        'Origin': 'https://www.forexfactory.com',
      },
    });

    if (!response.ok) return res.status(200).json([]);

    const raw = await response.json();
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const events = raw
      .filter(e => {
        if ((e.impact || '').toLowerCase() !== 'high') return false;
        const t = new Date(e.date);
        return !isNaN(t) && t >= new Date(now.getTime() - 3600000) && t <= in48h;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(e => ({
        title: e.title,
        country: e.country,
        date: e.date,
        impact: e.impact,
        forecast: e.forecast,
        previous: e.previous,
        actual: e.actual,
      }));

    return res.status(200).json(events);
  } catch(e) {
    console.error('Calendar error:', e.message);
    return res.status(200).json([]);
  }
}
