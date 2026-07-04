# NEXUM API
### The infrastructure beneath every exchange.

A trust-layer backend for Africa's informal economy. Removes trust, payment, logistics, and infrastructure friction simultaneously.

---

## Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **Payments**: Safaricom Daraja API (M-Pesa STK Push)
- **Deployment**: Render

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| POST | `/api/v1/auth/register` | None | Register new user |
| POST | `/api/v1/auth/verify-otp` | None | Verify phone OTP |
| POST | `/api/v1/auth/identity` | JWT | Submit National ID |
| POST | `/api/v1/auth/login` | None | Login (sends OTP) |
| GET | `/api/v1/trust/:phone` | API Key | Query trust score (B2B) |
| GET | `/api/v1/trust/my/score` | JWT | Get own trust score |
| POST | `/api/v1/mpesa/stk-push` | JWT | Initiate M-Pesa payment |
| POST | `/api/v1/mpesa/callback` | Safaricom | Payment callback |
| GET | `/api/v1/profile/me` | JWT | Get full profile |
| POST | `/api/v1/profile/reference` | JWT | Request a reference |
| POST | `/api/v1/api/keys` | JWT | Create B2B API key |
| GET | `/api/v1/api/usage` | API Key | Check usage stats |
| POST | `/api/v1/logistics/orders` | JWT | Create delivery order |
| GET | `/api/v1/logistics/orders` | JWT | List my orders |
| GET | `/api/v1/logistics/orders/:id` | JWT | Track specific order |

---

## Setup

### 1. Clone and install
```bash
git clone https://github.com/your-username/nexum-api
cd nexum-api
npm install
```

### 2. Environment variables
```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Database
- Create a Supabase project at supabase.com
- Run `schema.sql` in the Supabase SQL editor

### 4. Run locally
```bash
npm run dev
```

### 5. Deploy to Render
- Push to GitHub
- In [Render](https://render.com), create a **Web Service** from this repo (or apply the `render.yaml` Blueprint)
- Add all env vars from `.env.example` in the Render dashboard
- Set `MPESA_CALLBACK_URL` to your Render URL + `/api/v1/mpesa/callback`
- Render auto-deploys on every push to `main`

---

## Environment Variables

See `.env.example` for all required variables.

Key ones:
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — from your Supabase project settings
- `MPESA_CONSUMER_KEY` + `MPESA_CONSUMER_SECRET` — from Safaricom Developer Portal
- `JWT_SECRET` — generate with `openssl rand -base64 32`
- `MPESA_CALLBACK_URL` — your Render URL + `/api/v1/mpesa/callback`

---

## Architecture

```
nexum-api/
├── src/
│   ├── server.js           Entry point
│   ├── app.js              Express + middleware + routes
│   ├── lib/
│   │   ├── supabase.js     Database client
│   │   ├── mpesa.js        Daraja STK push + token management
│   │   └── trustEngine.js  Score computation from event log
│   ├── middleware/
│   │   └── auth.js         JWT + API key protection
│   └── routes/
│       ├── auth.js         Registration + OTP + identity
│       ├── trust.js        Trust score queries
│       ├── mpesa.js        Payments + Safaricom callback
│       ├── profile.js      User profile + references
│       ├── apiAccess.js    B2B API key management
│       └── logistics.js    Delivery order coordination
├── schema.sql              Supabase database schema
├── .env.example            Environment variables template
└── render.yaml             Render deployment config
```

---

*NEXUM — Value, without friction.*
