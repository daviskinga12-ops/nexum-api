-- ═══════════════════════════════════════════════════
-- NEXUM — Database Schema v2 (fixed)
-- Supabase / PostgreSQL
-- The infrastructure beneath every exchange.
-- ═══════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── SEQUENCE for NEXUM IDs (fixes race condition) ──
CREATE SEQUENCE IF NOT EXISTS nexum_user_seq START 1;

-- ─── USERS ───────────────────────────────────────────
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nexum_id          TEXT UNIQUE,
  full_name         TEXT NOT NULL,
  phone             TEXT UNIQUE NOT NULL,
  national_id       TEXT UNIQUE,
  county            TEXT,
  date_of_birth     DATE,
  is_verified       BOOLEAN DEFAULT FALSE,
  verification_tier TEXT DEFAULT 'none',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TRUST EVENTS (immutable log) ────────────────────
CREATE TABLE trust_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  event_source TEXT,
  score_delta  INTEGER DEFAULT 0,
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TRUST SCORES (computed cache) ───────────────────
CREATE TABLE trust_scores (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score           INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 1000),
  tier            TEXT DEFAULT 'building',
  identity_pct    INTEGER DEFAULT 0,
  transaction_pct INTEGER DEFAULT 0,
  references_pct  INTEGER DEFAULT 0,
  dispute_pct     INTEGER DEFAULT 100,
  payment_pct     INTEGER DEFAULT 0,
  last_computed   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── FIX: user_references (not references — reserved word) ──
CREATE TABLE user_references (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  referee_phone TEXT NOT NULL,
  referee_name  TEXT NOT NULL,
  relationship  TEXT NOT NULL,
  statement     TEXT,
  is_verified   BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TRANSACTIONS ─────────────────────────────────────
CREATE TABLE transactions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id      UUID REFERENCES users(id),
  receiver_id    UUID REFERENCES users(id),
  amount_kes     NUMERIC(12,2) NOT NULL,
  payment_method TEXT DEFAULT 'mpesa',
  mpesa_ref      TEXT,
  status         TEXT DEFAULT 'pending',
  description    TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

-- ─── API CLIENTS ──────────────────────────────────────
CREATE TABLE api_clients (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_name  TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  api_key        TEXT UNIQUE NOT NULL,
  plan           TEXT DEFAULT 'starter',
  queries_used   INTEGER DEFAULT 0,
  queries_limit  INTEGER DEFAULT 500,
  billing_kes    NUMERIC(10,2) DEFAULT 2000,
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  reset_at       TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 month'
);

-- ─── API QUERY LOG ────────────────────────────────────
CREATE TABLE api_queries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      UUID REFERENCES api_clients(id) ON DELETE CASCADE,
  queried_phone  TEXT NOT NULL,
  score_returned INTEGER,
  tier_returned  TEXT,
  response_ms    INTEGER,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LOGISTICS ORDERS ────────────────────────────────
CREATE TABLE logistics_orders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id         UUID REFERENCES users(id),
  buyer_id          UUID REFERENCES users(id),
  rider_id          UUID REFERENCES users(id),
  pickup_location   TEXT NOT NULL,
  delivery_location TEXT NOT NULL,
  distance_km       NUMERIC(6,2),
  fee_kes           NUMERIC(8,2),
  status            TEXT DEFAULT 'pending',
  tracking_code     TEXT UNIQUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  delivered_at      TIMESTAMPTZ
);

-- ─── OTP SESSIONS ─────────────────────────────────────
CREATE TABLE otp_sessions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone            TEXT NOT NULL,
  otp_hash         TEXT NOT NULL,
  delivery_channel TEXT NOT NULL DEFAULT 'sms',
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  used             BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Existing deployments:
-- ALTER TABLE otp_sessions ADD COLUMN IF NOT EXISTS delivery_channel TEXT NOT NULL DEFAULT 'sms';

-- ═══════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════

CREATE INDEX idx_users_phone       ON users(phone);
CREATE INDEX idx_users_nexum_id    ON users(nexum_id);
CREATE INDEX idx_trust_events_user ON trust_events(user_id, created_at DESC);
CREATE INDEX idx_transactions_sender   ON transactions(sender_id, created_at DESC);
CREATE INDEX idx_transactions_receiver ON transactions(receiver_id, created_at DESC);
CREATE INDEX idx_api_queries_client    ON api_queries(client_id, created_at DESC);
CREATE INDEX idx_logistics_seller      ON logistics_orders(seller_id, created_at DESC);

