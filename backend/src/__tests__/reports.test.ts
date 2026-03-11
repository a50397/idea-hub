import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes
const mockPrismaFunctions = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  idea: {
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
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
    IdeaStatus: {
      SUBMITTED: 'SUBMITTED',
      APPROVED: 'APPROVED',
      IN_PROGRESS: 'IN_PROGRESS',
      DONE: 'DONE',
      REJECTED: 'REJECTED',
    },
  };
});

jest.mock('bcrypt');

// Import routes AFTER mocks
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';
import reportsRoutes from '../routes/reports';

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
  app.use('/api/reports', reportsRoutes);
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

describe('Reports API', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe('GET /api/reports/summary', () => {
    test('should return dashboard summary statistics', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.count
        .mockResolvedValueOnce(5)  // SUBMITTED
        .mockResolvedValueOnce(3)  // APPROVED
        .mockResolvedValueOnce(2)  // IN_PROGRESS
        .mockResolvedValueOnce(10) // DONE
        .mockResolvedValueOnce(1); // REJECTED

      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([
        {
          submittedAt: sevenDaysAgo,
          approvedAt: new Date(sevenDaysAgo.getTime() + 2 * 24 * 60 * 60 * 1000),
          startedAt: new Date(sevenDaysAgo.getTime() + 3 * 24 * 60 * 60 * 1000),
          completedAt: now,
          status: 'DONE',
        },
        {
          submittedAt: threeDaysAgo,
          approvedAt: new Date(threeDaysAgo.getTime() + 1 * 24 * 60 * 60 * 1000),
          startedAt: null,
          completedAt: null,
          status: 'IN_PROGRESS',
        },
      ]);

      const response = await agent.get('/api/reports/summary');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('counts');
      expect(response.body.counts).toEqual({
        submitted: 5,
        approved: 3,
        inProgress: 2,
        done: 10,
        rejected: 1,
        total: 21,
      });
      expect(response.body).toHaveProperty('averageTimes');
      expect(response.body.averageTimes).toHaveProperty('submittedToApprovedDays');
      expect(response.body.averageTimes).toHaveProperty('approvedToDoneDays');
    });

    test('should filter counts by submitterId for standard USER role but not average times', async () => {
      const { agent, user } = await loginAsUser(app, 'USER');

      mockPrismaFunctions.idea.count.mockResolvedValue(0);
      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      await agent.get('/api/reports/summary');

      // All count queries should include submitterId filter
      mockPrismaFunctions.idea.count.mock.calls.forEach((call: any[]) => {
        expect(call[0].where).toHaveProperty('submitterId', user.id);
      });

      // findMany (average times) should NOT filter by submitterId - visible to all
      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            submitterId: expect.anything(),
          }),
        })
      );
    });

    test('should not filter by submitterId for ADMIN role', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.idea.count.mockResolvedValue(0);
      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      await agent.get('/api/reports/summary');

      // Count queries should NOT include submitterId filter
      mockPrismaFunctions.idea.count.mock.calls.forEach((call: any[]) => {
        expect(call[0].where).not.toHaveProperty('submitterId');
      });
    });

    test('should not filter by submitterId for POWER_USER role', async () => {
      const { agent } = await loginAsUser(app, 'POWER_USER');

      mockPrismaFunctions.idea.count.mockResolvedValue(0);
      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      await agent.get('/api/reports/summary');

      mockPrismaFunctions.idea.count.mock.calls.forEach((call: any[]) => {
        expect(call[0].where).not.toHaveProperty('submitterId');
      });
    });

    test('should require authentication', async () => {
      const response = await request(app).get('/api/reports/summary');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    test('should handle zero counts gracefully', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.count.mockResolvedValue(0);
      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      const response = await agent.get('/api/reports/summary');

      expect(response.status).toBe(200);
      expect(response.body.counts.total).toBe(0);
      expect(response.body.averageTimes.submittedToApprovedDays).toBe(0);
    });
  });

  describe('GET /api/reports/monthly-trend', () => {
    test('should return monthly completion trend', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([
        { completedAt: new Date('2024-01-15') },
        { completedAt: new Date('2024-01-20') },
        { completedAt: new Date('2024-02-10') },
        { completedAt: new Date('2024-02-25') },
        { completedAt: new Date('2024-02-28') },
        { completedAt: new Date('2024-03-05') },
      ]);

      const response = await agent.get('/api/reports/monthly-trend');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toContainEqual({ month: '2024-01', count: 2 });
      expect(response.body).toContainEqual({ month: '2024-02', count: 3 });
      expect(response.body).toContainEqual({ month: '2024-03', count: 1 });
    });

    test('should filter by submitterId for standard USER role', async () => {
      const { agent, user } = await loginAsUser(app, 'USER');

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      await agent.get('/api/reports/monthly-trend');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            submitterId: user.id,
          }),
        })
      );
    });

    test('should not filter by submitterId for ADMIN role', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      await agent.get('/api/reports/monthly-trend');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            submitterId: expect.anything(),
          }),
        })
      );
    });

    test('should return empty array when no completed ideas', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      const response = await agent.get('/api/reports/monthly-trend');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    test('should require authentication', async () => {
      const response = await request(app).get('/api/reports/monthly-trend');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/reports/top-contributors', () => {
    test('should return top contributors with default limit', async () => {
      const { agent } = await loginAsUser(app, 'POWER_USER');

      mockPrismaFunctions.idea.groupBy.mockResolvedValue([
        { assigneeId: 'user1', _count: { id: 15 } },
        { assigneeId: 'user2', _count: { id: 10 } },
        { assigneeId: 'user3', _count: { id: 7 } },
      ]);

      mockPrismaFunctions.user.findMany.mockResolvedValue([
        { id: 'user1', name: 'Alice', email: 'alice@example.com' },
        { id: 'user2', name: 'Bob', email: 'bob@example.com' },
        { id: 'user3', name: 'Charlie', email: 'charlie@example.com' },
      ]);

      const response = await agent.get('/api/reports/top-contributors');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(3);
      expect(response.body[0]).toEqual({
        userId: 'user1',
        userName: 'Alice',
        userEmail: 'alice@example.com',
        completedIdeas: 15,
      });
    });

    test('should respect custom limit parameter', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.idea.groupBy.mockResolvedValue([
        { assigneeId: 'user1', _count: { id: 15 } },
      ]);

      mockPrismaFunctions.user.findMany.mockResolvedValue([
        { id: 'user1', name: 'Alice', email: 'alice@example.com' },
      ]);

      await agent.get('/api/reports/top-contributors?limit=5');

      expect(mockPrismaFunctions.idea.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        })
      );
    });

    test('should return empty array when no completed ideas', async () => {
      const { agent } = await loginAsUser(app, 'POWER_USER');

      mockPrismaFunctions.idea.groupBy.mockResolvedValue([]);
      mockPrismaFunctions.user.findMany.mockResolvedValue([]);

      const response = await agent.get('/api/reports/top-contributors');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    test('should return 403 for regular USER role', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      const response = await agent.get('/api/reports/top-contributors');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/reports/filtered', () => {
    test('should return filtered ideas as JSON by default', async () => {
      const { agent } = await loginAsUser(app);

      const mockIdeas = [
        {
          id: 'idea1',
          title: 'Idea 1',
          status: 'DONE',
          effort: 'ONE_TO_THREE_DAYS',
          tags: ['test'],
          submitterId: 'user1',
          submitter: { id: 'user1', name: 'User 1', email: 'user1@test.com' },
          approver: null,
          assignee: null,
          submittedAt: new Date(),
        },
      ];

      mockPrismaFunctions.idea.findMany.mockResolvedValue(mockIdeas);
      mockPrismaFunctions.idea.count.mockResolvedValue(1);

      const response = await agent.get('/api/reports/filtered');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    test('should filter by status', async () => {
      const { agent, user } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered?status=APPROVED');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'APPROVED',
            submitterId: user.id,
          }),
        })
      );
    });

    test('should filter by date range', async () => {
      const { agent, user } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered?startDate=2024-01-01&endDate=2024-12-31');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            submitterId: user.id,
            submittedAt: {
              gte: expect.any(Date),
              lte: expect.any(Date),
            },
          }),
        })
      );
    });

    test('should filter by submitter for ADMIN role', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered?submitterId=507f1f77bcf86cd799439011');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            submitterId: '507f1f77bcf86cd799439011',
          }),
        })
      );
    });

    test('should force submitterId to own user id for standard USER role', async () => {
      const { agent, user } = await loginAsUser(app, 'USER');

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            submitterId: user.id,
          }),
        })
      );
    });

    test('should ignore client-sent submitterId for standard USER role', async () => {
      const { agent, user } = await loginAsUser(app, 'USER');

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered?submitterId=507f1f77bcf86cd799439011');

      // Should use the logged-in user's ID, not the one from the query string
      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            submitterId: user.id,
          }),
        })
      );
    });

    test('should return 400 for invalid status', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.get('/api/reports/filtered?status=BOGUS');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should return 400 for invalid submitterId', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.get('/api/reports/filtered?submitterId=not-an-id');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should filter by tags', async () => {
      const { agent, user } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered?tags=automation&tags=productivity');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            submitterId: user.id,
            tags: {
              hasSome: ['automation', 'productivity'],
            },
          }),
        })
      );
    });

    test('should return CSV when format=csv', async () => {
      const { agent } = await loginAsUser(app);

      const mockIdeas = [
        {
          id: 'idea1',
          title: 'Test Idea',
          status: 'DONE',
          effort: 'ONE_TO_THREE_DAYS',
          tags: ['test', 'automation'],
          submitter: { name: 'Alice' },
          approver: { name: 'Bob' },
          assignee: { name: 'Charlie' },
          submittedAt: new Date('2024-01-01'),
          approvedAt: new Date('2024-01-02'),
          startedAt: new Date('2024-01-03'),
          completedAt: new Date('2024-01-10'),
        },
      ];

      mockPrismaFunctions.idea.findMany.mockResolvedValue(mockIdeas);
      mockPrismaFunctions.idea.count.mockResolvedValue(1);

      const response = await agent.get('/api/reports/filtered?format=csv');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.text).toContain('ID,Title,Status');
      expect(response.text).toContain('Test Idea');
    });

    test('should calculate duration in CSV export', async () => {
      const { agent } = await loginAsUser(app);

      const submittedAt = new Date('2024-01-01');
      const completedAt = new Date('2024-01-08'); // 7 days later

      const mockIdeas = [
        {
          id: 'idea1',
          title: 'Test',
          status: 'DONE',
          effort: 'ONE_TO_THREE_DAYS',
          tags: [],
          submitter: { name: 'Alice' },
          approver: null,
          assignee: null,
          submittedAt,
          approvedAt: null,
          startedAt: null,
          completedAt,
        },
      ];

      mockPrismaFunctions.idea.findMany.mockResolvedValue(mockIdeas);
      mockPrismaFunctions.idea.count.mockResolvedValue(1);

      const response = await agent.get('/api/reports/filtered?format=csv');

      expect(response.status).toBe(200);
      expect(response.text).toContain('7'); // Duration in days
    });
  });
});
