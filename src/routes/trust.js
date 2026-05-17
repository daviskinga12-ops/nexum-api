const router = require('express').Router();
const supabase = require('../lib/supabase');
const { getTrustScore } = require('../lib/trustEngine');
const { requireApiKey, requireAuth } = require('../middleware/auth');

// ─── FIX: /my/score MUST come before /:phone ─────
// If defined after, Express treats "my" as a phone number.

// GET /trust/my/score (personal — requires JWT)
router.get('/my/score', requireAuth, async (req, res) => {
  try {
    const trustData = await getTrustScore(req.userId);
    res.json(trustData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /trust/:phone (B2B — requires API key)
router.get('/:phone', requireApiKey, async (req, res) => {
  const start = Date.now();
  try {
    const { phone } = req.params;

    const { data: user } = await supabase
      .from('users')
      .select('id, nexum_id, full_name, is_verified, verification_tier, county, created_at')
      .eq('phone', phone)
      .single();

    if (!user) {
      return res.status(404).json({
        error: 'No NEXUM profile found for this number',
        phone,
        suggestion: 'User may not be registered on NEXUM',
      });
    }

    const trustData = await getTrustScore(user.id);
    const responseMs = Date.now() - start;

    await supabase.from('api_queries').insert({
      client_id: req.apiClient.id,
      queried_phone: phone,
      score_returned: trustData.score,
      tier_returned: trustData.tier,
      response_ms: responseMs,
    });

    await supabase
      .from('api_clients')
      .update({ queries_used: req.apiClient.queries_used + 1 })
      .eq('id', req.apiClient.id);

    res.json({
      nexum_id: user.nexum_id,
      trust_score: trustData.score,
      tier: trustData.tier,
      verified: user.is_verified,
      verification_tier: user.verification_tier,
      identity_confirmed: user.verification_tier !== 'none',
      member_since: user.created_at,
      breakdown: trustData.breakdown,
      response_ms: responseMs,
      queried_by: req.apiClient.business_name,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
