import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

  // Verify user token
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  if (req.method === 'GET') {
    // Load all sessions for this user
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, file_name, created_at, updated_at, messages, fixed_code, chars')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    // Save / update a session
    const { id, title, file_name, messages, fixed_code, chars } = req.body;
    const now = new Date().toISOString();

    if (id) {
      // Update existing
      const { data, error } = await supabase
        .from('sessions')
        .update({ title, file_name, messages, fixed_code, chars, updated_at: now })
        .eq('id', id)
        .eq('user_id', user.id)
        .select('id')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    } else {
      // Create new
      const { data, error } = await supabase
        .from('sessions')
        .insert({ user_id: user.id, title, file_name, messages, fixed_code, chars, created_at: now, updated_at: now })
        .select('id')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(data);
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
