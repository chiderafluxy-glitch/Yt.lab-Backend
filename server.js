const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3456;

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    realtime: {
      schema: 'realtime',
      transport: ws
    }
  }
);

// Middleware
app.use(express.json());
app.use(cors());

// Serve static frontend files
app.use(express.static('dashboard'));

// ========== AUTH MIDDLEWARE ==========

const verifyAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

const checkAccountState = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Check subscription
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!subscription) {
      return res.status(402).json({ 
        state: 'not_paid',
        message: 'Payment required'
      });
    }

    if (subscription.status !== 'active') {
      return res.status(402).json({ 
        state: 'subscription_expired',
        message: 'Subscription expired'
      });
    }

    // Check onboarding
    const { data: onboarding } = await supabase
      .from('onboarding_progress')
      .select('completed, current_step')
      .eq('user_id', userId)
      .single();

    if (!onboarding || !onboarding.completed) {
      return res.status(403).json({ 
        state: 'onboarding_incomplete',
        current_step: onboarding?.current_step || 1,
        message: 'Please complete onboarding'
      });
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('Account state check error:', error);
    res.status(500).json({ error: 'Account verification failed' });
  }
};

const checkTrialLimit = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { data: usage } = await supabase
      .from('usage_tracking')
      .select('videos_generated')
      .eq('user_id', userId)
      .gte('billing_month', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0])
      .single();

    if (usage && usage.videos_generated >= 2 && req.subscription.plan === 'trial') {
      return res.status(402).json({
        state: 'trial_limit_exceeded',
        message: 'Free trial limit (2 videos) reached. Please upgrade.',
        videos_used: 2,
        limit: 2
      });
    }

    next();
  } catch (error) {
    // If no usage record, allow
    next();
  }
};

// ========== PUBLIC ENDPOINTS ==========

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Sign up
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: authData, error: authError } = await supabase.auth.signUpWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    // Create subscription record (trial)
    await supabase.from('subscriptions').insert({
      user_id: userId,
      plan: 'trial',
      status: 'active',
      paid_at: new Date()
    });

    // Create onboarding progress
    await supabase.from('onboarding_progress').insert({
      user_id: userId,
      current_step: 1,
      completed: false
    });

    // Create usage tracking for trial
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    await supabase.from('usage_tracking').insert({
      user_id: userId,
      billing_month: startOfMonth.toISOString().split('T')[0],
      is_trial: true,
      videos_generated: 0,
      videos_published: 0
    });

    res.json({
      success: true,
      message: 'Account created',
      user: authData.user
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Login with account state check
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(401).json({ error: authError.message });
    }

    const userId = authData.user.id;
    const token = authData.session.access_token;

    // Run account state check
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!subscription) {
      return res.json({
        state: 'not_paid',
        token,
        redirect: '/payment'
      });
    }

    if (subscription.status !== 'active') {
      return res.json({
        state: 'subscription_expired',
        token,
        redirect: '/reactivate'
      });
    }

    const { data: onboarding } = await supabase
      .from('onboarding_progress')
      .select('completed, current_step')
      .eq('user_id', userId)
      .single();

    if (!onboarding || !onboarding.completed) {
      return res.json({
        state: 'onboarding_incomplete',
        token,
        current_step: onboarding?.current_step || 1,
        redirect: '/onboarding'
      });
    }

    res.json({
      success: true,
      state: 'authenticated',
      token,
      redirect: '/dashboard',
      user: authData.user
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Check account state
app.post('/auth/check-state', verifyAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!subscription) {
      return res.json({ hasAccount: true, isPaid: false });
    }

    const { data: onboarding } = await supabase
      .from('onboarding_progress')
      .select('completed, current_step')
      .eq('user_id', userId)
      .single();

    res.json({
      hasAccount: true,
      isPaid: !!subscription,
      isSubscriptionActive: subscription.status === 'active',
      isOnboarded: onboarding?.completed || false,
      currentStep: onboarding?.current_step || 1,
      plan: subscription?.plan || null
    });
  } catch (error) {
    res.status(500).json({ error: 'State check failed' });
  }
});

// ========== PAYMENT ENDPOINTS ==========

app.post('/create-checkout', verifyAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user.id;

    const prices = {
      basic: process.env.STRIPE_BASIC_PRICE_ID,
      pro: process.env.STRIPE_PRO_PRICE_ID
    };

    if (!prices[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    let customerId = existingSub?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { userId }
      });
      customerId = customer.id;

      await supabase.from('subscriptions')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', userId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: prices[plan],
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/dashboard`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing`,
      metadata: { userId, plan }
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Checkout creation failed' });
  }
});

