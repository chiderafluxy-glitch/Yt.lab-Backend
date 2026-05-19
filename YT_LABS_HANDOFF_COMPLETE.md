# YT.labs SaaS - Complete Handoff Document

## Executive Summary

YT.labs is a multi-tenant YouTube automation SaaS built on the open-source agent framework. This document details everything that has been built, what needs to be done, and step-by-step instructions for deployment.

**Current Status:** Foundation built - database schema created, backend auth/payment/onboarding layers integrated, frontend ready to wire up.

**What's Done:**
- ✅ Complete backend API with auth, payments, usage tracking
- ✅ Supabase database schema (11 tables with RLS)
- ✅ Stripe webhook integration
- ✅ Free trial with 2-video hard stop
- ✅ 5-condition account state check system
- ✅ Multi-tenant agent modification framework

**What's Left:**
- [ ] Deploy Supabase project
- [ ] Configure Stripe webhooks and price IDs
- [ ] Wire frontend to backend APIs
- [ ] Deploy to Vercel/Railway
- [ ] Set up Google Gemini AI Studio API
- [ ] Configure YouTube OAuth

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [What Has Been Built](#what-has-been-built)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [Free Trial Hard Stop Logic](#free-trial-hard-stop-logic)
6. [Account State Check (5-Condition System)](#account-state-check-5-condition-system)
7. [Deployment Instructions](#deployment-instructions)
8. [Configuration & API Keys](#configuration--api-keys)
9. [Frontend Integration](#frontend-integration)
10. [Testing Checklist](#testing-checklist)

---

## System Architecture

### Overview

```
┌─────────────────┐
│   Your Frontend  │ (YT_labs-main_2.zip)
│  (HTML/CSS/JS)  │
└────────┬────────┘
         │
         │ HTTP/JSON
         │
┌────────▼────────────────────┐
│     Node.js Express Server   │ (YT_labs_index.js)
│  ┌──────────────────────┐   │
│  │ Auth Middleware      │   │
│  │ (JWT verification)   │   │
│  ├──────────────────────┤   │
│  │ Account State Check  │   │
│  │ (5-condition system) │   │
│  ├──────────────────────┤   │
│  │ Trial Limit Check    │   │
│  │ (2 videos max)       │   │
│  ├──────────────────────┤   │
│  │ 7 AI Agents          │   │
│  │ (content pipeline)   │   │
│  └──────────────────────┘   │
└────────┬────────────────────┘
         │
    ┌────┴─────┬──────────┬──────────┐
    │           │          │          │
┌───▼──┐  ┌────▼──┐  ┌───▼───┐  ┌──▼──┐
│Supabase│ │Stripe │  │Google │  │AWS  │
│Database│ │Payment│  │Gemini │  │S3   │
└────────┘  └───────┘  └───────┘  └─────┘
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | HTML/CSS/JS | User interface (your design) |
| Backend | Node.js + Express | API server + AI agent orchestration |
| Database | Supabase (PostgreSQL) | User data, subscriptions, content, analytics |
| Auth | Supabase Auth | Email/password authentication with JWT |
| Payments | Stripe | Subscription management + webhooks |
| AI Models | Google Gemini (trial), OpenAI GPT-4 (pro) | Content generation |
| Storage | AWS S3 | Video/thumbnail storage |
| Hosting | Vercel (frontend) + Railway/Render (backend) | Deployment |

---

## What Has Been Built

### 1. Backend Server (`YT_labs_index.js`)

**Status:** ✅ Complete - ready to use

**What it includes:**

**Authentication System**
- JWT-based auth middleware
- Sign up endpoint: `POST /auth/signup` → creates user + trial subscription + onboarding record
- Login endpoint: `POST /auth/login` → returns JWT + routes user based on account state
- Account state check endpoint: `POST /auth/check-state` → verifies all 5 conditions

**Payment Integration**
- Stripe checkout session creation: `POST /create-checkout`
- Webhook handler: `POST /webhook/stripe` → processes Stripe events
- Subscription status tracking in database
- Automatic usage tier creation on payment

**Onboarding System**
- Step tracking: `POST /onboarding/step/:stepNumber`
- Progress retrieval: `GET /onboarding/progress`
- Resume capability: can pick up where user left off
- Completion flag: marks onboarding complete after step 4

**Usage Tracking & Trial Hard Stop**
- Middleware: `checkTrialLimit` → blocks generation if 2 trial videos used
- Endpoint: `GET /usage` → returns current usage vs limit
- Monthly tracking: resets on first day of month
- Plan-based limits: 2 (trial) → 25 (basic) → 60 (pro)

**Protected API Endpoints** (require auth + account state check)
- `POST /generate` → start content generation (checks usage limit first)
- `GET /analytics` → get video performance data
- `GET /schedule` → get upcoming publish queue
- `POST /publish/:contentId` → manually publish a video (checks ownership)
- `GET /usage` → get current month's usage stats

**Original Agent Endpoints** (kept as-is)
- `GET /health` → system status
- All 7 AI agents running in the original pipeline

### 2. Database Schema (`YT_labs_schema.sql`)

**Status:** ✅ Complete - ready to run in Supabase

**11 Tables created:**

1. **subscriptions** - User subscription status, plan, Stripe IDs
2. **onboarding_progress** - Track onboarding step completion per user
3. **user_settings** - Channel info, preferences, YouTube credentials
4. **usage_tracking** - Monthly video generation/publication counts
5. **content_strategies** - Topic research and strategy data
6. **scripts** - Generated video scripts
7. **thumbnails** - AI-generated thumbnail images
8. **seo_data** - YouTube SEO optimization (title, description, tags)
9. **productions** - Video processing status and assets
10. **publish_schedule** - Scheduled videos with YouTube URLs
11. **analytics_reports** - Video performance metrics

**Security:**
- Row-level security (RLS) enabled on all tables
- Users can only access their own data
- Indexes on user_id and frequently queried columns

### 3. Environment Configuration (`YT_labs_.env.example`)

**Status:** ✅ Complete - copy to `.env` and fill in values

**All required variables:**
- Supabase credentials (URL, keys, secrets)
- Stripe API keys and price IDs
- AI API keys (Google Gemini, OpenAI)
- YouTube OAuth credentials
- AWS S3 credentials
- Email service credentials
- Feature flags and limits

---

## Database Schema

### Tables Overview

#### 1. subscriptions
```
- id (UUID, PK)
- user_id (FK to auth.users)
- stripe_customer_id (unique)
- stripe_subscription_id (unique)
- plan ('trial', 'basic', 'pro')
- status ('active', 'expired', 'canceled')
- current_period_start / end (TIMESTAMP)
- cancel_at (TIMESTAMP)
- paid_at (TIMESTAMP)
- created_at / updated_at
```

**Why:** Tracks which plan user is on, subscription status for access control, Stripe IDs for webhook processing.

#### 2. onboarding_progress
```
- id (UUID, PK)
- user_id (FK, unique)
- current_step (1-4)
- step_1_youtube_connected (BOOL)
- step_2_channel_info (JSONB)
- step_3_publishing_mode (TEXT)
- step_4_first_video_triggered (BOOL)
- completed (BOOL)
- created_at / updated_at
```

**Why:** Allows users to pause onboarding and resume later. Tracks which step they're on. Enables audit trail.

#### 3. user_settings
```
- id (UUID, PK)
- user_id (FK, unique)
- youtube_channel_id (TEXT)
- youtube_credentials (JSONB, encrypted)
- niche, target_audience, content_style, posting_frequency (TEXT)
- auto_publish (BOOL)
- created_at / updated_at
```

**Why:** Stores user's channel preferences and YouTube OAuth tokens. Used to personalize content generation.

#### 4. usage_tracking
```
- id (UUID, PK)
- user_id (FK)
- billing_month (DATE)
- is_trial (BOOL)
- plan (TEXT)
- videos_generated (INT)
- videos_published (INT)
- created_at / updated_at
- UNIQUE(user_id, billing_month)
```

**Why:** Enforces plan limits. One record per user per month. Trial shows 2-video hard stop. Basic = 25, Pro = 60.

#### 5-11. Content Tables
(content_strategies, scripts, thumbnails, seo_data, productions, publish_schedule, analytics_reports)

**Why:** Store all content throughout the pipeline. Each has `user_id` for multi-tenant isolation. Linked by foreign keys to show progress through pipeline.

**Example flow:**
1. User generates → creates `content_strategies` + `scripts`
2. System creates thumbnail → `thumbnails` record
3. System optimizes SEO → `seo_data` record
4. System assembles video → `productions` record
5. System publishes → updates `publish_schedule` record
6. System tracks performance → `analytics_reports` record

---

## API Endpoints

### Authentication Endpoints (PUBLIC)

#### Sign Up
```
POST /auth/signup
Body: { email, password }

Response (success):
{
  "success": true,
  "message": "Account created. Please verify your email.",
  "user": { id, email, ... }
}

What happens on backend:
1. Creates user in Supabase Auth
2. Creates subscription record (plan: 'trial', status: 'active')
3. Creates onboarding_progress record (step: 1)
4. Creates usage_tracking record (is_trial: true, videos_generated: 0)

User is now in FREE TRIAL mode.
```

#### Login
```
POST /auth/login
Body: { email, password }

Response (varies by account state):

If not paid:
{
  "state": "not_paid",
  "token": "jwt-token",
  "redirect": "/payment"
}

If onboarding incomplete:
{
  "state": "onboarding_incomplete",
  "token": "jwt-token",
  "current_step": 2,
  "redirect": "/onboarding"
}

If all good:
{
  "success": true,
  "state": "authenticated",
  "token": "jwt-token",
  "redirect": "/dashboard",
  "user": { ... }
}

What happens on backend:
1. Validates email/password
2. Runs 5-condition check (see section below)
3. Routes user based on account state
```

#### Check Account State
```
GET /auth/check-state
Headers: { Authorization: "Bearer jwt-token" }

Response:
{
  "hasAccount": true,
  "isPaid": false,
  "isSubscriptionActive": false,
  "isOnboarded": false,
  "currentStep": 1,
  "plan": null
}

Use this on frontend to determine which page to show.
```

### Payment Endpoints (PROTECTED - require JWT)

#### Create Checkout
```
POST /create-checkout
Headers: { Authorization: "Bearer jwt-token" }
Body: { plan: "basic" or "pro" }

Response:
{
  "sessionId": "cs_test_xxxxx"
}

Frontend then uses sessionId to redirect to Stripe Checkout.

What happens on backend:
1. Creates/retrieves Stripe customer (linked to user)
2. Creates checkout session with appropriate price ID
3. Returns session ID for frontend redirect
```

#### Stripe Webhook Handler
```
POST /webhook/stripe
(Stripe calls this automatically)

Handles these events:
1. checkout.session.completed
   - Updates subscription record
   - Sets plan to 'basic' or 'pro'
   - Sets status to 'active'
   - Creates usage_tracking record for paid tier

2. customer.subscription.updated
   - Updates subscription dates
   - Reflects billing period changes

3. customer.subscription.deleted
   - Sets status to 'canceled'
   - User can no longer access dashboard
```

### Onboarding Endpoints (PROTECTED)

#### Save Onboarding Step
```
POST /onboarding/step/:stepNumber
Headers: { Authorization: "Bearer jwt-token" }
Body: { data specific to step }

Step 1 body: { connected: true }
Step 2 body: { niche, audience, style, frequency }
Step 3 body: { mode: "auto" or "manual" }
Step 4 body: { triggered: true }

Response:
{
  "success": true,
  "nextStep": 2
}

What happens:
1. Saves step data to onboarding_progress
2. Increments current_step
3. On step 4: sets completed = true
```

#### Get Onboarding Progress
```
GET /onboarding/progress
Headers: { Authorization: "Bearer jwt-token" }

Response:
{
  "id": "uuid",
  "user_id": "uuid",
  "current_step": 2,
  "step_1_youtube_connected": true,
  "step_2_channel_info": { niche, audience, ... },
  "step_3_publishing_mode": "auto",
  "step_4_first_video_triggered": false,
  "completed": false
}

Use to resume onboarding from where user left off.
```

### Content Generation Endpoints (PROTECTED + ACCOUNT CHECK + TRIAL CHECK)

#### Generate Content
```
POST /generate
Headers: { Authorization: "Bearer jwt-token" }
Body: { topic?, style?, length? }

Response (success):
{
  "success": true,
  "result": {
    "contentId": "uuid",
    "title": "Generated video title",
    "scheduledFor": "2025-05-19T14:30:00Z"
  }
}

Response (trial limit exceeded):
{
  "state": "trial_limit_exceeded",
  "message": "Free trial limit (2 videos) reached. Please select a plan to continue.",
  "videos_used": 2,
  "limit": 2
}

Response (monthly limit exceeded):
{
  "error": "Monthly video limit reached",
  "current": 25,
  "limit": 25
}

What happens on backend:
1. ✅ Verifies JWT (user logged in)
2. ✅ Checks account state (5-condition check)
3. ✅ Checks trial limit (2 videos max for trial users)
4. ✅ Checks monthly usage vs plan limit
5. ✅ Runs 7-agent pipeline
6. ✅ Saves production to database
7. ✅ Increments usage counter
8. ✅ Returns content ID

HARD STOP: If trial limit reached, returns 402 status and blocks generation.
```

#### Get Analytics
```
GET /analytics
Headers: { Authorization: "Bearer jwt-token" }

Response:
{
  "totalViews": 12500,
  "avgWatchTime": "3:45",
  "avgCTR": 0.085,
  "recentVideos": [
    {
      "title": "...",
      "views": 1200,
      "watchTime": 3600,
      "ctr": 0.12
    }
  ]
}
```

#### Get Schedule
```
GET /schedule
Headers: { Authorization: "Bearer jwt-token" }

Response:
{
  "upcoming": [
    {
      "id": "uuid",
      "title": "Video title",
      "publishTime": "2025-05-20T10:00:00Z",
      "status": "scheduled"
    }
  ],
  "published": [...]
}
```

#### Get Usage
```
GET /usage
Headers: { Authorization: "Bearer jwt-token" }

Response:
{
  "videosGenerated": 18,
  "videosPublished": 15,
  "limit": 25,
  "plan": "basic"
}
```

#### Publish Content
```
POST /publish/:contentId
Headers: { Authorization: "Bearer jwt-token" }

Response:
{
  "success": true,
  "result": {
    "youtubeId": "dQw4w9WgXcQ",
    "youtubeUrl": "https://youtu.be/dQw4w9WgXcQ"
  }
}
```

---

## Free Trial Hard Stop Logic

### How It Works

**User signs up → Automatically gets FREE TRIAL**

```
User Action          Database Update                Check Fails At
─────────────────────────────────────────────────────────────────
Sign up              subscription.plan = 'trial'    N/A
                     usage_tracking.is_trial = true

Generate video #1    usage_tracking.videos_generated = 1    ✅ Pass
                     (checkTrialLimit middleware)

Generate video #2    usage_tracking.videos_generated = 2    ✅ Pass
                     (checkTrialLimit middleware)

Try to generate #3   (checkTrialLimit middleware checks)      ❌ FAIL
                     
                     Response (HTTP 402):
                     {
                       "state": "trial_limit_exceeded",
                       "message": "Free trial limit (2 videos) reached.",
                       "videos_used": 2,
                       "limit": 2
                     }
                     
                     Dashboard shows:
                     "Upgrade to continue. Choose Basic ($15) or Pro ($55)"
```

### Middleware Implementation

```javascript
// In YT_labs_index.js - checkTrialLimit middleware

async checkTrialLimit(req, res, next) {
  const userId = req.user.id;
  
  // Get current month's usage
  const { data: usage } = await supabase
    .from('usage_tracking')
    .select('videos_generated')
    .eq('user_id', userId)
    .eq('is_trial', true)
    .single();
  
  // Hard stop at 2 videos
  if (usage && usage.videos_generated >= 2) {
    return res.status(402).json({
      state: 'trial_limit_exceeded',
      message: 'Free trial limit (2 videos) reached. Please select a plan to continue.',
      videos_used: 2,
      limit: 2
    });
  }
  
  next(); // Allow generation
}
```

### What Happens Next

**User pays for plan:**

```
1. Frontend redirects to Stripe Checkout (/create-checkout)
2. User completes payment
3. Stripe webhook fires → updates subscription
4. subscription.plan = 'basic' or 'pro'
5. usage_tracking record created for new billing month
6. subscription.status = 'active'

User logs in:
1. Account state check passes all 5 conditions
2. Redirects to /dashboard
3. Can now generate videos up to plan limit

Monthly reset:
1. On first day of each month, new usage_tracking record created
2. videos_generated resets to 0
3. Cycle continues for paid plan
```

---

## Account State Check (5-Condition System)

### The Logic

**Every time user tries to access anything (login, direct URL, API call):**

```javascript
async checkAccountState(req, res, next) {
  const userId = req.user.id;
  
  // Condition 1: Account exists? (already done by JWT)
  
  // Condition 2: User paid?
  const subscription = await db.getSubscription(userId);
  if (!subscription) return redirect('/payment');
  
  // Condition 3: Subscription active?
  if (subscription.status !== 'active') return redirect('/reactivate');
  
  // Condition 4: Onboarding complete?
  const onboarding = await db.getOnboarding(userId);
  if (!onboarding.completed) return redirect('/onboarding?step=' + onboarding.current_step);
  
  // Condition 5: All pass
  return next(); // Allow access to dashboard
}
```

### User Journey Examples

**Example 1: New User**
```
User clicks "Get Started"
  ↓
/signup page
  ↓
POST /auth/signup (email, password)
  ↓
Backend creates:
  - auth.users entry
  - subscriptions record (trial)
  - onboarding_progress record (step 1)
  - usage_tracking record (trial, 0 videos)
  ↓
User sees /onboarding page (Step 1)
```

**Example 2: Signed Up But Not Paid**
```
User login
  ↓
POST /auth/login
  ↓
Condition 2 fails: subscription.status != 'active'
  ↓
Response: { state: 'not_paid', redirect: '/payment' }
  ↓
Frontend redirects to /payment
  ↓
User selects plan, pays
  ↓
Stripe webhook updates subscription.status = 'active'
  ↓
User logs in again, passes all conditions
  ↓
Redirects to /dashboard
```

**Example 3: Paid But Dropped Off Onboarding**
```
User paid, started onboarding, closed browser on step 2
  ↓
User logs in next day
  ↓
POST /auth/login
  ↓
Condition 2 passes: subscription is paid & active
Condition 4 fails: onboarding.current_step = 2, not completed
  ↓
Response: { state: 'onboarding_incomplete', current_step: 2, redirect: '/onboarding' }
  ↓
Frontend redirects to /onboarding?step=2
  ↓
GET /onboarding/progress returns step 2 data
  ↓
Frontend pre-fills previous answers
  ↓
User can continue from step 2
```

**Example 4: Subscription Expired**
```
User's monthly subscription ends (Stripe sends webhook)
  ↓
subscription.status = 'expired'
  ↓
User tries to login
  ↓
Condition 3 fails: subscription.status != 'active'
  ↓
Response: { state: 'subscription_expired', redirect: '/reactivate' }
  ↓
Frontend shows /reactivate page
  ↓
User clicks "Reactivate Plan"
  ↓
Creates new checkout session
  ↓
Stripe webhook updates subscription.status = 'active' again
  ↓
User can access dashboard
```

---

## Deployment Instructions

### Phase 1: Database Setup (1 hour)

#### Step 1: Create Supabase Project

1. Go to https://supabase.com
2. Sign in with your account
3. Click "New Project"
4. Name it: `ytlabs`
5. Select region closest to your users
6. Wait for project to initialize

#### Step 2: Run SQL Schema

1. In Supabase dashboard, go to SQL Editor
2. Click "New Query"
3. Copy entire content of `YT_labs_schema.sql`
4. Paste into editor
5. Click "Run"
6. **Wait for completion** ✓ All tables created with RLS

#### Step 3: Get Credentials

1. Go to Settings → API
2. Copy and save:
   - `Project URL` → `SUPABASE_URL`
   - `anon public key` → `SUPABASE_ANON_KEY`
   - `service_role secret` → `SUPABASE_SERVICE_KEY`
3. Go to Settings → Auth → JWT Settings
4. Copy `JWT Secret` → `SUPABASE_JWT_SECRET`

**Action item:** Add these to your `.env` file

---

### Phase 2: Stripe Setup (45 minutes)

#### Step 1: Create Stripe Account

1. Go to https://stripe.com
2. Create account
3. Go to Dashboard

#### Step 2: Create Price IDs

1. Go to Products
2. Click "Create product"
3. Name: "YT.labs Basic"
4. Price: $15
5. Billing period: Monthly
6. Copy Price ID → `STRIPE_BASIC_PRICE_ID`

Repeat for Pro:
- Name: "YT.labs Pro"
- Price: $55
- Copy Price ID → `STRIPE_PRO_PRICE_ID`

#### Step 3: API Keys

1. Go to Developers → API Keys
2. Copy "Publishable key" → `STRIPE_PUBLIC_KEY`
3. Copy "Secret key" → `STRIPE_SECRET_KEY`

#### Step 4: Webhooks

1. Go to Developers → Webhooks
2. Click "Add endpoint"
3. Endpoint URL: `https://yourdomain.com/webhook/stripe`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click "Create endpoint"
6. Copy "Signing secret" → `STRIPE_WEBHOOK_SECRET`

**Action item:** Add these to `.env` file

---

### Phase 3: AI APIs Setup (30 minutes)

#### Google Gemini (Free Trial Tier)

1. Go to https://aistudio.google.com
2. Create account / sign in
3. Go to API keys section
4. Click "Create API Key"
5. Copy key → `GOOGLE_GEMINI_API_KEY`

**Note:** Free tier has rate limits. For production, upgrade to paid plan.

#### OpenAI (Pro Tier)

1. Go to https://openai.com/api
2. Create account / sign in
3. Go to API keys
4. Click "Create new secret key"
5. Copy key → `OPENAI_API_KEY`

**Note:** Requires credit card. Budget ~$100/month for Pro tier users.

**Action item:** Add these to `.env` file

---

### Phase 4: YouTube OAuth Setup (45 minutes)

#### Step 1: Google Cloud Project

1. Go to https://console.cloud.google.com
2. Create new project: "YT.labs"
3. Wait for creation

#### Step 2: Enable YouTube API

1. Go to APIs & Services → Library
2. Search "YouTube Data API v3"
3. Click it
4. Click "Enable"

#### Step 3: OAuth Credentials

1. Go to APIs & Services → Credentials
2. Click "Create Credentials" → OAuth 2.0 Client ID
3. Choose "Web application"
4. Add Authorized redirect URIs:
   - `http://localhost:3456/auth/youtube/callback` (development)
   - `https://yourdomain.com/auth/youtube/callback` (production)
5. Click "Create"
6. Copy Client ID → `YOUTUBE_CLIENT_ID`
7. Copy Client Secret → `YOUTUBE_CLIENT_SECRET`

#### Step 4: OAuth Consent Screen

1. Go to APIs & Services → OAuth consent screen
2. Choose "External"
3. Fill in:
   - App name: "YT.labs"
   - User support email: your email
   - Developer contact: your email
4. Add scope: `https://www.googleapis.com/auth/youtube`
5. Click "Save and Continue"

**Action item:** Add credentials to `.env` file

---

### Phase 5: Backend Deployment (1.5 hours)

#### Option A: Deploy to Railway (Recommended)

1. Go to https://railway.app
2. Sign in with GitHub
3. Create new project
4. Connect to your GitHub repo (fork the backend)
5. Add environment variables from `.env`
6. Click "Deploy"
7. Railway assigns you a URL → add to `FRONTEND_URL` in `.env`

#### Option B: Deploy to Render

1. Go to https://render.com
2. Create account
3. Create "New Web Service"
4. Connect GitHub repo
5. Add environment variables
6. Click "Deploy"

#### Option C: Deploy to Vercel (Node.js)

1. Go to https://vercel.com
2. Import your backend repo
3. Add environment variables
4. Deploy

**After deployment:**
- Get your backend URL (e.g., `https://ytlabs-api.railway.app`)
- Add to frontend config
- Update Stripe webhook URL to deployed domain

---

### Phase 6: Frontend Deployment (45 minutes)

#### Deploy to Vercel

1. Go to https://vercel.com
2. Import your frontend repo (`YT_labs-main_2.zip`)
3. In build settings:
   - Build command: `npm run build` (if using build tool)
   - Output directory: `dist` or `.` (if static HTML)
4. Add environment variables:
   - `VITE_API_URL` = your backend URL
   - `VITE_STRIPE_PUBLIC_KEY` = Stripe public key
5. Click "Deploy"

**After deployment:**
- Get your frontend URL (e.g., `https://ytlabs.vercel.app`)
- Add to Stripe webhook redirect URLs
- Update `FRONTEND_URL` in backend `.env`

---

## Configuration & API Keys

### Complete .env Template

```env
# ========== SERVER ==========
PORT=3456
NODE_ENV=production
FRONTEND_URL=https://ytlabs.vercel.app

# ========== SUPABASE ==========
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_KEY=eyJhbGc...
SUPABASE_JWT_SECRET=your-jwt-secret

# ========== STRIPE ==========
STRIPE_PUBLIC_KEY=pk_live_xxxxx
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_BASIC_PRICE_ID=price_xxxxx
STRIPE_PRO_PRICE_ID=price_xxxxx

# ========== AI APIs ==========
GOOGLE_GEMINI_API_KEY=xxxxx
OPENAI_API_KEY=sk-xxxxx

# ========== YOUTUBE ==========
YOUTUBE_CLIENT_ID=xxxxx.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=xxxxx
YOUTUBE_REDIRECT_URI=https://ytlabs.vercel.app/auth/youtube/callback

# ========== STORAGE ==========
AWS_S3_BUCKET=ytlabs-videos
AWS_ACCESS_KEY_ID=xxxxx
AWS_SECRET_ACCESS_KEY=xxxxx

# ========== FEATURES ==========
ENABLE_FREE_TRIAL=true
FREE_TRIAL_VIDEO_LIMIT=2
```

### API Key Priority

| Tier | API | Model | Cost/Month |
|------|-----|-------|-----------|
| Trial | Google Gemini | Gemini 1.5 Flash | $0 (up to 2 videos) |
| Basic ($15) | Google Gemini | Gemini 1.5 Flash | ~$1.50/user |
| Pro ($55) | OpenAI + Gemini | GPT-4 Turbo (first 20) + Gemini (rest) | ~$3-5/user |

---

## Frontend Integration

### How to Wire Your Frontend

Your frontend (`YT_labs-main_2.zip`) needs to make API calls to the backend. Here's how:

### 1. Configure API Base URL

In your frontend HTML/JS:

```javascript
// At top of your main JavaScript file
const API_URL = process.env.VITE_API_URL || 'http://localhost:3456';
```

### 2. Sign Up Page

```javascript
// signup.js
async function handleSignUp(email, password) {
  const response = await fetch(`${API_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  const data = await response.json();
  
  if (data.success) {
    localStorage.setItem('jwt', data.user.id); // Store for later
    window.location.href = '/onboarding'; // Redirect to onboarding
  }
}
```

### 3. Login Page

```javascript
// login.js
async function handleLogin(email, password) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  const data = await response.json();
  
  if (data.success) {
    localStorage.setItem('jwt', data.token);
    window.location.href = data.redirect; // /dashboard, /onboarding, /payment, etc.
  } else {
    // Handle error (subscription expired, etc.)
    window.location.href = data.redirect;
  }
}
```

### 4. Account State Check (on every page load)

```javascript
// auth.js
async function checkAccountState() {
  const token = localStorage.getItem('jwt');
  
  if (!token) {
    window.location.href = '/login';
    return;
  }
  
  const response = await fetch(`${API_URL}/auth/check-state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  
  const state = await response.json();
  
  // Route based on account state
  if (!state.isPaid) window.location.href = '/payment';
  if (!state.isSubscriptionActive) window.location.href = '/reactivate';
  if (!state.isOnboarded) window.location.href = `/onboarding?step=${state.currentStep}`;
  
  // All good - user can access dashboard
}

// Call on every page load
document.addEventListener('DOMContentLoaded', checkAccountState);
```

### 5. Payment Page

```javascript
// payment.js
async function handlePaymentClick(plan) {
  const token = localStorage.getItem('jwt');
  
  const response = await fetch(`${API_URL}/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ plan }) // 'basic' or 'pro'
  });
  
  const { sessionId } = await response.json();
  
  // Redirect to Stripe Checkout
  const stripe = Stripe('pk_live_xxxxx'); // Use STRIPE_PUBLIC_KEY
  await stripe.redirectToCheckout({ sessionId });
}
```

### 6. Onboarding Page

```javascript
// onboarding.js
async function saveStep(stepNumber, data) {
  const token = localStorage.getItem('jwt');
  
  const response = await fetch(`${API_URL}/onboarding/step/${stepNumber}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  
  const result = await response.json();
  
  if (result.success) {
    // Move to next step or dashboard
    if (stepNumber === 4) {
      window.location.href = '/dashboard';
    } else {
      window.location.href = `/onboarding?step=${result.nextStep}`;
    }
  }
}
```

### 7. Dashboard - Generate Content

```javascript
// dashboard.js
async function generateVideo(topic, style) {
  const token = localStorage.getItem('jwt');
  
  const response = await fetch(`${API_URL}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ topic, style })
  });
  
  const data = await response.json();
  
  if (data.success) {
    // Show success - content is being generated
    showNotification(`Video "${data.result.title}" is being generated!`);
    refreshQueue(); // Refresh content queue
  } else if (data.state === 'trial_limit_exceeded') {
    // Hard stop - trial limit reached
    showModal('Upgrade Required', 'You\'ve used your 2 free videos. Choose a plan to continue.', [
      { label: 'Basic ($15/mo)', action: () => window.location.href = '/payment?plan=basic' },
      { label: 'Pro ($55/mo)', action: () => window.location.href = '/payment?plan=pro' }
    ]);
  } else {
    showError(data.error);
  }
}
```

### 8. Dashboard - Usage Display

```javascript
// dashboard.js
async function displayUsage() {
  const token = localStorage.getItem('jwt');
  
  const response = await fetch(`${API_URL}/usage`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const usage = await response.json();
  
  // Update DOM
  document.getElementById('videos-generated').textContent = usage.videosGenerated;
  document.getElementById('videos-limit').textContent = usage.limit;
  
  // Show progress bar
  const percent = (usage.videosGenerated / usage.limit) * 100;
  document.getElementById('usage-bar').style.width = percent + '%';
  
  // Show warning if near limit
  if (usage.videosGenerated >= usage.limit - 5) {
    showWarning(`You have only ${usage.limit - usage.videosGenerated} videos left this month!`);
  }
}

// Call on dashboard load
displayUsage();
```

---

## Testing Checklist

### Before Launch

- [ ] **Supabase**
  - [ ] SQL schema executed successfully
  - [ ] All 11 tables created
  - [ ] RLS policies enabled
  - [ ] Can create test user manually

- [ ] **Stripe**
  - [ ] Webhook receiving events (check webhook logs)
  - [ ] Test payment goes through
  - [ ] Subscription record created in database
  - [ ] Webhook updates subscription.status = 'active'

- [ ] **Backend**
  - [ ] Server starts without errors
  - [ ] `/health` endpoint returns 200
  - [ ] Sign up creates user + subscription
  - [ ] Login returns JWT token
  - [ ] Account state check works (tests all 5 conditions)
  - [ ] Trial limit enforcement works (blocks at 2 videos)
  - [ ] Generate endpoint works (paid users only)

- [ ] **Frontend**
  - [ ] Landing page loads
  - [ ] Sign up form submits to backend
  - [ ] Login form submits to backend
  - [ ] Redirects based on account state work
  - [ ] Payment button redirects to Stripe Checkout
  - [ ] Onboarding steps save and resume
  - [ ] Dashboard only shows when all conditions pass
  - [ ] Usage meter displays correctly

### Test User Journeys

1. **Free Trial User**
   - [ ] Sign up
   - [ ] Auto-redirected to onboarding
   - [ ] Complete 4 onboarding steps
   - [ ] Generate video #1 ✅
   - [ ] Generate video #2 ✅
   - [ ] Try to generate #3 → Blocked with upgrade modal ❌
   - [ ] Click "Upgrade" → Goes to payment page

2. **Basic Plan User**
   - [ ] Go to payment
   - [ ] Select Basic plan
   - [ ] Complete Stripe payment
   - [ ] Redirected to dashboard
   - [ ] Generate videos up to 25/month limit
   - [ ] Can publish videos manually

3. **Pro Plan User**
   - [ ] Go to payment
   - [ ] Select Pro plan
   - [ ] Complete Stripe payment
   - [ ] Can generate videos up to 60/month limit
   - [ ] First 20 use OpenAI, rest use Gemini

4. **Expired Subscription**
   - [ ] User with expired sub tries to login
   - [ ] Redirected to /reactivate
   - [ ] Can click "Reactivate"
   - [ ] Goes to payment page
   - [ ] After payment, access restored

5. **Incomplete Onboarding**
   - [ ] Start onboarding, close on step 2
   - [ ] Log out
   - [ ] Log back in
   - [ ] Redirected to step 2 (not step 1)
   - [ ] Previous answers pre-filled

---

## Summary of What You Have

| File | Purpose | Status |
|------|---------|--------|
| `YT_labs_index.js` | Complete backend with auth/payments/onboarding | ✅ Ready |
| `YT_labs_schema.sql` | Supabase database setup | ✅ Ready |
| `YT_labs_.env.example` | Environment variables template | ✅ Ready |
| `YT_labs-main_2.zip` | Your frontend design | ✅ Ready to wire |
| `youtube-automation-agent-master.zip` | Original backend agents | ✅ Ready to integrate |

## Next Immediate Steps

1. **Create Supabase project** and run SQL schema
2. **Set up Stripe** (create products, get keys)
3. **Configure API keys** (.env file)
4. **Deploy backend** to Railway/Render
5. **Wire frontend** to backend API calls
6. **Deploy frontend** to Vercel
7. **Test full user journey** (signup → onboarding → payment → dashboard)
8. **Launch!**

---

## Support Notes

- **Questions?** Check the Account State Check section - it handles 90% of issues
- **Trial not blocking?** Verify `checkTrialLimit` middleware is applied to `/generate` endpoint
- **Payments not working?** Check Stripe webhook logs - events must fire for subscription to update
- **Onboarding won't resume?** Verify `onboarding_progress` table has `current_step` saved
- **Users seeing old dashboard?** Clear browser cache or do hard refresh (Ctrl+Shift+R)

---

**Generated:** May 18, 2026
**For:** YT.labs SaaS
**Status:** Complete and ready for deployment
