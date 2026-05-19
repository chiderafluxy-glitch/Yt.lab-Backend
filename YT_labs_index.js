const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Load environment variables
dotenv.config();

const { Logger } = require('./utils/logger');
const { Database } = require('./database/db');
const { CredentialManager } = require('./utils/credential-manager');
const { ContentStrategyAgent } = require('./agents/content-strategy-agent');
const { ScriptWriterAgent } = require('./agents/script-writer-agent');
const { ThumbnailDesignerAgent } = require('./agents/thumbnail-designer-agent');
const { SEOOptimizerAgent } = require('./agents/seo-optimizer-agent');
const { ProductionManagementAgent } = require('./agents/production-management-agent');
const { PublishingSchedulingAgent } = require('./agents/publishing-scheduling-agent');
const { AnalyticsOptimizationAgent } = require('./agents/analytics-optimization-agent');
const { DailyAutomation } = require('./schedules/daily-automation');
const chalk = require('chalk');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

class YouTubeAutomationSaaS {
  constructor() {
    this.logger = new Logger('YT.labs');
    this.db = null;
    this.credentials = null;
    this.agents = {};
    this.app = express();
    this.isInitialized = false;
  }

  async initialize() {
    try {
      console.log(chalk.cyan.bold('\n🎬 YT.labs SaaS v1.0'));
      console.log(chalk.gray('─'.repeat(50)));
      
      // Initialize database
      this.logger.info('Initializing database...');
      this.db = new Database();
      await this.db.initialize();
      
      // Load credentials
      this.logger.info('Loading credentials...');
      this.credentials = new CredentialManager();
      const credentialsValid = await this.credentials.validateAll();
      
      if (!credentialsValid) {
        console.log(chalk.yellow('\n⚠️  Some credentials are missing or invalid.'));
        console.log(chalk.yellow('Run: npm run credentials:setup'));
        return false;
      }
      
      // Initialize agents
      this.logger.info('Initializing agents...');
      await this.initializeAgents();
      
      // Setup API endpoints
      this.setupAPI();
      
      // Initialize scheduler
      this.logger.info('Setting up automation scheduler...');
      this.scheduler = new DailyAutomation(this.agents, this.db);
      await this.scheduler.initialize();
      
      this.isInitialized = true;
      this.logger.success('YT.labs SaaS initialized successfully!');
      
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize:', error);
      return false;
    }
  }

  async initializeAgents() {
    this.agents = {
      strategy: new ContentStrategyAgent(this.db, this.credentials),
      scriptWriter: new ScriptWriterAgent(this.db, this.credentials),
      thumbnailDesigner: new ThumbnailDesignerAgent(this.db, this.credentials),
      seoOptimizer: new SEOOptimizerAgent(this.db, this.credentials),
      production: new ProductionManagementAgent(this.db, this.credentials),
      publishing: new PublishingSchedulingAgent(this.db, this.credentials),
      analytics: new AnalyticsOptimizationAgent(this.db, this.credentials)
    };

    for (const [name, agent] of Object.entries(this.agents)) {
      await agent.initialize();
      this.logger.info(`✓ ${name} agent initialized`);
    }
  }

  // Middleware: Verify JWT and get user from Supabase
  async verifyAuth(req, res, next) {
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
  }

  // Middleware: Check user account state (5-condition check)
  async checkAccountState(req, res, next) {
    try {
      const userId = req.user.id;

      // 1. Check if account exists (already done by JWT verification)
      
      // 2. Check if user has paid
      const { data: subscription, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!subscription) {
        return res.status(402).json({ 
          state: 'not_paid',
          message: 'Payment required to access dashboard'
        });
      }

      // 3. Check if subscription is active
      if (subscription.status !== 'active') {
        return res.status(402).json({ 
          state: 'subscription_expired',
          message: 'Subscription expired. Please reactivate.'
        });
      }

      // 4. Check if onboarding is complete
      const { data: onboarding } = await supabase
        .from('onboarding_progress')
        .select('completed, current_step')
        .eq('user_id', userId)
        .single();

      if (!onboarding || !onboarding.completed) {
        const currentStep = onboarding?.current_step || 1;
        return res.status(403).json({ 
          state: 'onboarding_incomplete',
          current_step: currentStep,
          message: 'Please complete onboarding first'
        });
      }

      // 5. All checks pass - store subscription info in request
      req.subscription = subscription;
      next();
    } catch (error) {
      this.logger.error('Account state check failed:', error);
      res.status(500).json({ error: 'Account verification failed' });
    }
  }

  // Middleware: Check free trial limit (2 videos max)
  async checkTrialLimit(req, res, next) {
    try {
      const userId = req.user.id;

      const { data: usage } = await supabase
        .from('usage_tracking')
        .select('videos_generated')
        .eq('user_id', userId)
        .eq('is_trial', true)
        .single();

      if (usage && usage.videos_generated >= 2) {
        return res.status(402).json({
          state: 'trial_limit_exceeded',
          message: 'Free trial limit (2 videos) reached. Please select a plan to continue.',
          videos_used: 2,
          limit: 2
        });
      }

      next();
    } catch (error) {
      // If no usage record exists, allow (new user)
      next();
    }
  }

