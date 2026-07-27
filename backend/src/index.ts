import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import ssoRoutes from './routes/sso';
import ideasRoutes from './routes/ideas';
import reportsRoutes from './routes/reports';
import usersRoutes from './routes/users';
import departmentsRoutes from './routes/departments';
import mailSettingsRoutes from './routes/mail-settings';
import crypto from 'crypto';
import { ensureAdminExists } from './utils/init-admin';
import { ensureDepartments } from './utils/init-departments';
import { pruneOrphanSsoUsers } from './utils/prune-sso-users';
import { isMailKeyValid } from './utils/secretbox';
import prisma from './lib/prisma';

dotenv.config({ path: '../.env' });

if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV !== 'development') {
    console.error('FATAL: SESSION_SECRET environment variable is required outside of development. Exiting.');
    process.exit(1);
  }
  // Generate a random secret for development so it's never hardcoded
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: SESSION_SECRET not set. Generated a random ephemeral secret for development.');
}

// MAIL_SETTINGS_KEY encrypts the stored SMTP password (utils/secretbox.ts). Mail
// itself is admin-managed at runtime (no boot mail guard anymore — save-time
// validation replaces it), but the encryption key must exist AND be a usable
// 32-byte value. isMailKeyValid() validates the key's FORMAT (not merely its
// presence) via secretbox's own loader: a present-but-malformed key (not 64-hex,
// not base64→32 bytes) makes encrypt() throw, which would otherwise boot fine and
// then 500 on the first SMTP-password save. Mirror the SESSION_SECRET fail-fast
// above EXACTLY: fatal outside development; in development generate an ephemeral
// key and warn. A generated key means any previously saved password cannot be
// decrypted until a stable key is restored — acceptable dev semantics (the mailer
// treats an undecryptable password as none).
if (!isMailKeyValid()) {
  if (process.env.NODE_ENV !== 'development') {
    console.error('FATAL: MAIL_SETTINGS_KEY is missing or not a valid 32-byte key (64 hex chars, or base64 decoding to 32 bytes). Exiting.');
    process.exit(1);
  }
  // Generate a random valid key for development so it's never hardcoded.
  process.env.MAIL_SETTINGS_KEY = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: MAIL_SETTINGS_KEY is missing or invalid. Generated a random ephemeral key for development. Previously saved mail passwords cannot be decrypted until a stable key is set.');
}

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

app.set('trust proxy', 1);

// Security Middleware
app.use(helmet());

// CORS must be registered BEFORE the rate limiter. The limiter can short-circuit
// with a 429, and CORS preflights (which the SPA's axios client forces on every
// request via its X-Requested-With header) must be answered with
// Access-Control-Allow-Origin even when throttled — otherwise the browser masks
// the 429 as an opaque CORS failure and the SPA misreads it as logged-out.
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);

// Rate Limiting (General)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per `window` (here, per 15 minutes)
  standardHeaders: true,
  legacyHeaders: false,
  // Skipped under test so the real-DB integration tier (which drives many
  // requests from a single loopback IP) is not throttled, and under development
  // for local-dev ergonomics. Production/staging stay rate-limited. Mirrors the
  // loginLimiter / ssoLimiter skip in routes/auth.ts and routes/sso.ts.
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
});
app.use('/api', limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.DATABASE_URL,
      collectionName: 'sessions',
      ttl: 60 * 60 * 24 * 7, // 7 days
      // Store the session as a nested object (not a JSON string) so admin-driven
      // session invalidation can query `{ 'session.userId': ... }` in routes/users.ts.
      stringify: false,
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
app.use('/api/auth/sso', ssoRoutes);
app.use('/api/ideas', ideasRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/mail-settings', mailSettingsRoutes);

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
  await ensureDepartments();

  // Automatic pruning of orphaned SSO users. Skipped ENTIRELY under NODE_ENV=test:
  // the integration tier boots this app, and a boot-time (or interval) prune would
  // delete other suites' fixtures. Those suites call pruneOrphanSsoUsers() directly.
  if (process.env.NODE_ENV !== 'test') {
    // Best-effort at boot. The server is already listening at this point, so a
    // failure here must only be logged — never crash or block the process.
    try {
      await pruneOrphanSsoUsers();
    } catch (error) {
      console.error('Initial orphaned-SSO-user prune failed:', error);
    }

    // Periodic prune. Interval hours from SSO_PRUNE_INTERVAL_HOURS; NaN, zero and
    // negative values all fall back to the 24h default. The millisecond delay is
    // clamped to Node's max timer delay (2^31-1 ms ≈ 24.8 days): beyond that Node
    // fires the timer almost immediately, which would turn an oversized value into
    // a hot loop. .unref() so this timer can never keep the process alive on its own.
    const parsedHours = Number(process.env.SSO_PRUNE_INTERVAL_HOURS);
    const intervalHours = Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 24;
    const intervalMs = Math.min(intervalHours * 60 * 60 * 1000, 2_147_483_647);
    let pruneRunning = false;
    setInterval(async () => {
      // Each tick is independently best-effort; a rejection must not surface as an
      // unhandled rejection. The latch keeps a long run from overlapping the next
      // tick (only plausible with a tiny configured interval, but the guard is free).
      if (pruneRunning) return;
      pruneRunning = true;
      try {
        await pruneOrphanSsoUsers();
      } catch (error) {
        console.error('Scheduled orphaned-SSO-user prune failed:', error);
      } finally {
        pruneRunning = false;
      }
    }, intervalMs).unref();
  }
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
