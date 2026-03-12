import { Router } from 'express';
import bcrypt from 'bcrypt';
import { rateLimit } from 'express-rate-limit';
import prisma from '../lib/prisma';
import { loginSchema, changePasswordSchema } from '../utils/validation';
import { requireAuth } from '../middleware/auth';

const router = Router();

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

    if (!user) {
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
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.clearCookie('connect.sid');
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

    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
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
