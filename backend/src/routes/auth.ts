import { Router } from 'express';
import bcrypt from 'bcrypt';
import { rateLimit } from 'express-rate-limit';
import prisma from '../lib/prisma';
import { loginSchema, changePasswordSchema } from '../utils/validation';
import { requireAuth } from '../middleware/auth';
import { isSsoEnabled, getSsoConfig } from '../config/sso';
import { buildEndSessionUrl } from './sso';

const router = Router();

// Bcrypt cost factor for hashing local passwords.
const BCRYPT_COST = 12;

// A constant, real bcrypt hash compared against on the no-user / SSO-only path so
// that login timing does not reveal whether an account exists (or is SSO-managed).
// Computed once at startup with the same cost used for real passwords.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('idea-hub-timing-equalizer', BCRYPT_COST);

// Public: the ONLY flag the pre-login page needs — whether to show the SSO button.
// No auth guard and no rate limiter by design. Every session-scoped flag (including
// ssoShowLogout) lives on the authenticated GET /api/options instead.
router.get('/config', (_req, res) => {
  res.json({ ssoEnabled: isSsoEnabled() });
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many login attempts. Please try again later.' },
});

const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.session.userId!.toString(),
  message: { error: 'Too many password change attempts. Please try again later.' },
});

// Login
router.post('/login', loginLimiter as any, async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
    });

    // A null passwordHash means an SSO-managed account: reject local login with
    // the same generic error, and it also narrows passwordHash to a string for
    // bcrypt.compare below.
    if (!user || !user.passwordHash) {
      // Run a dummy comparison so this path takes the same time as the
      // wrong-password path; otherwise response timing leaks whether an account
      // exists (user enumeration) or is SSO-only. The result is intentionally
      // ignored and the generic 401 is returned either way.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.name = user.name;
    req.session.role = user.role;

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Logout
router.post('/logout', (req, res) => {
  // Capture the SSO ID token BEFORE the session is destroyed. For SSO logins we
  // must additionally end the IdP session (RP-initiated logout); otherwise the
  // IdP session survives and "Sign in with SSO" re-authenticates silently.
  const sessionIdToken = req.session.idToken;

  req.session.destroy(async (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    // Local logout is complete once the cookie is cleared. Everything below only
    // ADDS an optional redirect to the IdP end-session endpoint.
    res.clearCookie('connect.sid');

    if (isSsoEnabled() && sessionIdToken) {
      try {
        const redirectTo = await buildEndSessionUrl({
          idToken: sessionIdToken,
          postLogoutRedirectUri: getSsoConfig().postLogoutRedirectUri,
        });
        if (redirectTo) {
          return res.json({ message: 'Logged out successfully', redirectTo });
        }
      } catch (e) {
        // Fail-safe: the local session is already destroyed. Never log the
        // token — only the reason — and fall through to a local-only logout.
        console.error('SSO end-session URL build failed:', (e as Error)?.message ?? e);
      }
    }

    res.json({ message: 'Logged out successfully' });
  });
});

// Change password
router.post('/change-password', requireAuth, passwordChangeLimiter as any, async (req, res) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // SSO-managed accounts have no local password to change.
    if (!user.passwordHash) {
      return res.status(403).json({ error: 'Password change is not available for SSO accounts' });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Strip auth fields first so the session is unusable even if destroy fails
    const sessionToDestroy = req.session;
    delete sessionToDestroy.userId;
    delete sessionToDestroy.email;
    delete sessionToDestroy.name;
    delete sessionToDestroy.role;

    sessionToDestroy.save((saveErr) => {
      if (saveErr) {
        console.error('Error saving stripped session:', saveErr);
      }
      sessionToDestroy.destroy((err) => {
        res.clearCookie('connect.sid');
        if (err) {
          console.error('Error destroying session after password change:', err);
          return res.status(500).json({ error: 'Password changed but session invalidation failed. Please log out manually.' });
        }
        res.json({ message: 'Password changed successfully. Please log in again.' });
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Get current user
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        authProvider: true,
        department: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
