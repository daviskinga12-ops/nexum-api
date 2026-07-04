require('dotenv').config();
const app = require('./app');
const { smsConfigured, emailConfigured } = require('./services/otpDelivery');

const PORT = process.env.PORT || 3000;

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error('[NEXUM] Missing required env vars:', missing.join(', '));
  process.exit(1);
}

if (!smsConfigured() && !emailConfigured()) {
  console.warn('[NEXUM] Warning: No OTP delivery configured (set AT_* for SMS or GMAIL_* for email fallback)');
} else if (!smsConfigured()) {
  console.warn('[NEXUM] Warning: SMS not configured — OTP will use email only (no phone_verified trust score)');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║        NEXUM API — Trust Layer           ║
║   The infrastructure beneath every      ║
║           exchange.                      ║
╠══════════════════════════════════════════╣
║  Port    : ${PORT}                           ║
║  Env     : ${(process.env.NODE_ENV || 'development').padEnd(30)}║
║  M-Pesa  : ${(process.env.MPESA_ENV || 'sandbox').padEnd(30)}║
╚══════════════════════════════════════════╝
  `);
});