// Stripe webhook
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === 'checkout.session.completed' || event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;
      const plan = subscription.metadata?.plan;

      if (userId) {
        await supabase.from('subscriptions')
          .update({
            stripe_subscription_id: subscription.id,
            plan: plan || subscription.metadata?.plan,
            status: 'active',
            current_period_start: new Date(subscription.current_period_start * 1000),
            current_period_end: new Date(subscription.current_period_end * 1000),
            paid_at: new Date()
          })
          .eq('user_id', userId);

        // Create usage tracking for paid tier
        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        await supabase.from('usage_tracking').insert({
          user_id: userId,
          billing_month: startOfMonth.toISOString().split('T')[0],
          is_trial: false,
          plan: plan || subscription.metadata?.plan,
          videos_generated: 0,
          videos_published: 0
        }).onConflict('user_id,billing_month').do('nothing');
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;

      if (userId) {
        await supabase.from('subscriptions')
          .update({ status: 'canceled' })
          .eq('user_id', userId);
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

// ========== ONBOARDING ENDPOINTS ==========

app.post('/onboarding/step/:stepNumber', verifyAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const stepNumber = parseInt(req.params.stepNumber);
    const data = req.body;

    const updates = { current_step: stepNumber + 1 };

    if (stepNumber === 1) {
      updates.step_1_youtube_connected = data.connected;
    } else if (stepNumber === 2) {
      updates.step_2_channel_info = data;
    } else if (stepNumber === 3) {
      updates.step_3_publishing_mode = data.mode;
    } else if (stepNumber === 4) {
      updates.step_4_first_video_triggered = data.triggered;
      updates.completed = true;
    }

    await supabase.from('onboarding_progress')
      .update(updates)
      .eq('user_id', userId);

    res.json({ success: true, nextStep: stepNumber + 1 });
  } catch (error) {
    console.error('Onboarding step error:', error);
    res.status(500).json({ error: 'Failed to save onboarding step' });
  }
});

app.get('/onboarding/progress', verifyAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: progress } = await supabase
      .from('onboarding_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch onboarding progress' });
  }
});

// ========== PROTECTED ENDPOINTS ==========

// Generate content (PLACEHOLDER - returns success without AI)
app.post('/generate', 
  verifyAuth, 
  checkAccountState,
  checkTrialLimit,
  async (req, res) => {
  try {
    const userId = req.user.id;
    const { topic, style } = req.body;

    // Get current usage
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthStr = startOfMonth.toISOString().split('T')[0];

    const { data: usage } = await supabase
      .from('usage_tracking')
      .select('videos_generated')
      .eq('user_id', userId)
      .eq('billing_month', monthStr)
      .single();

    const videoLimit = req.subscription.plan === 'basic' ? 25 : (req.subscription.plan === 'pro' ? 60 : 2);

    if (usage && usage.videos_generated >= videoLimit) {
      return res.status(402).json({
        error: 'Monthly video limit reached',
        current: usage.videos_generated,
        limit: videoLimit
      });
    }

    // PLACEHOLDER: Just return success and increment counter
    const title = topic || `Generated Video ${usage?.videos_generated + 1 || 1}`;
    
    if (usage) {
      await supabase.from('usage_tracking')
        .update({ videos_generated: usage.videos_generated + 1 })
        .eq('user_id', userId)
        .eq('billing_month', monthStr);
    }

    res.json({
      success: true,
      result: {
        contentId: `content_${Date.now()}`,
        title: title,
        scheduledFor: new Date(Date.now() + 86400000).toISOString()
      }
    });
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: 'Generation failed' });
  }
});

// Get analytics (PLACEHOLDER)
app.get('/analytics', verifyAuth, checkAccountState, async (req, res) => {
  try {
    res.json({
      totalViews: 0,
      totalWatchTime: '0:00',
      avgCTR: 0,
      recentVideos: []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get schedule (PLACEHOLDER)
app.get('/schedule', verifyAuth, checkAccountState, async (req, res) => {
  try {
    res.json({
      upcoming: [],
      published: []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// Get usage
app.get('/usage', verifyAuth, checkAccountState, async (req, res) => {
  try {
    const userId = req.user.id;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthStr = startOfMonth.toISOString().split('T')[0];

    const { data: usage } = await supabase
      .from('usage_tracking')
      .select('*')
      .eq('user_id', userId)
      .eq('billing_month', monthStr)
      .single();

    const limits = {
      basic: 25,
      pro: 60,
      trial: 2
    };

    res.json({
      videosGenerated: usage?.videos_generated || 0,
      videosPublished: usage?.videos_published || 0,
      limit: limits[req.subscription.plan] || 2,
      plan: req.subscription.plan
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// Publish content (PLACEHOLDER)
app.post('/publish/:contentId', verifyAuth, checkAccountState, async (req, res) => {
  try {
    res.json({
      success: true,
      result: {
        youtubeId: 'placeholder',
        youtubeUrl: 'https://youtube.com/watch?v=placeholder'
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to publish' });
  }
});

// Fallback: serve dashboard
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/dashboard/index.html');
});

// ========== START SERVER ==========

app.listen(PORT, () => {
  console.log(`\n✅ YT.labs Backend running on port ${PORT}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`🔧 API Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
