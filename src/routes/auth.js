const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');
const { logTrustEvent } = require('../lib/trustEngine');
const { sendOtpEmail } = require('../services/emailService');

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── POST /register ───────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { phone, full_name, email } = req.body;
    if (!phone || !full_name || !email) {
      return res.status(400).json({ error: 'phone, full_name and email are required' });
    }

    const { data: existing } = await supabase
      .from('users').select('id').eq('phone', phone).single();

    if (existing) {
      return res.status(409).json({ error: 'Phone number already registered' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .insert({ phone, full_name, email, is_verified: false })
      .select()
      .single();

    if (error) throw error;

    const otp = generateOTP();
    const otpHash = await bcrypt.hash(otp, 10);

    await supabase.from('otp_sessions').insert({
      phone,
      otp_hash: otpHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    await sendOtpEmail(email, otp);

    res.status(201).json({
      message: 'OTP sent to your email. Verify to continue.',
      nexum_id: user.nexum_id,
      expires_in: 600,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /verify-otp ─────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ error: 'phone and otp are required' });
    }

    const { data: session } = await supabase
      .from('otp_sessions')
      .select('*')
      .eq('phone', phone)
      .eq('used', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) {
      return res.status(400).json({ error: 'OTP expired or not found. Request a new one.' });
    }

    const valid = await bcrypt.compare(otp, session.otp_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Incorrect OTP' });
    }

    await supabase.from('otp_sessions').update({ used: true }).eq('id', session.id);

    const { data: user } = await supabase
      .from('users').select('*').eq('phone', phone).single();

    await supabase.from('users').update({ is_verified: true }).eq('id', user.id);

    await logTrustEvent(user.id, 'phone_verified', { phone }, 'auth');

    const token = jwt.sign(
      { userId: user.id, phone: user.phone, nexumId: user.nexum_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Verified. Welcome to NEXUM.',
      token,
      user: {
        nexum_id: user.nexum_id,
        full_name: user.full_name,
        phone: user.phone,
        is_verified: true,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /identity ───────────────────────────────
router.post('/identity', require('../middleware/auth').requireAuth, async (req, res) => {
  try {
    const { national_id, date_of_birth, county } = req.body;
    if (!national_id || !date_of_birth) {
      return res.status(400).json({ error: 'national_id and date_of_birth are required' });
    }

    const idHash = await bcrypt.hash(national_id, 10);

    await supabase.from('users').update({
      national_id: idHash,
      date_of_birth,
      county,
      verification_tier: 'verified',
    }).eq('id', req.userId);

    await logTrustEvent(req.userId, 'national_id_verified', { county }, 'kyc');

    res.json({
      message: 'Identity verified. Your trust score has been updated.',
      action: 'Get your full trust profile at GET /api/v1/profile/me',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /login ──────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const { data: user } = await supabase
      .from('users').select('id, email').eq('phone', phone).single();

    if (!user) return res.status(404).json({ error: 'Phone not registered. Please sign up.' });

    const otp = generateOTP();
    const otpHash = await bcrypt.hash(otp, 10);

    await supabase.from('otp_sessions').insert({
      phone,
      otp_hash: otpHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    await sendOtpEmail(user.email, otp);
    res.json({ message: 'OTP sent to your email.', expires_in: 600 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
