const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// ─── TRUST PROXY ─────────────────────────────────
// Required for Render — sits behind a reverse proxy
app.set('trust proxy', 1);

// ─── CORS ─────────────────────────────────────────
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    if (origin.startsWith('http://localhost')) return callback(null, true);
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim());
    if (allowed.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
};

app.use(cors(corsOptions));
app.options('/{0,}', cors(corsOptions));

// ─── SECURITY MIDDLEWARE ──────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '10kb' }));
app.use(morgan('dev'));

// ─── RATE LIMITING ────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts. Please try again in 15 minutes.' },
  validate: { xForwardedForHeader: false },
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
    version: 'v1',
    endpoints: {
      health:    'GET  /health',
      auth:      'POST /api/v1/auth/register | /login | /verify-otp | /identity',
      trust:     'GET  /api/v1/trust/:phone',
      mpesa:     'POST /api/v1/mpesa/stk-push | /callback',
      profile:   'GET  /api/v1/profile/me',
      api:       'POST /api/v1/api/keys | GET /api/v1/api/usage',
      logistics: 'POST /api/v1/logistics/orders | GET /api/v1/logistics/orders/:id',
    },
  });
});

// ─── 404 ──────────────────────────────────────────
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
