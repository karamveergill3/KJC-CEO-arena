import { createClient } from '@supabase/supabase-js';

const FOREX_FACTORY_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const response = await fetch(FOREX_FACTORY_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.forexfactory.com/',
        'Origin': 'https://www.forexfactory.com',
      },
    });

    if (!response.ok) {
      console.error('FF fetch failed:', response.status, response.statusText);
      return res.status(200).json([]);
    }

    const raw = await response.json();
    console.log('FF raw count:', raw.length);
    console.log('FF sample:', JSON.stringify(raw[0]));

    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    // Get all high impact events - be very lenient
    const events = raw.filter(e => {
      const impact = (e.impact || '').toLowerCase().trim();
      return impact === 'high';
    }).map(e => {
      // Parse FF date/time - format is "YYYY-MM-DDThh:mmaa" or similar
      let eventTime = null;
      try {
        // FF time format examples: "8:30am", "1:30pm", "All Day"
        const timeStr = e.time || '';
        const dateStr = e.date || '';
        if (dateStr && timeStr && timeStr !== 'All Day' && timeStr !== 'Tentative') {
          const [datePart] = dateStr.split('T');
          // Convert 12h to 24h
          const match = timeStr.match(/(\d+):(\d+)(am|pm)/i);
          if (match) {
            let h = parseInt(match[1]);
            const m = parseInt(match[2]);
            const ampm = match[3].toLowerCase();
            if (ampm === 'pm' && h !== 12) h += 12;
            if (ampm === 'am' && h === 12) h = 0;
            eventTime = new Date(`${datePart}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`);
          }
        }
        if (!eventTime) eventTime = new Date(dateStr);
      } catch(err) {
        eventTime = new Date(e.date);
      }
      return { ...e, parsedTime: eventTime };
    }).filter(e => {
      if (!e.parsedTime || isNaN(e.parsedTime)) return false;
      return e.parsedTime >= new Date(now.getTime() - 60*60*1000) && e.parsedTime <= in48h;
    }).sort((a, b) => a.parsedTime - b.parsedTime)
    .map(({ parsedTime, ...e }) => ({
      title: e.title,
      country: e.country,
      date: e.date,
      time: e.time,
      impact: e.impact,
      forecast: e.forecast,
      previous: e.previous,
      actual: e.actual,
    }));

    console.log('Filtered high impact events:', events.length);
    return res.status(200).json(events);

  } catch(e) {
    console.error('Calendar error:', e.message);
    return res.status(200).json([]);
  }
}
