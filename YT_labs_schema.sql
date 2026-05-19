-- YT.labs Supabase Schema Setup
-- Run this in Supabase SQL Editor to set up the complete database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========== SUBSCRIPTION & BILLING TABLES ==========

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan TEXT DEFAULT 'trial', -- 'trial', 'basic', 'pro'
  status TEXT DEFAULT 'active', -- 'active', 'expired', 'canceled'
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at TIMESTAMP WITH TIME ZONE,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- ========== ONBOARDING TABLES ==========

-- Onboarding progress tracking
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_step INTEGER DEFAULT 1, -- 1, 2, 3, or 4
  step_1_youtube_connected BOOLEAN DEFAULT FALSE,
  step_2_channel_info JSONB, -- { niche, audience, style, frequency }
  step_3_publishing_mode TEXT, -- 'auto' or 'manual'
  step_4_first_video_triggered BOOLEAN DEFAULT FALSE,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_onboarding_user_id ON onboarding_progress(user_id);
CREATE INDEX idx_onboarding_completed ON onboarding_progress(completed);

-- ========== USER SETTINGS TABLES ==========

-- User settings and preferences
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  youtube_channel_id TEXT,
  youtube_credentials JSONB, -- encrypted { client_id, client_secret, access_token, refresh_token }
  niche TEXT,
  target_audience TEXT,
  content_style TEXT, -- 'Tutorial', 'Listicle', 'Story', 'News', 'Review'
  posting_frequency TEXT, -- 'Daily', 'Every 2 Days', 'Weekly'
  auto_publish BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);

-- ========== USAGE TRACKING ==========

-- Track video generation per user per billing month
CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  billing_month DATE NOT NULL, -- First day of month
  is_trial BOOLEAN DEFAULT FALSE,
  plan TEXT, -- 'basic', 'pro', or null for trial
  videos_generated INTEGER DEFAULT 0,
  videos_published INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, billing_month)
);

CREATE INDEX idx_usage_tracking_user_id ON usage_tracking(user_id);
CREATE INDEX idx_usage_tracking_month ON usage_tracking(billing_month);

-- ========== CONTENT TABLES (Multi-tenant) ==========

-- Content strategies
CREATE TABLE IF NOT EXISTS content_strategies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  angle TEXT,
  target_audience TEXT,
  content_type TEXT,
  keywords JSONB,
  estimated_views INTEGER DEFAULT 0,
  best_publish_time TEXT,
  competitor_analysis JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_content_strategies_user_id ON content_strategies(user_id);
CREATE INDEX idx_content_strategies_created ON content_strategies(created_at);

-- Scripts
CREATE TABLE IF NOT EXISTS scripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES content_strategies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  hook JSONB,
  introduction JSONB,
  main_content JSONB,
  conclusion JSONB,
  call_to_action JSONB,
  full_script TEXT,
  duration TEXT,
  tone TEXT,
  pacing TEXT,
  keywords JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_scripts_user_id ON scripts(user_id);
CREATE INDEX idx_scripts_strategy_id ON scripts(strategy_id);

-- Thumbnails
CREATE TABLE IF NOT EXISTS thumbnails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  concept TEXT,
  prompt TEXT,
  dimensions TEXT,
  file_size INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_thumbnails_user_id ON thumbnails(user_id);
CREATE INDEX idx_thumbnails_script_id ON thumbnails(script_id);

-- SEO data
CREATE TABLE IF NOT EXISTS seo_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  tags JSONB,
  hashtags JSONB,
  chapters JSONB,
  end_screen TEXT,
  seo_score INTEGER DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_seo_data_user_id ON seo_data(user_id);
CREATE INDEX idx_seo_data_script_id ON seo_data(script_id);

-- Productions (video processing)
CREATE TABLE IF NOT EXISTS productions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES content_strategies(id) ON DELETE CASCADE,
  script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
  thumbnail_id UUID REFERENCES thumbnails(id) ON DELETE CASCADE,
  seo_id UUID REFERENCES seo_data(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'processing', -- 'processing', 'ready', 'scheduled', 'published', 'failed'
  assets JSONB,
  timeline JSONB,
  scheduled_publish_time TIMESTAMP WITH TIME ZONE,
  priority INTEGER DEFAULT 50,
  estimated_duration TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_productions_user_id ON productions(user_id);
CREATE INDEX idx_productions_status ON productions(status);
CREATE INDEX idx_productions_scheduled_time ON productions(scheduled_publish_time);

-- Publish schedule
CREATE TABLE IF NOT EXISTS publish_schedule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  production_id UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  publish_time TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'publishing', 'published', 'failed'
  priority INTEGER DEFAULT 50,
  metadata JSONB,
  youtube_id TEXT,
  youtube_url TEXT,
  published_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_publish_schedule_user_id ON publish_schedule(user_id);
CREATE INDEX idx_publish_schedule_status ON publish_schedule(status);
CREATE INDEX idx_publish_schedule_time ON publish_schedule(publish_time);

-- Analytics reports
CREATE TABLE IF NOT EXISTS analytics_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  production_id UUID REFERENCES productions(id) ON DELETE CASCADE,
  youtube_id TEXT,
  video_details JSONB,
  analytics_data JSONB, -- { views, watch_time, likes, comments, ctr, retention_rate }
  thumbnail_metrics JSONB,
  seo_metrics JSONB,
  insights JSONB,
  performance_score INTEGER DEFAULT 0,
  performance_grade TEXT,
  analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_analytics_reports_user_id ON analytics_reports(user_id);
CREATE INDEX idx_analytics_reports_production_id ON analytics_reports(production_id);

-- ========== ROW LEVEL SECURITY (RLS) ==========

-- Enable RLS on all tables
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE thumbnails ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE productions ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own data
CREATE POLICY "Users can access own subscriptions" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can access own onboarding" ON onboarding_progress
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can access own settings" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can access own usage" ON usage_tracking
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can access own strategies" ON content_strategies
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can access own scripts" ON scripts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can access own thumbnails" ON thumbnails
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can access own seo_data" ON seo_data
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can access own productions" ON productions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can access own schedule" ON publish_schedule
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can access own analytics" ON analytics_reports
  FOR SELECT USING (auth.uid() = user_id);

-- ========== AUDIT LOG TABLE ==========

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ========== SAMPLE QUERIES FOR TESTING ==========

-- Get user subscription
-- SELECT * FROM subscriptions WHERE user_id = 'user-uuid';

-- Get user onboarding progress
-- SELECT * FROM onboarding_progress WHERE user_id = 'user-uuid';

-- Get monthly usage
-- SELECT * FROM usage_tracking 
-- WHERE user_id = 'user-uuid' 
-- AND billing_month = DATE_TRUNC('month', NOW())::date;

-- Get user's content queue
-- SELECT p.id, s.title, p.status, p.scheduled_publish_time
-- FROM productions p
-- LEFT JOIN scripts s ON p.script_id = s.id
-- WHERE p.user_id = 'user-uuid'
-- ORDER BY p.created_at DESC;
