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
  department: {
    findMany: jest.fn(),
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

    test('should return org-wide counts for standard USER role (no submitterId scoping)', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      mockPrismaFunctions.idea.count.mockResolvedValue(0);
      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      await agent.get('/api/reports/summary');

      // No count query may be scoped to the caller: ideas are readable org-wide.
      mockPrismaFunctions.idea.count.mock.calls.forEach((call: any[]) => {
        expect(call[0].where).not.toHaveProperty('submitterId');
      });

      // findMany (average times) is org-wide too, as it always was.
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

  describe('GET /api/reports/by-department', () => {
    test('returns every department zero-filled and sorted by order', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.department.findMany.mockResolvedValue([
        { id: 'd1', name: 'Všeobecné', order: 0 },
        { id: 'd2', name: 'Marketing', order: 1 },
        { id: 'd3', name: 'Sales', order: 2 },
      ]);
      mockPrismaFunctions.idea.groupBy.mockResolvedValue([
        { departmentId: 'd1', _count: { id: 4 } },
        { departmentId: 'd3', _count: { id: 2 } },
      ]);

      const response = await agent.get('/api/reports/by-department');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { departmentId: 'd1', name: 'Všeobecné', count: 4 },
        { departmentId: 'd2', name: 'Marketing', count: 0 },
        { departmentId: 'd3', name: 'Sales', count: 2 },
      ]);
    });

    test('counts every idea org-wide for a standard USER', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      mockPrismaFunctions.department.findMany.mockResolvedValue([{ id: 'd1', name: 'Všeobecné', order: 0 }]);
      mockPrismaFunctions.idea.groupBy.mockResolvedValue([]);

      await agent.get('/api/reports/by-department');

      // The groupBy carries no `where` at all now, so nothing can scope it to
      // the caller; assert on the actual argument rather than requiring the key.
      const [args] = mockPrismaFunctions.idea.groupBy.mock.calls[0];
      expect(args.where?.submitterId).toBeUndefined();
    });

    test('does not scope the counts for an ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.department.findMany.mockResolvedValue([{ id: 'd1', name: 'Všeobecné', order: 0 }]);
      mockPrismaFunctions.idea.groupBy.mockResolvedValue([]);

      await agent.get('/api/reports/by-department');

      const [args] = mockPrismaFunctions.idea.groupBy.mock.calls[0];
      expect(args.where?.submitterId).toBeUndefined();
    });

    test('requires authentication', async () => {
      const response = await request(app).get('/api/reports/by-department');
      expect(response.status).toBe(401);
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

    test('should return the org-wide trend for standard USER role', async () => {
      const { agent } = await loginAsUser(app, 'USER');

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
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered?status=APPROVED');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'APPROVED',
          }),
        })
      );
      // The USER session sent no submitterId, so none may be injected.
      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ submitterId: expect.anything() }),
        })
      );
    });

    test('should filter by date range with an INCLUSIVE end day', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered?startDate=2024-01-01&endDate=2024-12-31');

      // Regression: `lte: 2024-12-31T00:00:00Z` silently excluded everything
      // submitted ON the end day. The range must close at the NEXT UTC midnight
      // with `lt` so the whole end day is inside it.
      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            submittedAt: {
              gte: new Date('2024-01-01T00:00:00.000Z'),
              lt: new Date('2025-01-01T00:00:00.000Z'),
            },
          }),
        })
      );

      const [findArgs] = mockPrismaFunctions.idea.findMany.mock.calls[0];
      expect(findArgs.where.submittedAt).not.toHaveProperty('lte');

      // An idea submitted midday ON the end day falls inside the built range.
      const onEndDay = new Date('2024-12-31T12:00:00.000Z');
      expect(onEndDay.getTime()).toBeGreaterThanOrEqual(findArgs.where.submittedAt.gte.getTime());
      expect(onEndDay.getTime()).toBeLessThan(findArgs.where.submittedAt.lt.getTime());

      // The count (and therefore the CSV branch) shares the very same `where`.
      const [countArgs] = mockPrismaFunctions.idea.count.mock.calls[0];
      expect(countArgs.where).toEqual(findArgs.where);

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ submitterId: expect.anything() }),
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

    test('should not force submitterId for standard USER role', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered');

      // Nothing in the query, so the report is org-wide (no self-scoping).
      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            submitterId: expect.anything(),
          }),
        })
      );
    });

    test('should honor a client-sent submitterId for standard USER role', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered?submitterId=507f1f77bcf86cd799439011');

      // The query-string value is an ordinary filter for every role now.
      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            submitterId: '507f1f77bcf86cd799439011',
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
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);
      mockPrismaFunctions.idea.count.mockResolvedValue(0);

      await agent.get('/api/reports/filtered?tags=automation&tags=productivity');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tags: {
              hasSome: ['automation', 'productivity'],
            },
          }),
        })
      );
      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ submitterId: expect.anything() }),
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

    test('neutralises a formula-looking title in the CSV export', async () => {
      const { agent } = await loginAsUser(app);

      const mockIdeas = [
        {
          id: 'idea1',
          title: '=cmd|/c calc',
          status: 'DONE',
          effort: 'ONE_TO_THREE_DAYS',
          tags: [],
          submitter: { name: 'Alice' },
          approver: null,
          assignee: null,
          submittedAt: new Date('2024-01-01'),
          approvedAt: null,
          startedAt: null,
          completedAt: null,
        },
      ];

      mockPrismaFunctions.idea.findMany.mockResolvedValue(mockIdeas);
      mockPrismaFunctions.idea.count.mockResolvedValue(1);

      const response = await agent.get('/api/reports/filtered?format=csv');

      expect(response.status).toBe(200);
      // CSV injection guard: the leading `=` is defused with a single quote, so
      // a spreadsheet opens the cell as text instead of executing it.
      expect(response.text).toContain(`"'=cmd|/c calc"`);
      expect(response.text).not.toContain(',"=cmd');
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

    // The four mirrored Jira columns. These are the only cells in the export whose
    // content comes from a THIRD-PARTY system, so each one must go through
    // sanitizeCsvField — which both quotes the value and defuses CSV formula
    // injection (security review F12).
    describe('Jira columns', () => {
      function ideaWithJira(overrides: Record<string, unknown> = {}) {
        return {
          id: 'idea1',
          title: 'Test Idea',
          status: 'APPROVED',
          effort: 'ONE_TO_THREE_DAYS',
          tags: [],
          submitter: { name: 'Alice' },
          approver: null,
          assignee: null,
          department: { name: 'Marketing' },
          submittedAt: new Date('2024-01-01'),
          approvedAt: null,
          startedAt: null,
          completedAt: null,
          jiraIssueKey: 'OPS-1',
          jiraStatus: 'In Review',
          jiraAssignee: 'Remote Person',
          jiraResolution: 'Fixed',
          ...overrides,
        };
      }

      function csvRow(text: string): string {
        return text.split('\n')[1];
      }

      test('adds the four Jira headers after Department', async () => {
        const { agent } = await loginAsUser(app);
        mockPrismaFunctions.idea.findMany.mockResolvedValue([ideaWithJira()]);
        mockPrismaFunctions.idea.count.mockResolvedValue(1);

        const response = await agent.get('/api/reports/filtered?format=csv');

        const [header] = response.text.split('\n');
        expect(header).toContain('Department,Jira Key,Jira Status,Jira Assignee,Jira Resolution');
      });

      test('quotes every Jira cell (all four go through sanitizeCsvField)', async () => {
        const { agent } = await loginAsUser(app);
        mockPrismaFunctions.idea.findMany.mockResolvedValue([ideaWithJira()]);
        mockPrismaFunctions.idea.count.mockResolvedValue(1);

        const response = await agent.get('/api/reports/filtered?format=csv');

        expect(csvRow(response.text)).toContain('"OPS-1","In Review","Remote Person","Fixed"');
      });

      test('renders an empty cell for a never-dispatched / unassigned / unresolved idea', async () => {
        const { agent } = await loginAsUser(app);
        mockPrismaFunctions.idea.findMany.mockResolvedValue([
          ideaWithJira({ jiraIssueKey: null, jiraStatus: null, jiraAssignee: null, jiraResolution: null }),
        ]);
        mockPrismaFunctions.idea.count.mockResolvedValue(1);

        const response = await agent.get('/api/reports/filtered?format=csv');

        expect(csvRow(response.text).endsWith('"Marketing",,,,')).toBe(true);
      });

      // F12: a Jira workflow status (or assignee/resolution/key) named "=cmd|..."
      // would otherwise EXECUTE when the export is opened in a spreadsheet.
      test.each([
        ['a status', 'jiraStatus'],
        ['an assignee', 'jiraAssignee'],
        ['a resolution', 'jiraResolution'],
        ['an issue key', 'jiraIssueKey'],
      ])('defuses a formula-injection payload in %s', async (_label, field) => {
        const { agent } = await loginAsUser(app);
        const payload = "=cmd|' /C calc'!A0";
        mockPrismaFunctions.idea.findMany.mockResolvedValue([ideaWithJira({ [field]: payload })]);
        mockPrismaFunctions.idea.count.mockResolvedValue(1);

        const response = await agent.get('/api/reports/filtered?format=csv');

        // The leading "=" is neutralized with a single quote INSIDE the quoted cell,
        // so no spreadsheet reads the value as a formula.
        expect(csvRow(response.text)).toContain(`"'${payload}"`);
        expect(csvRow(response.text)).not.toContain(`,${payload}`);
      });

      test.each([['@SUM(1+1)'], ['+1+1'], ['-1+1']])(
        'defuses the other formula-leading characters (%s)',
        async (payload) => {
          const { agent } = await loginAsUser(app);
          mockPrismaFunctions.idea.findMany.mockResolvedValue([ideaWithJira({ jiraStatus: payload })]);
          mockPrismaFunctions.idea.count.mockResolvedValue(1);

          const response = await agent.get('/api/reports/filtered?format=csv');

          expect(csvRow(response.text)).toContain(`"'${payload}"`);
        }
      );

      test('escapes embedded quotes in a Jira value (no cell breakout)', async () => {
        const { agent } = await loginAsUser(app);
        mockPrismaFunctions.idea.findMany.mockResolvedValue([
          ideaWithJira({ jiraStatus: 'He said "done"' }),
        ]);
        mockPrismaFunctions.idea.count.mockResolvedValue(1);

        const response = await agent.get('/api/reports/filtered?format=csv');

        expect(csvRow(response.text)).toContain('"He said ""done"""');
      });
    });
  });

  // The dashboard breakdown over the RAW Jira status names.
  describe('GET /api/reports/jira-statuses', () => {
    test('returns the buckets biggest-first, ties broken by name', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.idea.groupBy.mockResolvedValue([
        { jiraStatus: 'In Review', _count: { id: 2 } },
        { jiraStatus: 'To Do', _count: { id: 5 } },
        { jiraStatus: 'Blocked', _count: { id: 2 } },
      ]);

      const response = await agent.get('/api/reports/jira-statuses');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { status: 'To Do', count: 5 },
        { status: 'Blocked', count: 2 },
        { status: 'In Review', count: 2 },
      ]);
    });

    // `isSet` (not a bare `not: null`) is required: an idea document that predates
    // the Jira fields has no such field at all, and a Prisma+Mongo where-clause does
    // NOT match a missing scalar.
    test('filters on DISPATCHED ideas using isSet, never a bare not-null', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.idea.groupBy.mockResolvedValue([]);

      await agent.get('/api/reports/jira-statuses');

      expect(mockPrismaFunctions.idea.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['jiraStatus'],
          where: expect.objectContaining({
            jiraIssueKey: { isSet: true },
            jiraStatus: { isSet: true, not: null },
          }),
        })
      );
    });

    test('scopes the breakdown to a standard USER own ideas', async () => {
      const { agent, user } = await loginAsUser(app, 'USER');
      mockPrismaFunctions.idea.groupBy.mockResolvedValue([]);

      await agent.get('/api/reports/jira-statuses');

      expect(mockPrismaFunctions.idea.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ submitterId: user.id }) })
      );
    });

    test('does not scope the breakdown for a POWER_USER or ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'POWER_USER');
      mockPrismaFunctions.idea.groupBy.mockResolvedValue([]);

      await agent.get('/api/reports/jira-statuses');

      expect(mockPrismaFunctions.idea.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ submitterId: expect.anything() }),
        })
      );
    });

    test('drops a null bucket defensively', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.idea.groupBy.mockResolvedValue([
        { jiraStatus: null, _count: { id: 3 } },
        { jiraStatus: 'Done', _count: { id: 1 } },
      ]);

      const response = await agent.get('/api/reports/jira-statuses');

      expect(response.body).toEqual([{ status: 'Done', count: 1 }]);
    });

    test('requires authentication', async () => {
      const response = await request(app).get('/api/reports/jira-statuses');
      expect(response.status).toBe(401);
    });

    test('returns 500 when the query fails', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.idea.groupBy.mockRejectedValue(new Error('db down'));

      const response = await agent.get('/api/reports/jira-statuses');

      expect(response.status).toBe(500);
    });
  });
});

