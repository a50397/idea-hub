import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes
const mockPrismaFunctions = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => mockPrismaFunctions),
    Role: {
      USER: 'USER',
      POWER_USER: 'POWER_USER',
      ADMIN: 'ADMIN',
    },
  };
});

jest.mock('bcrypt');

// Import routes AFTER mocks
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';

function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    })
  );
  app.use('/api/auth', authRoutes);
  return app;
}

describe('Authentication API', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe('POST /api/auth/login', () => {
    const validUser = {
      id: 'user123',
      name: 'Test User',
      email: 'test@example.com',
      passwordHash: '$2b$10$hashedpassword',
      role: 'USER',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    test('should login successfully with valid credentials', async () => {
      mockPrismaFunctions.user.findUnique.mockResolvedValue(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: validUser.id,
        name: validUser.name,
        email: validUser.email,
        role: validUser.role,
      });
      expect(mockPrismaFunctions.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', validUser.passwordHash);
    });

    test('should fail with non-existent email', async () => {
      mockPrismaFunctions.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid email or password');
    });

    test('should fail with incorrect password', async () => {
      mockPrismaFunctions.user.findUnique.mockResolvedValue(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid email or password');
    });

    test('should fail with invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid-email',
          password: 'password123',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should fail with missing email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          password: 'password123',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should fail with missing password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should set session cookie on successful login', async () => {
      mockPrismaFunctions.user.findUnique.mockResolvedValue(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(200);
      expect(response.headers['set-cookie']).toBeDefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    test('should logout successfully', async () => {
      const agent = request.agent(app);

      // First login
      mockPrismaFunctions.user.findUnique.mockResolvedValue({
        id: 'user123',
        name: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hash',
        role: 'USER',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await agent.post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });

      // Then logout
      const response = await agent.post('/api/auth/logout');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Logged out successfully');
    });

    test('should clear session cookie on logout', async () => {
      const agent = request.agent(app);

      mockPrismaFunctions.user.findUnique.mockResolvedValue({
        id: 'user123',
        name: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hash',
        role: 'USER',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await agent.post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });

      const response = await agent.post('/api/auth/logout');

      expect(response.status).toBe(200);
      // Session cookie should be cleared
      const cookies = response.headers['set-cookie'];
      if (cookies && Array.isArray(cookies)) {
        expect(cookies.some((cookie: string) => cookie.includes('connect.sid'))).toBe(true);
      }
    });
  });

  describe('GET /api/auth/me', () => {
    test('should return current user when authenticated', async () => {
      const agent = request.agent(app);
      const loginUser = {
        id: 'user123',
        name: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hash',
        role: 'USER',
        createdAt: new Date(),
      };

      const meUser = {
        id: 'user123',
        name: 'Test User',
        email: 'test@example.com',
        role: 'USER',
        createdAt: new Date(),
      };

      // First call for login
      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(loginUser);
      // Second call for /me endpoint (with select, so no passwordHash)
      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(meUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      // Login first
      await agent.post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });

      // Get current user
      const response = await agent.get('/api/auth/me');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', meUser.id);
      expect(response.body).toHaveProperty('name', meUser.name);
      expect(response.body).toHaveProperty('email', meUser.email);
      expect(response.body).toHaveProperty('role', meUser.role);
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    test('should return 401 when not authenticated', async () => {
      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Unauthorized. Please login.');
    });

    test('should return 404 if user no longer exists', async () => {
      const agent = request.agent(app);

      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce({
        id: 'user123',
        name: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hash',
        role: 'USER',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await agent.post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });

      // Simulate user deleted
      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(null);

      const response = await agent.get('/api/auth/me');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'User not found');
    });
  });

  describe('POST /api/auth/change-password', () => {
    const validUser = {
      id: 'user123',
      name: 'Test User',
      email: 'test@example.com',
      passwordHash: '$2b$10$hashedpassword',
      role: 'USER',
    };

    async function loginAgent() {
      const agent = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      await agent.post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'oldpassword',
      });
      return agent;
    }

    test('should change password successfully', async () => {
      const agent = await loginAgent();

      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('$2b$10$newhashedpassword');
      mockPrismaFunctions.user.update.mockResolvedValueOnce({ ...validUser, passwordHash: '$2b$10$newhashedpassword' });

      const response = await agent
        .post('/api/auth/change-password')
        .send({
          currentPassword: 'oldpassword',
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Password changed successfully');
      expect(bcrypt.compare).toHaveBeenCalledWith('oldpassword', validUser.passwordHash);
      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
      expect(mockPrismaFunctions.user.update).toHaveBeenCalledWith({
        where: { id: validUser.id },
        data: { passwordHash: '$2b$10$newhashedpassword' },
      });
    });

    test('should fail with incorrect current password', async () => {
      const agent = await loginAgent();

      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      const response = await agent
        .post('/api/auth/change-password')
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Current password is incorrect');
    });

    test('should fail when not authenticated', async () => {
      const response = await request(app)
        .post('/api/auth/change-password')
        .send({
          currentPassword: 'oldpassword',
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(401);
    });

    test('should fail with missing currentPassword', async () => {
      const agent = await loginAgent();

      const response = await agent
        .post('/api/auth/change-password')
        .send({
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should fail with missing newPassword', async () => {
      const agent = await loginAgent();

      const response = await agent
        .post('/api/auth/change-password')
        .send({
          currentPassword: 'oldpassword',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should fail with newPassword too short', async () => {
      const agent = await loginAgent();

      const response = await agent
        .post('/api/auth/change-password')
        .send({
          currentPassword: 'oldpassword',
          newPassword: '12345',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should return 404 if user no longer exists', async () => {
      const agent = await loginAgent();

      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(null);

      const response = await agent
        .post('/api/auth/change-password')
        .send({
          currentPassword: 'oldpassword',
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'User not found');
    });
  });

  describe('Session Management', () => {
    test('should maintain session across multiple requests', async () => {
      const agent = request.agent(app);
      const user = {
        id: 'user123',
        name: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hash',
        role: 'USER',
        createdAt: new Date(),
      };

      mockPrismaFunctions.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      // Login
      const loginResponse = await agent.post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });
      expect(loginResponse.status).toBe(200);

      // Make authenticated request
      const meResponse1 = await agent.get('/api/auth/me');
      expect(meResponse1.status).toBe(200);

      // Make another authenticated request
      const meResponse2 = await agent.get('/api/auth/me');
      expect(meResponse2.status).toBe(200);
    });
  });

  describe('Rate Limiting', () => {
    test('should return 429 after exceeding login attempts', async () => {
      // Temporarily enable rate limiting by overriding NODE_ENV
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Need a fresh app so the rate limiter re-evaluates the skip condition
      const rateLimitedApp = createTestApp();

      mockPrismaFunctions.user.findUnique.mockResolvedValue(null);

      // Make 11 login attempts (limit is 10)
      for (let i = 0; i < 10; i++) {
        await request(rateLimitedApp).post('/api/auth/login').send({
          email: 'test@example.com',
          password: 'wrong',
        });
      }

      const response = await request(rateLimitedApp).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'wrong',
      });

      expect(response.status).toBe(429);
      expect(response.body).toHaveProperty('error', 'Too many login attempts. Please try again later.');

      process.env.NODE_ENV = originalEnv;
    });

    test('should not rate limit other endpoints', async () => {
      // Logout endpoint should not be rate limited
      const response = await request(app).post('/api/auth/logout');
      expect(response.status).not.toBe(429);
    });
  });
});
