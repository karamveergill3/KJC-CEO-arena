import { createClient } from '@supabase/supabase-js';

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
      const { data: cached } = await supabase
        .from('calendar_cache')
        .select('*')
        .eq('key', CACHE_KEY)
        .single();

      const now = new Date();
      const cacheAge = cached
        ? (now - new Date(cached.updated_at)) / 1000 / 3600
        : 999;

      let events;

      if (cached && cacheAge < REFRESH_HOURS) {
        events = cached.data;
      } else {
        // Fetch fresh from Forex Factory
        const response = await fetch(FOREX_FACTORY_URL, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        if (!response.ok) {
          // Return cached data if fetch fails
          if (cached) return res.status(200).json(cached.data);
          return res.status(200).json([]);
        }

        const raw = await response.json();

        // Filter high impact only, next 48 hours
        const cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000);
        events = raw
          .filter(e => {
            const impact = (e.impact || '').toLowerCase();
            const isHigh = impact === 'high';
            const eventTime = new Date(`${e.date}T${e.time || '00:00:00'}`);
            return isHigh && eventTime >= now && eventTime <= cutoff;
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
          .sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));

        // Upsert cache
        await supabase.from('calendar_cache').upsert({
          key: CACHE_KEY,
          data: events,
          updated_at: now.toISOString(),
        }, { onConflict: 'key' });
      }

      return res.status(200).json(events);
    } catch (e) {
      console.error('Calendar error:', e);
      return res.status(200).json([]);
    }
  }

  res.status(405).end();
}
