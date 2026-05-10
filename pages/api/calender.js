import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FOREX_FACTORY_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const CACHE_KEY = 'ff_calendar_cache';
const REFRESH_HOURS = 12;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') {
    try {
      // Check cache in Supabase
      const now = new Date();
      let events;

      {
        // Always fetch fresh - cache was causing stale empty results
        const response = await fetch(FOREX_FACTORY_URL, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          return res.status(200).json([]);
        }

        const raw = await response.json();

        // Filter high impact only, next 48 hours
        const cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000);
        events = raw
          .filter(e => {
            const impact = (e.impact || '').toLowerCase();
            const isHigh = impact === 'high';
            // FF returns dates like "2026-05-12" and times like "1:30pm"
            // Be lenient — include all high impact events for the next 2 days
            if (!isHigh) return false;
            try {
              const eventDate = new Date(e.date);
              const dayDiff = (eventDate - new Date(now.toDateString())) / (1000 * 60 * 60 * 24);
              return dayDiff >= 0 && dayDiff <= 2;
            } catch { return true; }
          })
          .map(e => ({
            title: e.title,
            country: e.country,
            date: e.date,
            time: e.time,
            impact: e.impact,
            forecast: e.forecast,
            previous: e.previous,
          }))
          .sort((a, b) => new Date(a.date) - new Date(b.date));

      }

      return res.status(200).json(events);
    } catch (e) {
      console.error('Calendar error:', e);
      return res.status(200).json([]);
    }
  }

  res.status(405).end();
}