  setupAPI() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Serve frontend from dashboard folder
    this.app.use(express.static(path.join(__dirname, 'dashboard')));
    
    // ========== PUBLIC ROUTES ==========
    
    // Serve landing page
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
    });

    // Sign up
    this.app.post('/auth/signup', async (req, res) => {
      try {
        const { email, password } = req.body;

        // Create user in Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUpWithPassword({
          email,
          password
        });

        if (authError) {
          return res.status(400).json({ error: authError.message });
        }

        const userId = authData.user.id;

        // Create subscription record (trial status)
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
          billing_month: startOfMonth,
          is_trial: true,
          videos_generated: 0,
          videos_published: 0
        });

        res.json({
          success: true,
          message: 'Account created. Please verify your email.',
          user: authData.user
        });
      } catch (error) {
        this.logger.error('Signup error:', error);
        res.status(500).json({ error: 'Signup failed' });
      }
    });

    // Login with account state check
    this.app.post('/auth/login', async (req, res) => {
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

        // Run 5-condition check
        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (!subscription) {
          return res.json({
            state: 'not_paid',
            token: authData.session.access_token,
            redirect: '/payment'
          });
        }

        if (subscription.status !== 'active') {
          return res.json({
            state: 'subscription_expired',
            token: authData.session.access_token,
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
            token: authData.session.access_token,
            current_step: onboarding?.current_step || 1,
            redirect: '/onboarding'
          });
        }

        // All good - redirect to dashboard
        res.json({
          success: true,
          state: 'authenticated',
          token: authData.session.access_token,
          redirect: '/dashboard',
          user: authData.user
        });
      } catch (error) {
        this.logger.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
      }
    });

    // Check account state endpoint
    this.app.post('/auth/check-state', this.verifyAuth.bind(this), async (req, res) => {
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

    // ========== STRIPE WEBHOOKS ==========

    // Create Stripe checkout session
    this.app.post('/create-checkout', this.verifyAuth.bind(this), async (req, res) => {
      try {
        const { plan } = req.body; // 'basic' or 'pro'
        const userId = req.user.id;

        const prices = {
          basic: process.env.STRIPE_BASIC_PRICE_ID,
          pro: process.env.STRIPE_PRO_PRICE_ID
        };

        const { data: existingSub } = await supabase
          .from('subscriptions')
          .select('stripe_customer_id')
          .eq('user_id', userId)
          .single();

        let customerId = existingSub?.stripe_customer_id;

        // Create or get Stripe customer
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

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          payment_method_types: ['card'],
          line_items: [
            {
              price: prices[plan],
              quantity: 1
            }
          ],
          mode: 'subscription',
          success_url: `${process.env.FRONTEND_URL}/dashboard`,
          cancel_url: `${process.env.FRONTEND_URL}/pricing`,
          metadata: { userId, plan }
        });

        res.json({ sessionId: session.id });
      } catch (error) {
        this.logger.error('Checkout error:', error);
        res.status(500).json({ error: 'Checkout creation failed' });
      }
    });

    // Stripe webhook handler
    this.app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
      const sig = req.headers['stripe-signature'];

      try {
        const event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );

        switch (event.type) {
          case 'checkout.session.completed':
          case 'customer.subscription.updated':
            const subscription = event.data.object;
            const userId = subscription.metadata.userId;
            const plan = subscription.metadata.plan;

            await supabase.from('subscriptions')
              .update({
                stripe_subscription_id: subscription.id,
                plan,
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
              billing_month: startOfMonth,
              is_trial: false,
              plan,
              videos_generated: 0,
              videos_published: 0
            }).onConflict('user_id,billing_month').do('nothing');

            break;

          case 'customer.subscription.deleted':
            const deletedSub = event.data.object;
            const deletedUserId = deletedSub.metadata.userId;

            await supabase.from('subscriptions')
              .update({ status: 'canceled' })
              .eq('user_id', deletedUserId);

            break;
        }

        res.json({ received: true });
      } catch (error) {
        this.logger.error('Webhook error:', error);
        res.status(400).send(`Webhook Error: ${error.message}`);
      }
    });

    // ========== ONBOARDING ==========

    this.app.post('/onboarding/step/:stepNumber', this.verifyAuth.bind(this), async (req, res) => {
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
        this.logger.error('Onboarding step error:', error);
        res.status(500).json({ error: 'Failed to save onboarding step' });
      }
    });

    this.app.get('/onboarding/progress', this.verifyAuth.bind(this), async (req, res) => {
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

    // ========== PROTECTED DASHBOARD ROUTES ==========

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        initialized: this.isInitialized,
        agents: Object.keys(this.agents),
        timestamp: new Date().toISOString()
      });
    });

    // Generate content (with usage tracking and trial limit)
    this.app.post('/generate', 
      this.verifyAuth.bind(this), 
      this.checkAccountState.bind(this),
      this.checkTrialLimit.bind(this),
      async (req, res) => {
      try {
        const userId = req.user.id;
        const { topic, style, length } = req.body;
        const plan = req.subscription.plan;

        // Check usage limits
        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const { data: usage } = await supabase
          .from('usage_tracking')
          .select('videos_generated')
          .eq('user_id', userId)
          .eq('billing_month', startOfMonth)
          .single();

        const videoLimit = plan === 'basic' ? 25 : (plan === 'pro' ? 60 : 2);
        
        if (usage && usage.videos_generated >= videoLimit) {
          return res.status(402).json({
            error: 'Monthly video limit reached',
            current: usage.videos_generated,
            limit: videoLimit
          });
        }

        // Generate content
        const result = await this.generateContent(topic, style, length, userId);

        // Update usage
        if (usage) {
          await supabase.from('usage_tracking')
            .update({ videos_generated: usage.videos_generated + 1 })
            .eq('user_id', userId)
            .eq('billing_month', startOfMonth);
        }

        res.json({ success: true, result });
      } catch (error) {
        this.logger.error('Generation error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get analytics
    this.app.get('/analytics', 
      this.verifyAuth.bind(this), 
      this.checkAccountState.bind(this),
      async (req, res) => {
      try {
        const userId = req.user.id;
        const analytics = await this.agents.analytics.getRecentAnalytics(userId);
        res.json(analytics);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get schedule
    this.app.get('/schedule', 
      this.verifyAuth.bind(this), 
      this.checkAccountState.bind(this),
      async (req, res) => {
      try {
        const userId = req.user.id;
        const schedule = await this.db.getUpcomingSchedule(userId);
        res.json(schedule);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Manual publish
    this.app.post('/publish/:contentId', 
      this.verifyAuth.bind(this), 
      this.checkAccountState.bind(this),
      async (req, res) => {
      try {
        const userId = req.user.id;
        const { contentId } = req.params;

        // Verify ownership
        const { data: content } = await supabase
          .from('productions')
          .select('id')
          .eq('id', contentId)
          .eq('user_id', userId)
          .single();

        if (!content) {
          return res.status(403).json({ error: 'Content not found or unauthorized' });
        }

        const result = await this.agents.publishing.publishContent(contentId);
        res.json({ success: true, result });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get usage stats
    this.app.get('/usage', 
      this.verifyAuth.bind(this), 
      this.checkAccountState.bind(this),
      async (req, res) => {
      try {
        const userId = req.user.id;
        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        const { data: usage } = await supabase
          .from('usage_tracking')
          .select('*')
          .eq('user_id', userId)
          .eq('billing_month', startOfMonth)
          .single();

        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('plan')
          .eq('user_id', userId)
          .single();

        const limits = {
          basic: 25,
          pro: 60,
          trial: 2
        };

        res.json({
          videosGenerated: usage?.videos_generated || 0,
          videosPublished: usage?.videos_published || 0,
          limit: limits[subscription?.plan] || 2,
          plan: subscription?.plan
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch usage' });
      }
    });

    // Fallback: serve dashboard for all undefined routes
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
    });
  }

  async generateContent(topic = null, style = null, length = 'medium', userId = null) {
    this.logger.info(`Starting content generation for user: ${userId}`);
    
    const strategy = await this.agents.strategy.generateContentStrategy(topic);
    this.logger.info(`Strategy generated: ${strategy.topic}`);
    
    const script = await this.agents.scriptWriter.generateScript(strategy);
    this.logger.info(`Script generated: ${script.title}`);
    
    const thumbnail = await this.agents.thumbnailDesigner.generateThumbnail(script);
    this.logger.info('Thumbnail generated');
    
    const seoData = await this.agents.seoOptimizer.optimize(script, strategy);
    this.logger.info('SEO optimization complete');
    
    const productionData = await this.agents.production.processContent({
      strategy,
      script,
      thumbnail,
      seo: seoData,
      userId
    });
    this.logger.info('Production processing complete');
    
    const contentId = await this.db.saveProductionData(productionData, userId);
    this.logger.info(`Content saved with ID: ${contentId}`);
    
    return {
      contentId,
      title: script.title,
      scheduledFor: productionData.scheduledPublishTime
    };
  }

  async start() {
    const initialized = await this.initialize();
    
    if (!initialized) {
      console.log(chalk.red('\n❌ Failed to initialize. Please check your configuration.'));
      process.exit(1);
    }
    
    const PORT = process.env.PORT || 3456;
    this.app.listen(PORT, () => {
      console.log(chalk.green(`\n✅ YT.labs running on port ${PORT}`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.white('🌐 Frontend: ') + chalk.cyan(`http://localhost:${PORT}`));
      console.log(chalk.white('🔧 API Health: ') + chalk.cyan(`http://localhost:${PORT}/health`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.yellow('\n🤖 SaaS is active and ready for users.'));
    });
  }
}

// Start the SaaS
if (require.main === module) {
  const saas = new YouTubeAutomationSaaS();
  saas.start().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

module.exports = { YouTubeAutomationSaaS };
