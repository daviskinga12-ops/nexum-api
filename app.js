const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// ─── SECURITY MIDDLEWARE ──────────────────────────
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  credentials: true,
}));
app.use(express.json({ limit: '10kb' }));
app.use(morgan('dev'));

// ─── RATE LIMITING ────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter on auth routes — prevent OTP abuse
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many auth attempts. Please try again in 15 minutes.' },
});

app.use(globalLimiter);
app.use('/api/v1/auth', authLimiter);

// ─── ROUTES ──────────────────────────────────────
app.use('/api/v1/auth',      require('./routes/auth'));
app.use('/api/v1/trust',     require('./routes/trust'));
app.use('/api/v1/mpesa',     require('./routes/mpesa'));
app.use('/api/v1/api',       require('./routes/apiAccess'));
app.use('/api/v1/profile',   require('./routes/profile'));
app.use('/api/v1/logistics', require('./routes/logistics'));

// ─── HEALTH CHECK ────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'live',
    service: 'NEXUM Trust Layer API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── ROOT ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'NEXUM API',
    tagline: 'The infrastructure beneath every exchange.',
    docs: 'https://docs.nexum.africa',
    version: 'v1',
    endpoints: {
      health:     'GET  /health',
      auth:       'POST /api/v1/auth/register | /login | /verify-otp | /identity',
      trust:      'GET  /api/v1/trust/:phone',
      mpesa:      'POST /api/v1/mpesa/stk-push | /callback',
      profile:    'GET  /api/v1/profile/me',
      api:        'POST /api/v1/api/keys | GET /api/v1/api/usage',
      logistics:  'POST /api/v1/logistics/orders | GET /api/v1/logistics/orders/:id',
    },
  });
});

// ─── 404 HANDLER ─────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.originalUrl });
});

// ─── ERROR HANDLER ───────────────────────────────
app.use((err, req, res, next) => {
  console.error('[NEXUM ERROR]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

module.exports = app;
