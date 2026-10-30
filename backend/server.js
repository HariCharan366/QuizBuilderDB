require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./config/db');
const { apiLimiter } = require('./middleware/authMiddleware');

// Models & Seed data
const User = require('./models/User');
const Question = require('./models/Question');
const Exam = require('./models/Exam');
const Result = require('./models/Result');
const { DEFAULT_QUESTIONS } = require('../frontend/js/questions');

const app = express();

// Initialize MongoDB & Seed
const initSystem = async () => {
  try {
    // 1. Ensure Admin Account exists from environment variables (and sync on credential rotation)
    const adminId = process.env.ADMIN_ID;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminId && adminPassword) {
      let admin = await User.findOne({ username: adminId, role: 'admin' });
      if (!admin) {
        await User.create({
          fullName: 'System Administrator',
          username: adminId,
          password: adminPassword,
          role: 'admin'
        });
        console.log(`[Seed] Admin account initialized (ID: ${adminId})`);
      } else {
        admin.password = adminPassword;
        await admin.save();
        console.log(`[Seed] Admin account synchronized with rotated environment credentials.`);
      }
    }

    // 2. Ensure Default Questions exist ONLY if the collection is completely empty (never delete existing data)
    const qCount = await Question.countDocuments();
    if (qCount === 0 && Array.isArray(DEFAULT_QUESTIONS) && DEFAULT_QUESTIONS.length > 0) {
      const formatted = DEFAULT_QUESTIONS.map(q => ({
        question: q.question,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        correct: q.correct,
        isDefault: true
      }));
      await Question.insertMany(formatted);
      console.log(`[Seed] Initialized ${formatted.length} default exam questions.`);
    }

    // 3. Ensure Default Exam exists
    let defaultExam = await Exam.findOne({ isActive: true });
    if (!defaultExam) {
      defaultExam = await Exam.create({
        title: 'Programming Fundamentals Examination',
        code: 'CS-EXAM-01',
        description: 'Standard online secure examination assessing programming proficiency.',
        durationMinutes: 15,
        totalQuestions: 40,
        maxWarnings: 3,
        passingPercentage: 50,
        isActive: true,
        randomizeQuestions: true
      });
      console.log('[Seed] Default examination configured (15 mins).');
    }

    // 4. Ensure existing questions without an exam are linked to the active examination
    const unassociated = await Question.countDocuments({ $or: [{ exam: null }, { exam: { $exists: false } }] });
    if (unassociated > 0 && defaultExam) {
      await Question.updateMany(
        { $or: [{ exam: null }, { exam: { $exists: false } }] },
        { $set: { exam: defaultExam._id } }
      );
      console.log(`[Seed] Associated ${unassociated} questions with examination: '${defaultExam.title}'.`);
    }
  } catch (err) {
    console.warn('[Seed Warning]', err.message);
  }
};

// Strict CORS Configuration
const configuredOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

const localDevOrigins = [
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://localhost:5500'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow non-browser requests (e.g. mobile native, curl, postman) with no origin header
    if (!origin) return callback(null, true);

    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      // In production: strictly forbid wildcard '*' and enforce exact matching against configured ALLOWED_ORIGINS
      const productionWhitelist = configuredOrigins.filter(o => o !== '*');
      if (productionWhitelist.length > 0 && productionWhitelist.indexOf(origin) !== -1) {
        return callback(null, true);
      }
      return callback(new Error(`CORS violation: Origin '${origin}' is not authorized in production.`));
    }

    // In development: allow local development ports + configured origins
    const whitelist = [...localDevOrigins, ...configuredOrigins];
    if (whitelist.includes('*') || whitelist.indexOf(origin) !== -1) {
      return callback(null, true);
    }

    // Explicitly reject unapproved origins
    return callback(new Error(`CORS policy violation: Origin '${origin}' is not authorized.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/api/', apiLimiter);

// API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/exams', require('./routes/examRoutes'));
app.use('/api/questions', require('./routes/examRoutes')); // alias for seamless compatibility
app.use('/api/results', require('./routes/resultRoutes'));

// Health check endpoint with database connection verification
app.get('/api/health', (req, res) => {
  const mongoose = require('mongoose');
  const isConnected = mongoose.connection.readyState === 1;

  if (!isConnected) {
    return res.status(503).json({
      status: 'degraded',
      database: 'disconnected',
      system: 'QuizBuilder - Full-Stack Secure Examination Platform',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    });
  }

  res.status(200).json({
    status: 'online',
    database: 'connected',
    system: 'QuizBuilder - Full-Stack Secure Examination Platform',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Protection Middleware: strictly block access to internal backend files, configs, and hidden directories
app.use((req, res, next) => {
  const normalized = req.path.toLowerCase();
  if (
    normalized.includes('.env') ||
    normalized.startsWith('/backend') ||
    normalized.startsWith('/data') ||
    normalized.startsWith('/node_modules') ||
    normalized.includes('package.json') ||
    normalized.includes('package-lock.json') ||
    normalized.includes('.git')
  ) {
    return res.status(404).json({ success: false, message: 'Resource not found' });
  }
  next();
});

// Serve ONLY the frontend directory as static content (backend code and root folder are strictly inaccessible)
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// Fallback routing: deliver index.html for non-API client routes, return JSON 404 for unmatched API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: `API endpoint ${req.method} ${req.path} not found.` });
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Internal Error]', err.stack || err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 5000;
let serverInstance = null;

const startServer = async () => {
  try {
    const conn = await connectDB();
    if (!conn) {
      console.error('[Fatal Error] Unable to connect to MongoDB Atlas. Server startup aborted.');
      process.exit(1);
    }

    await initSystem();

    serverInstance = app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`  QuizBuilder Full-Stack Server Running`);
      console.log(`  Server URL:     http://localhost:${PORT}`);
      console.log(`  Student Portal: http://localhost:${PORT}/index.html`);
      console.log(`  Admin Portal:   http://localhost:${PORT}/admin.html`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('[Startup Failure]', err);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server: serverInstance };

