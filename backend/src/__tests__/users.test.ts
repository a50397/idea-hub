import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes
const mockPrismaFunctions = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  idea: {
    count: jest.fn(),
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
import usersRoutes from '../routes/users';

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
  app.use('/api/users', usersRoutes);
  return app;
}

async function loginAsUser(app: express.Application, role: string = 'USER') {
  const agent = request.agent(app);
  const user = {
    id: 'user123',
    name: 'Test User',
    email: 'test@example.com',
    passwordHash: 'hash',
    role,
  };

  mockPrismaFunctions.user.findUnique.mockResolvedValue(user);
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);

  await agent.post('/api/auth/login').send({
    email: 'test@example.com',
    password: 'password123',
  });

  return { agent, user };
}

describe('Users API', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe('GET /api/users', () => {
    test('should return all users for ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const mockUsers = [
        {
          id: 'user1',
          name: 'Alice',
          email: 'alice@example.com',
          role: 'USER',
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: {
            submittedIdeas: 5,
            approvedIdeas: 0,
            assignedIdeas: 3,
          },
        },
        {
          id: 'user2',
          name: 'Bob',
          email: 'bob@example.com',
          role: 'POWER_USER',
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: {
            submittedIdeas: 2,
            approvedIdeas: 10,
            assignedIdeas: 1,
          },
        },
      ];

      mockPrismaFunctions.user.findMany.mockResolvedValue(mockUsers);

      const response = await agent.get('/api/users');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toHaveProperty('_count');
      expect(response.body[0]._count).toHaveProperty('submittedIdeas', 5);
    });

    test('should return 403 for POWER_USER', async () => {
      const { agent } = await loginAsUser(app, 'POWER_USER');

      const response = await agent.get('/api/users');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should return 403 for regular USER', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      const response = await agent.get('/api/users');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should return 401 when not authenticated', async () => {
      const response = await request(app).get('/api/users');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/users/:id', () => {
    test('should return single user for ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const mockUser = {
        id: 'user1',
        name: 'Alice',
        email: 'alice@example.com',
        role: 'USER',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: {
          submittedIdeas: 5,
          approvedIdeas: 0,
          assignedIdeas: 3,
        },
      };

      mockPrismaFunctions.user.findUnique.mockResolvedValue(mockUser);

      const response = await agent.get('/api/users/user1');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', 'user1');
      expect(response.body).toHaveProperty('name', 'Alice');
      expect(response.body).toHaveProperty('_count');
    });

    test('should return 404 for non-existent user', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.user.findUnique.mockResolvedValue(null);

      const response = await agent.get('/api/users/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'User not found');
    });

    test('should return 403 for non-ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      const response = await agent.get('/api/users/user1');

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/users', () => {
    test('should create user as ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(null); // Email doesn't exist
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$hashedpassword');

      const newUser = {
        id: 'newuser',
        name: 'New User',
        email: 'newuser@example.com',
        role: 'USER',
        createdAt: new Date(),
      };

      mockPrismaFunctions.user.create.mockResolvedValue(newUser);

      const response = await agent.post('/api/users').send({
        name: 'New User',
        email: 'newuser@example.com',
        password: 'password123',
        role: 'USER',
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id', 'newuser');
      expect(response.body).toHaveProperty('email', 'newuser@example.com');
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
    });

    test('should fail if email already exists', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.user.findUnique.mockResolvedValue({
        id: 'existing',
        email: 'existing@example.com',
      });

      const response = await agent.post('/api/users').send({
        name: 'New User',
        email: 'existing@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Email already exists');
    });

    test('should validate required fields', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.post('/api/users').send({
        name: 'New User',
        // Missing email and password
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should validate email format', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.post('/api/users').send({
        name: 'New User',
        email: 'invalid-email',
        password: 'password123',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should validate password length', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.post('/api/users').send({
        name: 'New User',
        email: 'user@example.com',
        password: '12345', // Too short
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should default to USER role if not specified', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');

      const newUser = {
        id: 'newuser',
        name: 'New User',
        email: 'user@example.com',
        role: 'USER',
        createdAt: new Date(),
      };

      mockPrismaFunctions.user.create.mockResolvedValue(newUser);

      const response = await agent.post('/api/users').send({
        name: 'New User',
        email: 'user@example.com',
        password: 'password123',
        // Role not specified
      });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe('USER');
    });

    test('should return 403 for non-ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      const response = await agent.post('/api/users').send({
        name: 'New User',
        email: 'user@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /api/users/:id', () => {
    test('should update user as ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const existingUser = {
        id: 'user1',
        name: 'Old Name',
        email: 'old@example.com',
        role: 'USER',
      };

      const updatedUser = {
        ...existingUser,
        name: 'New Name',
        email: 'new@example.com',
        updatedAt: new Date(),
      };

      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(existingUser);
      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(null); // New email doesn't exist
      mockPrismaFunctions.user.update.mockResolvedValue(updatedUser);

      const response = await agent.patch('/api/users/user1').send({
        name: 'New Name',
        email: 'new@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('name', 'New Name');
      expect(response.body).toHaveProperty('email', 'new@example.com');
    });

    test('should update password if provided', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const existingUser = {
        id: 'user1',
        name: 'User',
        email: 'user@example.com',
        role: 'USER',
      };

      mockPrismaFunctions.user.findUnique.mockResolvedValue(existingUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$newhash');
      mockPrismaFunctions.user.update.mockResolvedValue(existingUser);

      const response = await agent.patch('/api/users/user1').send({
        password: 'newpassword123',
      });

      expect(response.status).toBe(200);
      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
      expect(mockPrismaFunctions.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            passwordHash: '$2b$10$newhash',
          }),
        })
      );
    });

    test('should update role', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const existingUser = {
        id: 'user1',
        name: 'User',
        email: 'user@example.com',
        role: 'USER',
      };

      const updatedUser = {
        ...existingUser,
        role: 'POWER_USER',
      };

      mockPrismaFunctions.user.findUnique.mockResolvedValue(existingUser);
      mockPrismaFunctions.user.update.mockResolvedValue(updatedUser);

      const response = await agent.patch('/api/users/user1').send({
        role: 'POWER_USER',
      });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('POWER_USER');
    });

    test('should return 404 for non-existent user', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.user.findUnique.mockResolvedValue(null);

      const response = await agent.patch('/api/users/nonexistent').send({
        name: 'New Name',
      });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'User not found');
    });

    test('should fail if new email already exists', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const existingUser = {
        id: 'user1',
        email: 'user1@example.com',
      };

      const conflictingUser = {
        id: 'user2',
        email: 'taken@example.com',
      };

      mockPrismaFunctions.user.findUnique
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(conflictingUser);

      const response = await agent.patch('/api/users/user1').send({
        email: 'taken@example.com',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Email already exists');
    });

    test('should return 403 for non-ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      const response = await agent.patch('/api/users/user1').send({
        name: 'New Name',
      });

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /api/users/:id', () => {
    test('should delete user with no associated ideas', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const existingUser = {
        id: 'user1',
        name: 'User',
        email: 'user@example.com',
      };

      mockPrismaFunctions.user.findUnique.mockResolvedValue(existingUser);
      mockPrismaFunctions.idea.count.mockResolvedValue(0); // No associated ideas
      mockPrismaFunctions.user.delete.mockResolvedValue(existingUser);

      const response = await agent.delete('/api/users/user1');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'User deleted successfully');
      expect(mockPrismaFunctions.user.delete).toHaveBeenCalledWith({
        where: { id: 'user1' },
      });
    });

    test('should not delete user with associated ideas', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const existingUser = {
        id: 'user1',
        name: 'User',
        email: 'user@example.com',
      };

      mockPrismaFunctions.user.findUnique.mockResolvedValue(existingUser);
      mockPrismaFunctions.idea.count.mockResolvedValue(5); // Has associated ideas

      const response = await agent.delete('/api/users/user1');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Cannot delete user with associated ideas');
      expect(mockPrismaFunctions.user.delete).not.toHaveBeenCalled();
    });

    test('should return 404 for non-existent user', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.user.findUnique.mockResolvedValue(null);

      const response = await agent.delete('/api/users/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'User not found');
    });

    test('should return 403 for non-ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'POWER_USER');

      const response = await agent.delete('/api/users/user1');

      expect(response.status).toBe(403);
    });
  });
});