-- ═══════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════

-- FIX: Use sequence for nexum_id — no race condition
CREATE OR REPLACE FUNCTION generate_nexum_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.nexum_id := 'NXM-KE-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
    LPAD(nextval('nexum_user_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_nexum_id
  BEFORE INSERT ON users
  FOR EACH ROW
  WHEN (NEW.nexum_id IS NULL)
  EXECUTE FUNCTION generate_nexum_id();

-- FIX: dispute_score base aligned to 150 (matches trustEngine.js)
CREATE OR REPLACE FUNCTION recompute_trust_score(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  identity_score    INTEGER := 0;
  transaction_score INTEGER := 0;
  reference_score   INTEGER := 0;
  dispute_score     INTEGER := 150;
  payment_score     INTEGER := 0;
  final_score       INTEGER;
  v_tier            TEXT;
BEGIN
  SELECT LEAST(250,
    (CASE WHEN EXISTS (SELECT 1 FROM trust_events WHERE user_id=p_user_id AND event_type='phone_verified') THEN 80 ELSE 0 END) +
    (CASE WHEN EXISTS (SELECT 1 FROM trust_events WHERE user_id=p_user_id AND event_type='national_id_verified') THEN 120 ELSE 0 END) +
    (CASE WHEN EXISTS (SELECT 1 FROM trust_events WHERE user_id=p_user_id AND event_type='annual_reverification') THEN 50 ELSE 0 END)
  ) INTO identity_score;

  SELECT LEAST(300, COUNT(*) * 8) INTO transaction_score
  FROM trust_events WHERE user_id=p_user_id AND event_type='transaction_completed';

  -- FIX: query user_references not references
  SELECT LEAST(200, COUNT(*) * 28) INTO reference_score
  FROM user_references WHERE subject_id=p_user_id AND is_verified=TRUE;

  SELECT GREATEST(0, 150 - (COUNT(*) * 40)) INTO dispute_score
  FROM trust_events WHERE user_id=p_user_id AND event_type='transaction_disputed';

  SELECT LEAST(100, COUNT(*) * 5) INTO payment_score
  FROM transactions WHERE receiver_id=p_user_id AND status='completed';

  final_score := identity_score + transaction_score + reference_score + dispute_score + payment_score;

  v_tier := CASE
    WHEN final_score >= 800 THEN 'gold'
    WHEN final_score >= 600 THEN 'verified'
    WHEN final_score >= 400 THEN 'rising'
    ELSE 'building'
  END;

  INSERT INTO trust_scores (user_id, score, tier, identity_pct, transaction_pct, references_pct, dispute_pct, payment_pct, last_computed)
  VALUES (p_user_id, final_score, v_tier,
    ROUND(identity_score::NUMERIC/250*100),
    ROUND(transaction_score::NUMERIC/300*100),
    ROUND(reference_score::NUMERIC/200*100),
    ROUND(dispute_score::NUMERIC/150*100),
    ROUND(payment_score::NUMERIC/100*100),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    score=EXCLUDED.score, tier=EXCLUDED.tier,
    identity_pct=EXCLUDED.identity_pct, transaction_pct=EXCLUDED.transaction_pct,
    references_pct=EXCLUDED.references_pct, dispute_pct=EXCLUDED.dispute_pct,
    payment_pct=EXCLUDED.payment_pct, last_computed=NOW();

  RETURN final_score;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_score_recompute()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM recompute_trust_score(NEW.user_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recompute_on_event
  AFTER INSERT ON trust_events
  FOR EACH ROW EXECUTE FUNCTION trigger_score_recompute();

-- ═══════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_data" ON users FOR ALL USING (auth.uid()::text = id::text);
CREATE POLICY "own_trust_score" ON trust_scores FOR SELECT USING (auth.uid()::text = user_id::text);
CREATE POLICY "own_trust_events" ON trust_events FOR SELECT USING (auth.uid()::text = user_id::text);
CREATE POLICY "own_transactions" ON transactions FOR SELECT USING (
  auth.uid()::text = sender_id::text OR auth.uid()::text = receiver_id::text
);
CREATE POLICY "trust_scores_public_read" ON trust_scores FOR SELECT USING (true);
