const supabase = require('./supabase');

// ─── SCORE WEIGHTS ────────────────────────────────
// Total maximum: 1000 points
const WEIGHTS = {
  identity: {
    phone_verified:       80,
    national_id_verified: 120,
    annual_reverification: 50,
    max: 250,
  },
  transactions: {
    per_completed: 8,
    max: 300,
  },
  references: {
    per_verified: 28,
    max: 200,
  },
  disputes: {
    base: 150,
    per_dispute: -40,
    min: 0,
  },
  payments: {
    per_received: 5,
    max: 100,
  },
};

// ─── COMPUTE SCORE ────────────────────────────────
async function computeTrustScore(userId) {
  // 1. Identity score
  const { data: identityEvents } = await supabase
    .from('trust_events')
    .select('event_type')
    .eq('user_id', userId)
    .in('event_type', ['phone_verified', 'national_id_verified', 'annual_reverification']);

  const identityTypes = new Set((identityEvents || []).map(e => e.event_type));
  let identityScore = 0;
  if (identityTypes.has('phone_verified'))       identityScore += WEIGHTS.identity.phone_verified;
  if (identityTypes.has('national_id_verified')) identityScore += WEIGHTS.identity.national_id_verified;
  if (identityTypes.has('annual_reverification')) identityScore += WEIGHTS.identity.annual_reverification;
  identityScore = Math.min(identityScore, WEIGHTS.identity.max);

  // 2. Transaction score
  const { count: completedTx } = await supabase
    .from('trust_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', 'transaction_completed');

  const transactionScore = Math.min(
    (completedTx || 0) * WEIGHTS.transactions.per_completed,
    WEIGHTS.transactions.max
  );

  // 3. References score
  const { count: verifiedRefs } = await supabase
    .from('user_references')
    .select('*', { count: 'exact', head: true })
    .eq('subject_id', userId)
    .eq('is_verified', true);

  const referenceScore = Math.min(
    (verifiedRefs || 0) * WEIGHTS.references.per_verified,
    WEIGHTS.references.max
  );

  // 4. Dispute score (starts full, decreases per dispute)
  const { count: disputes } = await supabase
    .from('trust_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', 'transaction_disputed');

  const disputeScore = Math.max(
    WEIGHTS.disputes.base + (disputes || 0) * WEIGHTS.disputes.per_dispute,
    WEIGHTS.disputes.min
  );

  // 5. Payment reliability
  const { count: paymentsReceived } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('receiver_id', userId)
    .eq('status', 'completed');

  const paymentScore = Math.min(
    (paymentsReceived || 0) * WEIGHTS.payments.per_received,
    WEIGHTS.payments.max
  );

  const totalScore = identityScore + transactionScore + referenceScore + disputeScore + paymentScore;

  // Determine tier
  const tier = totalScore >= 800 ? 'gold'
    : totalScore >= 600 ? 'verified'
    : totalScore >= 400 ? 'rising'
    : 'building';

  const breakdown = {
    identity_pct:    Math.round((identityScore    / WEIGHTS.identity.max)      * 100),
    transaction_pct: Math.round((transactionScore / WEIGHTS.transactions.max)  * 100),
    references_pct:  Math.round((referenceScore   / WEIGHTS.references.max)    * 100),
    dispute_pct:     Math.round((disputeScore      / WEIGHTS.disputes.base)    * 100),
    payment_pct:     Math.round((paymentScore      / WEIGHTS.payments.max)     * 100),
  };

  // Upsert into trust_scores cache
  await supabase.from('trust_scores').upsert({
    user_id: userId,
    score: totalScore,
    tier,
    ...breakdown,
    last_computed: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  return { score: totalScore, tier, breakdown };
}

// ─── GET SCORE (cached, refresh if stale >1hr) ───
async function getTrustScore(userId) {
  const { data } = await supabase
    .from('trust_scores')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!data) return computeTrustScore(userId);

  const ageMs = Date.now() - new Date(data.last_computed).getTime();
  if (ageMs > 60 * 60 * 1000) return computeTrustScore(userId);

  return {
    score: data.score,
    tier: data.tier,
    breakdown: {
      identity_pct:    data.identity_pct,
      transaction_pct: data.transaction_pct,
      references_pct:  data.references_pct,
      dispute_pct:     data.dispute_pct,
      payment_pct:     data.payment_pct,
    },
  };
}

// ─── LOG TRUST EVENT ──────────────────────────────
async function logTrustEvent(userId, eventType, metadata = {}, source = 'system') {
  await supabase.from('trust_events').insert({
    user_id: userId,
    event_type: eventType,
    event_source: source,
    metadata,
  });
  return computeTrustScore(userId);
}

module.exports = { computeTrustScore, getTrustScore, logTrustEvent };
