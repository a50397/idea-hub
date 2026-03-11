import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import ideasRoutes from './routes/ideas';
import reportsRoutes from './routes/reports';
import usersRoutes from './routes/users';
import { ensureAdminExists } from './utils/init-admin';
import prisma from './lib/prisma';

dotenv.config({ path: '../.env' });

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is required in production. Exiting.');
  process.exit(1);
}

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

app.set('trust proxy', 1);

// Security Middleware
app.use(helmet());

// Rate Limiting (General)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-super-secret-session-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.DATABASE_URL,
      collectionName: 'sessions',
      ttl: 60 * 60 * 24 * 7, // 7 days
    }),
    cookie: {
      secure: process.env.COOKIE_SECURE === 'true',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      sameSite: process.env.COOKIE_SECURE === 'true' ? 'strict' : 'lax',
    },
  })
);

// CSRF protection: require a custom header on state-changing requests.
// Browsers will not send custom headers cross-origin without a CORS preflight,
// which is already restricted to the allowed origin.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return next();
  }
  return res.status(403).json({ error: 'Missing CSRF header' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/ideas', ideasRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/users', usersRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : (err.message || 'Internal server error'),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const server = app.listen(PORT, async () => {
  console.log(`🚀 IdeaHub Backend running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API available at: http://localhost:${PORT}`);
  await ensureAdminExists();
});

function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log('Server closed.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
