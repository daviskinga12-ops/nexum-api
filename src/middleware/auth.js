const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');

// ─── REQUIRE AUTH ─────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.phone  = decoded.phone;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── REQUIRE API KEY (for B2B queries) ───────────
async function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing x-api-key header' });
  }

  const { data: client } = await supabase
    .from('api_clients')
    .select('*')
    .eq('api_key', apiKey)
    .eq('is_active', true)
    .single();

  if (!client) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  if (client.queries_used >= client.queries_limit) {
    return res.status(429).json({
      error: 'Query limit exceeded',
      limit: client.queries_limit,
      used: client.queries_used,
      reset_at: client.reset_at,
      upgrade: 'https://nexum.africa/pricing',
    });
  }

  req.apiClient = client;
  next();
}

module.exports = { requireAuth, requireApiKey };
