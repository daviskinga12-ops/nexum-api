const router = require('express').Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { getTrustScore } = require('../lib/trustEngine');

// ─── GET /profile/me ──────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [{ data: user }, trustData] = await Promise.all([
      supabase.from('users').select('*').eq('id', req.userId).single(),
      getTrustScore(req.userId),
    ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get references count
    const { count: refCount } = await supabase
      .from('user_references')
      .select('*', { count: 'exact', head: true })
      .eq('subject_id', req.userId)
      .eq('is_verified', true);

    // Get recent activity
    const { data: recentEvents } = await supabase
      .from('trust_events')
      .select('event_type, event_source, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(10);

    // Get query count (how many businesses looked you up)
    const { count: queryCount } = await supabase
      .from('api_queries')
      .select('*', { count: 'exact', head: true })
      .eq('queried_phone', user.phone);

    res.json({
      nexum_id: user.nexum_id,
      full_name: user.full_name,
      phone: user.phone,
      county: user.county,
      is_verified: user.is_verified,
      verification_tier: user.verification_tier,
      member_since: user.created_at,
      trust: {
        score: trustData.score,
        tier: trustData.tier,
        breakdown: trustData.breakdown,
      },
      stats: {
        verified_references: refCount || 0,
        profile_queries: queryCount || 0,
      },
      recent_activity: (recentEvents || []).map(e => ({
        event: e.event_type,
        source: e.event_source,
        at: e.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /profile/reference ──────────────────────
router.post('/reference', requireAuth, async (req, res) => {
  try {
    const { referee_phone, referee_name, relationship, statement } = req.body;

    if (!referee_phone || !referee_name || !relationship) {
      return res.status(400).json({ error: 'referee_phone, referee_name, relationship required' });
    }

    const { data: ref, error } = await supabase
      .from('user_references')
      .insert({
        subject_id: req.userId,
        referee_phone,
        referee_name,
        relationship,
        statement,
        is_verified: false, // Verification happens via SMS confirmation
      })
      .select()
      .single();

    if (error) throw error;

    // TODO: Send SMS to referee asking them to confirm
    console.log(`[NEXUM REF] Reference request sent to ${referee_phone}`);

    res.status(201).json({
      message: 'Reference request sent. When they confirm via SMS, your score will update.',
      reference_id: ref.id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
