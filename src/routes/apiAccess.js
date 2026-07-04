const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// ─── POST /api/keys — Create API key ─────────────
router.post('/keys', requireAuth, async (req, res) => {
  try {
    const { business_name, contact_email, plan } = req.body;

    if (!business_name || !contact_email) {
      return res.status(400).json({ error: 'business_name and contact_email required' });
    }

    const validPlans = { starter: { limit: 500, price: 2000 }, growth: { limit: 5000, price: 8000 }, enterprise: { limit: 999999, price: 0 } };
    const selectedPlan = validPlans[plan || 'starter'];

    // Generate API key
    const apiKey = `nxm_live_${uuidv4().replace(/-/g, '')}`;

    const { data: client, error } = await supabase
      .from('api_clients')
      .insert({
        business_name,
        contact_email,
        api_key: apiKey,
        plan: plan || 'starter',
        queries_limit: selectedPlan.limit,
        billing_kes: selectedPlan.price,
        reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'API key created. Store this securely — it will not be shown again.',
      api_key: apiKey,
      plan: client.plan,
      queries_limit: client.queries_limit,
      billing_kes_per_month: selectedPlan.price,
      docs: 'https://docs.nexum.africa/api',
      example: `curl -H "x-api-key: ${apiKey}" ${process.env.RENDER_EXTERNAL_URL || 'https://nexum-api-p1bk.onrender.com'}/api/v1/trust/0712345678`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/usage ────────────────────────────────
router.get('/usage', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'Missing x-api-key' });

    const { data: client } = await supabase
      .from('api_clients')
      .select('*')
      .eq('api_key', apiKey)
      .single();

    if (!client) return res.status(401).json({ error: 'Invalid API key' });

    const { data: recentQueries } = await supabase
      .from('api_queries')
      .select('queried_phone, score_returned, tier_returned, response_ms, created_at')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({
      business: client.business_name,
      plan: client.plan,
      queries_used: client.queries_used,
      queries_limit: client.queries_limit,
      queries_remaining: client.queries_limit - client.queries_used,
      reset_at: client.reset_at,
      billing_kes: client.billing_kes,
      recent_queries: recentQueries || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
