const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');
const { logTrustEvent } = require('../lib/trustEngine');
const { deliverOtp } = require('../services/otpDelivery');

// ─── SUPPORTED COUNTRIES ─────────────────────────
const COUNTRIES = {
  KE: { code: '+254', name: 'Kenya',    pattern: /^\+2547\d{8}$|^\+25410\d{7}$|^\+25411\d{7}$|^\+25477\d{7}$/ },
  TZ: { code: '+255', name: 'Tanzania', pattern: /^\+255\d{9}$/ },
  UG: { code: '+256', name: 'Uganda',   pattern: /^\+256\d{9}$/ },
  RW: { code: '+250', name: 'Rwanda',   pattern: /^\+250\d{9}$/ },
  ET: { code: '+251', name: 'Ethiopia', pattern: /^\+251\d{9}$/ },
  NG: { code: '+234', name: 'Nigeria',  pattern: /^\+234\d{10}$/ },
  GH: { code: '+233', name: 'Ghana',   pattern: /^\+233\d{9}$/ },
};

function normalisePhone(phone, countryKey) {
  let p = phone.replace(/[\s\-\(\)]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);
  const country = COUNTRIES[countryKey];
  if (!country) return p;
  if (p.startsWith('0')) return country.code + p.slice(1);
  return '+' + p;
}

function validatePhone(phone, countryKey) {
  const country = COUNTRIES[countryKey];
  if (!country) return false;
  return country.pattern.test(phone);
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── POST /register ───────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { phone, full_name, email, country = 'KE' } = req.body;

    if (!phone || !full_name || !email) {
      return res.status(400).json({ error: 'phone, full_name and email are required' });
    }

    if (!COUNTRIES[country]) {
      return res.status(400).json({ error: 'Unsupported country.' });
    }

    const normalisedPhone = normalisePhone(phone, country);

    if (!validatePhone(normalisedPhone, country)) {
      return res.status(400).json({ error: `Invalid phone number for ${COUNTRIES[country].name}.` });
    }

    const { data: existing } = await supabase
      .from('users').select('id').eq('phone', normalisedPhone).single();

    if (existing) {
      return res.status(409).json({ error: 'Phone number already registered' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .insert({ phone: normalisedPhone, full_name, email, country, is_verified: false })
      .select()
      .single();

    if (error) throw error;

    const otp = generateOTP();
    const otpHash = await bcrypt.hash(otp, 10);
    const delivery = await deliverOtp({ phone: normalisedPhone, email, otp });

    await supabase.from('otp_sessions').insert({
      phone: normalisedPhone,
      otp_hash: otpHash,
      delivery_channel: delivery.channel,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    res.status(201).json({
      message: delivery.message,
      channel: delivery.channel,
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
    const { phone, otp, country = 'KE' } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ error: 'phone and otp are required' });
    }

    const normalisedPhone = normalisePhone(phone, country);

    const { data: session } = await supabase
      .from('otp_sessions')
      .select('*')
      .eq('phone', normalisedPhone)
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
      .from('users').select('*').eq('phone', normalisedPhone).single();

    await supabase.from('users').update({ is_verified: true }).eq('id', user.id);

    if ((session.delivery_channel || 'sms') === 'sms') {
      await logTrustEvent(user.id, 'phone_verified', { phone: normalisedPhone }, 'auth');
    }

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
        country: user.country,
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
    const { phone, country = 'KE' } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const normalisedPhone = normalisePhone(phone, country);

    const { data: user } = await supabase
      .from('users').select('id, email').eq('phone', normalisedPhone).single();

    if (!user) return res.status(404).json({ error: 'Phone not registered. Please sign up.' });

    const otp = generateOTP();
    const otpHash = await bcrypt.hash(otp, 10);
    const delivery = await deliverOtp({ phone: normalisedPhone, email: user.email, otp });

    await supabase.from('otp_sessions').insert({
      phone: normalisedPhone,
      otp_hash: otpHash,
      delivery_channel: delivery.channel,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    res.json({ message: delivery.message, channel: delivery.channel, expires_in: 600 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
