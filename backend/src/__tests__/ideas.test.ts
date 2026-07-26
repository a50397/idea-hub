import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes
const mockPrismaFunctions: Record<string, any> = {
  user: {
    findUnique: jest.fn(),
  },
  idea: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  ideaEvent: {
    create: jest.fn(),
    createMany: jest.fn(),
  },
  ideaStep: {
    create: jest.fn(),
  },
  department: {
    findUnique: jest.fn(),
  },
};

// A valid ObjectId-format department id used across the create/update tests.
const DEPT_ID = 'ddddddddddddddddddddd001';
mockPrismaFunctions.$transaction = jest.fn((fn: (tx: any) => Promise<any>) => fn(mockPrismaFunctions));

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
    Effort: {
      LESS_THAN_ONE_DAY: 'LESS_THAN_ONE_DAY',
      ONE_TO_THREE_DAYS: 'ONE_TO_THREE_DAYS',
      MORE_THAN_THREE_DAYS: 'MORE_THAN_THREE_DAYS',
    },
    EventType: {
      SUBMITTED: 'SUBMITTED',
      APPROVED: 'APPROVED',
      REJECTED: 'REJECTED',
      CLAIMED: 'CLAIMED',
      COMPLETED: 'COMPLETED',
      UPDATED: 'UPDATED',
    },
  };
});

jest.mock('bcrypt');

// The mailer is fully mocked: idea creation fires a best-effort notification, and
// these tests assert it is invoked (or not) without touching real SMTP. The mock
// never rejects by default; individual tests override per case.
jest.mock('../utils/mailer', () => ({
  sendMail: jest.fn().mockResolvedValue(true),
}));

// config/mail is DB-backed now: the notification reads the effective settings
// (language + optional subject override) before building the email. Mock it so the
// wording language is controlled per-case WITHOUT any environment or DB.
jest.mock('../config/mail', () => ({
  getEffectiveMailConfig: jest.fn(),
}));

// Import routes AFTER mocks
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';
import ideasRoutes from '../routes/ideas';
import { sendMail } from '../utils/mailer';
import { getEffectiveMailConfig } from '../config/mail';
import { IdeaStatus, Effort } from '@prisma/client';

const mockedSendMail = jest.mocked(sendMail);
const mockedGetConfig = jest.mocked(getEffectiveMailConfig);

// The department notification is fire-and-forget: it runs in an async IIFE AFTER
// the 201 is sent (it awaits the settings read, then the send). Flush the
// microtask/immediate queue so those awaits settle before assertions.
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

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
  app.use('/api/ideas', ideasRoutes);
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

describe('Ideas API', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe('GET /api/ideas', () => {
    test('should return all ideas when authenticated', async () => {
      const { agent } = await loginAsUser(app);

      const mockIdeas = [
        {
          id: 'aaaaaaaaaaaaaaaaaaaaa001',
          title: 'Test Idea 1',
          description: 'Description 1',
          benefits: 'Benefits 1',
          effort: 'ONE_TO_THREE_DAYS',
          status: 'SUBMITTED',
          tags: ['test'],
          submitterId: 'user123',
          submitter: { id: 'user123', name: 'Test User', email: 'test@example.com' },
          submittedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrismaFunctions.idea.findMany.mockResolvedValue(mockIdeas);
      mockPrismaFunctions.idea.count.mockResolvedValue(1);

      const response = await agent.get('/api/ideas');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toHaveProperty('title', 'Test Idea 1');
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    test('should return 401 when not authenticated', async () => {
      const response = await request(app).get('/api/ideas');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    test('should filter ideas by status', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      await agent.get('/api/ideas?status=APPROVED');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'APPROVED',
          }),
        })
      );
    });

    test('should filter ideas by submitter', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      await agent.get('/api/ideas?submitterId=507f1f77bcf86cd799439011');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            submitterId: '507f1f77bcf86cd799439011',
          }),
        })
      );
    });

    test('should return 400 for invalid submitterId', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.get('/api/ideas?submitterId=invalid');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should return 400 for invalid status', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.get('/api/ideas?status=INVALID_STATUS');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should filter ideas by tags', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      await agent.get('/api/ideas?tags=automation&tags=productivity');

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tags: {
              hasSome: ['automation', 'productivity'],
            },
          }),
        })
      );
    });

    test('should filter ideas by departmentId', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findMany.mockResolvedValue([]);

      await agent.get(`/api/ideas?departmentId=${DEPT_ID}`);

      expect(mockPrismaFunctions.idea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            departmentId: DEPT_ID,
          }),
        })
      );
    });
  });

  describe('GET /api/ideas/:id', () => {
    test('should return single idea with events', async () => {
      const { agent } = await loginAsUser(app);

      const mockIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        title: 'Test Idea',
        description: 'Description',
        benefits: 'Benefits',
        effort: 'ONE_TO_THREE_DAYS',
        status: 'SUBMITTED',
        tags: ['test'],
        submitterId: 'user123',
        submitter: { id: 'user123', name: 'Test User', email: 'test@example.com' },
        events: [
          {
            id: 'event1',
            type: 'SUBMITTED',
            byUserId: 'user123',
            byUser: { id: 'user123', name: 'Test User', email: 'test@example.com' },
            timestamp: new Date(),
            note: 'Initial submission',
          },
        ],
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(mockIdea);

      const response = await agent.get('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('title', 'Test Idea');
      expect(response.body.events).toHaveLength(1);
    });

    test('should return 404 for non-existent idea', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(null);

      const response = await agent.get('/api/ideas/ccccccccccccccccccccc404');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Idea not found');
    });
  });

  describe('POST /api/ideas', () => {
    test('should create idea with valid data', async () => {
      const { agent, user } = await loginAsUser(app);

      const mockIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        title: 'New Idea',
        description: 'This is a new idea description with enough characters',
        benefits: 'Great benefits that are well described',
        effort: 'ONE_TO_THREE_DAYS',
        status: 'SUBMITTED',
        tags: ['innovation'],
        submitterId: user.id,
        submitter: { id: user.id, name: user.name, email: user.email },
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaFunctions.idea.create.mockResolvedValue(mockIdea);
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

      mockPrismaFunctions.department.findUnique.mockResolvedValue({ id: DEPT_ID, name: 'Všeobecné' });

      const response = await agent.post('/api/ideas').send({
        title: 'New Idea',
        description: 'This is a new idea description with enough characters',
        benefits: 'Great benefits that are well described',
        effort: 'ONE_TO_THREE_DAYS',
        tags: ['innovation'],
        departmentId: DEPT_ID,
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('title', 'New Idea');
      expect(mockPrismaFunctions.idea.create).toHaveBeenCalled();
      expect(mockPrismaFunctions.ideaEvent.create).toHaveBeenCalled();
    });

    test('should fail with title too short', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.post('/api/ideas').send({
        title: 'Ab',
        description: 'This is a description',
        benefits: 'Benefits here',
        effort: 'ONE_TO_THREE_DAYS',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should fail with title too long', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.post('/api/ideas').send({
        title: 'A'.repeat(121),
        description: 'This is a description',
        benefits: 'Benefits here',
        effort: 'ONE_TO_THREE_DAYS',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should fail with missing required fields', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.post('/api/ideas').send({
        title: 'Valid Title',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should fail with invalid effort value', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.post('/api/ideas').send({
        title: 'Valid Title',
        description: 'Valid description with enough characters',
        benefits: 'Valid benefits with enough characters',
        effort: 'INVALID_EFFORT',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should create idea without tags (optional)', async () => {
      const { agent, user } = await loginAsUser(app);

      const mockIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        title: 'New Idea',
        description: 'This is a new idea description',
        benefits: 'Great benefits',
        effort: 'ONE_TO_THREE_DAYS',
        status: 'SUBMITTED',
        tags: [],
        submitterId: user.id,
        submitter: { id: user.id, name: user.name, email: user.email },
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaFunctions.idea.create.mockResolvedValue(mockIdea);
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

      mockPrismaFunctions.department.findUnique.mockResolvedValue({ id: DEPT_ID, name: 'Všeobecné' });

      const response = await agent.post('/api/ideas').send({
        title: 'New Idea',
        description: 'This is a new idea description',
        benefits: 'Great benefits',
        effort: 'ONE_TO_THREE_DAYS',
        departmentId: DEPT_ID,
      });

      expect(response.status).toBe(201);
      expect(response.body.tags).toEqual([]);
    });

    test('should fail when departmentId is missing (now required)', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.post('/api/ideas').send({
        title: 'Valid Title',
        description: 'Valid description with enough characters',
        benefits: 'Valid benefits with enough characters',
        effort: 'ONE_TO_THREE_DAYS',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockPrismaFunctions.idea.create).not.toHaveBeenCalled();
    });

    test('should fail with 400 when the department does not exist', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.department.findUnique.mockResolvedValue(null);

      const response = await agent.post('/api/ideas').send({
        title: 'Valid Title',
        description: 'Valid description with enough characters',
        benefits: 'Valid benefits with enough characters',
        effort: 'ONE_TO_THREE_DAYS',
        departmentId: DEPT_ID,
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockPrismaFunctions.idea.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/ideas — department notification email', () => {
    const DEPT_WITH_EMAILS = {
      id: DEPT_ID,
      name: 'Marketing',
      notificationEmails: ['ops@corp.example', 'lead@corp.example'],
    };

    const createdIdea = {
      id: 'aaaaaaaaaaaaaaaaaaaaa001',
      title: 'Notify the department please',
      // 250 chars, so the ~200-char preview is exercised (and truncation proven).
      description: 'A'.repeat(250),
      benefits: 'Great benefits that are well described',
      effort: 'ONE_TO_THREE_DAYS',
      status: 'SUBMITTED',
      tags: [],
      submitterId: 'user123',
      submitter: { id: 'user123', name: 'Test User', email: 'test@example.com' },
      department: { id: DEPT_ID, name: 'Marketing' },
      submittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    function validBody() {
      return {
        title: 'Notify the department please',
        description: 'A'.repeat(250),
        benefits: 'Great benefits that are well described',
        effort: 'ONE_TO_THREE_DAYS',
        departmentId: DEPT_ID,
      };
    }

    beforeEach(() => {
      mockedSendMail.mockReset();
      mockedSendMail.mockResolvedValue(true);
      // Default effective config: English wording, no subject override.
      mockedGetConfig.mockReset();
      mockedGetConfig.mockResolvedValue({ language: 'en', subjectTemplate: '' } as any);
      mockPrismaFunctions.idea.create.mockResolvedValue(createdIdea);
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});
    });

    test('sends exactly one notification to the department emails with a dept+title subject', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.department.findUnique.mockResolvedValue(DEPT_WITH_EMAILS);

      const response = await agent.post('/api/ideas').send(validBody());
      await flushAsync();

      expect(response.status).toBe(201);
      expect(mockedSendMail).toHaveBeenCalledTimes(1);

      const arg = mockedSendMail.mock.calls[0][0];
      expect(arg.to).toEqual(['ops@corp.example', 'lead@corp.example']);
      expect(arg.subject).toBe('[IdeaHub] New idea for Marketing: Notify the department please');
      // Body carries the submitter, department, a truncated description and the link.
      expect(arg.text).toContain('Test User');
      expect(arg.text).toContain('Marketing');
      expect(arg.text).toContain('/ideas/aaaaaaaaaaaaaaaaaaaaa001');
      expect(arg.text).toContain('A'.repeat(200));
      expect(arg.text).not.toContain('A'.repeat(201));
    });

    test('uses Slovak wording (subject + body) for the notification when the settings language is sk', async () => {
      // utils/mail-templates.ts is real; the language now comes from the effective
      // mail config (mocked here) instead of any environment variable.
      mockedGetConfig.mockResolvedValue({ language: 'sk', subjectTemplate: '' } as any);
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.department.findUnique.mockResolvedValue(DEPT_WITH_EMAILS);

      const response = await agent.post('/api/ideas').send(validBody());
      await flushAsync();

      expect(response.status).toBe(201);
      expect(mockedSendMail).toHaveBeenCalledTimes(1);

      const arg = mockedSendMail.mock.calls[0][0];
      expect(arg.subject).toBe('[IdeaHub] Nový nápad pre Marketing: Notify the department please');
      // Body is Slovak too — one language per email — with no English wording.
      expect(arg.text).toContain('Pre oddelenie Marketing bol odoslaný nový nápad.');
      expect(arg.text).toContain('Zobraziť nápad:');
      expect(arg.text).not.toContain('A new idea has been submitted');
      expect(arg.text).not.toContain('View the idea:');
    });

    test('does NOT send when the department has no notification emails', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.department.findUnique.mockResolvedValue({
        id: DEPT_ID,
        name: 'Marketing',
        notificationEmails: [],
      });

      const response = await agent.post('/api/ideas').send(validBody());
      await flushAsync();

      expect(response.status).toBe(201);
      expect(mockedSendMail).not.toHaveBeenCalled();
    });

    test('returns 201 even when the mailer resolves false (best-effort failure)', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.department.findUnique.mockResolvedValue(DEPT_WITH_EMAILS);
      mockedSendMail.mockResolvedValueOnce(false);

      const response = await agent.post('/api/ideas').send(validBody());
      await flushAsync();

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('title', 'Notify the department please');
      expect(mockedSendMail).toHaveBeenCalledTimes(1);
    });

    test('returns 201 even when the mailer rejects (defensive; the real mailer never rejects)', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.department.findUnique.mockResolvedValue(DEPT_WITH_EMAILS);
      mockedSendMail.mockRejectedValueOnce(new Error('unexpected transport blow-up'));

      const response = await agent.post('/api/ideas').send(validBody());
      await flushAsync();

      expect(response.status).toBe(201);
      expect(mockedSendMail).toHaveBeenCalledTimes(1);
    });
  });

  // The idea-creation limiter (ideaCreateLimiter) blunts mail amplification: one
  // POST can fan out up to ~20 notification emails, so creation is capped at 30 per
  // 15-minute window per IP. It mirrors auth.test.ts's approach of toggling NODE_ENV
  // for the block — BUT note the difference: loginLimiter's skip is test-only, so
  // auth.test.ts toggles to 'development' to exercise it; THIS limiter's skip ALSO
  // includes 'development' (the required parity with the general limiter that keeps
  // the integration tier AND local dev unthrottled), so to actually exercise it we
  // must toggle to a NON-skipped env — 'production'. Every OTHER test runs under
  // NODE_ENV=test (skip=true) and so never consumes this limiter's per-IP budget,
  // keeping the store clean when this test runs (hermetic; restored in a finally).
  describe('Rate limiting (idea creation)', () => {
    test('returns 429 on the 31st rapid create from one IP while the first 30 pass', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        // 'production' is neither 'test' nor 'development', so skip() returns false
        // and the limiter is actually active for this block.
        process.env.NODE_ENV = 'production';

        // Fresh app so the limiter middleware re-evaluates its skip() per request.
        const rateLimitedApp = createTestApp();
        const { agent } = await loginAsUser(rateLimitedApp);

        // A department WITHOUT notification recipients -> the create path sends no
        // mail, keeping each of the 30 creates a clean, self-contained 201.
        mockPrismaFunctions.department.findUnique.mockResolvedValue({
          id: DEPT_ID,
          name: 'Rate Dept',
          notificationEmails: [],
        });
        mockPrismaFunctions.idea.create.mockResolvedValue({
          id: 'aaaaaaaaaaaaaaaaaaaaa001',
          title: 'Rate limit probe idea',
          submitter: { id: 'user123', name: 'Test User', email: 'test@example.com' },
          department: { id: DEPT_ID, name: 'Rate Dept' },
        });
        mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

        const body = {
          title: 'Rate limit probe idea',
          description: 'A sufficiently long idea description for validation.',
          benefits: 'Clear and measurable benefits described here for the test.',
          effort: 'ONE_TO_THREE_DAYS',
          departmentId: DEPT_ID,
        };

        // The cap is 30: the first 30 creates from this IP succeed.
        for (let i = 0; i < 30; i++) {
          const ok = await agent.post('/api/ideas').send(body);
          expect(ok.status).toBe(201);
        }

        // The 31st from the same IP is throttled with the house 429 shape.
        const limited = await agent.post('/api/ideas').send(body);
        expect(limited.status).toBe(429);
        expect(limited.body).toHaveProperty(
          'error',
          'Too many idea submissions. Please try again later.'
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    test('is SKIPPED under BOTH NODE_ENV=test and development (skip parity keeps the integration/E2E tiers and local dev unthrottled)', async () => {
      // The CRITICAL skip parity — identical to the general limiter (index.ts): under
      // 'test' (the integration/E2E tier drives many creates from one loopback IP)
      // AND 'development' (local dev), skip() is true so nothing is throttled. Getting
      // this wrong would 429 the integration tier and break those gates.
      const originalEnv = process.env.NODE_ENV;
      try {
        for (const env of ['test', 'development']) {
          process.env.NODE_ENV = env;
          const freshApp = createTestApp();
          const { agent } = await loginAsUser(freshApp);

          mockPrismaFunctions.department.findUnique.mockResolvedValue({
            id: DEPT_ID,
            name: 'Rate Dept',
            notificationEmails: [],
          });
          mockPrismaFunctions.idea.create.mockResolvedValue({
            id: 'aaaaaaaaaaaaaaaaaaaaa001',
            title: 'Unthrottled idea',
            submitter: { id: 'user123', name: 'Test User', email: 'test@example.com' },
            department: { id: DEPT_ID, name: 'Rate Dept' },
          });
          mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

          const body = {
            title: 'Unthrottled idea',
            description: 'A sufficiently long idea description for validation.',
            benefits: 'Clear and measurable benefits described here for the test.',
            effort: 'ONE_TO_THREE_DAYS',
            departmentId: DEPT_ID,
          };

          // Well past the max of 30 — none throttled because skip() is true for `env`.
          for (let i = 0; i < 35; i++) {
            const res = await agent.post('/api/ideas').send(body);
            expect(res.status).toBe(201);
          }
        }
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('PATCH /api/ideas/:id', () => {
    test('should update own idea in SUBMITTED status', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        title: 'Original Title',
        status: 'SUBMITTED',
        submitterId: user.id,
      };

      const updatedIdea = {
        ...existingIdea,
        title: 'Updated Title',
        submitter: { id: user.id, name: user.name, email: user.email },
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);
      mockPrismaFunctions.idea.update.mockResolvedValue(updatedIdea);
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001').send({
        title: 'Updated Title',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('title', 'Updated Title');
    });

    test('should not update someone else\'s idea', async () => {
      const { agent } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        title: 'Original Title',
        status: 'SUBMITTED',
        submitterId: 'otheruser',
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001').send({
        title: 'Updated Title',
      });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should not update approved idea', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        title: 'Original Title',
        status: 'APPROVED',
        submitterId: user.id,
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001').send({
        title: 'Updated Title',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PATCH /api/ideas/:id/approve', () => {
    test('should approve idea as POWER_USER', async () => {
      const { agent, user } = await loginAsUser(app, 'POWER_USER');

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        title: 'Test Idea',
        status: 'SUBMITTED',
        submitterId: 'otheruser',
      };

      const approvedIdea = {
        ...existingIdea,
        status: 'APPROVED',
        approverId: user.id,
        approvedAt: new Date(),
        submitter: { id: 'otheruser', name: 'Other User', email: 'other@example.com' },
        approver: { id: user.id, name: user.name, email: user.email },
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);
      mockPrismaFunctions.idea.update.mockResolvedValue(approvedIdea);
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/approve').send({
        note: 'Great idea!',
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('APPROVED');
      expect(mockPrismaFunctions.ideaEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'APPROVED',
            note: 'Great idea!',
          }),
        })
      );
    });

    test('should not approve as regular USER', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/approve').send({
        note: 'Trying to approve',
      });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should not approve already approved idea', async () => {
      const { agent } = await loginAsUser(app, 'POWER_USER');

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        status: 'APPROVED',
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/approve');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PATCH /api/ideas/:id/reject', () => {
    test('should reject idea as POWER_USER', async () => {
      const { agent, user } = await loginAsUser(app, 'POWER_USER');

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        title: 'Test Idea',
        status: 'SUBMITTED',
      };

      const rejectedIdea = {
        ...existingIdea,
        status: 'REJECTED',
        approverId: user.id,
        rejectedAt: new Date(),
        submitter: { id: 'user123', name: 'Test User', email: 'test@example.com' },
        approver: { id: user.id, name: user.name, email: user.email },
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);
      mockPrismaFunctions.idea.update.mockResolvedValue(rejectedIdea);
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/reject').send({
        note: 'Not feasible at this time',
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('REJECTED');
    });

    test('should not reject as regular USER', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/reject');

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /api/ideas/:id/claim', () => {
    test('should claim approved idea', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        status: 'APPROVED',
      };

      const claimedIdea = {
        ...existingIdea,
        status: 'IN_PROGRESS',
        assigneeId: user.id,
        startedAt: new Date(),
        submitter: { id: 'user123', name: 'Submitter', email: 'sub@example.com' },
        approver: { id: 'power1', name: 'Power User', email: 'power@example.com' },
        assignee: { id: user.id, name: user.name, email: user.email },
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);
      mockPrismaFunctions.idea.update.mockResolvedValue(claimedIdea);
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/claim');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('IN_PROGRESS');
      expect(response.body.assigneeId).toBe(user.id);
    });

    test('should not claim non-approved idea', async () => {
      const { agent } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        status: 'SUBMITTED',
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/claim');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PATCH /api/ideas/:id/complete', () => {
    test('should complete own assigned idea', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        status: 'IN_PROGRESS',
        assigneeId: user.id,
      };

      const completedIdea = {
        ...existingIdea,
        status: 'DONE',
        completedAt: new Date(),
        submitter: { id: 'user123', name: 'Submitter', email: 'sub@example.com' },
        approver: { id: 'power1', name: 'Power User', email: 'power@example.com' },
        assignee: { id: user.id, name: user.name, email: user.email },
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);
      mockPrismaFunctions.idea.update.mockResolvedValue(completedIdea);
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/complete').send({
        note: 'Successfully implemented',
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('DONE');
    });

    test('should not complete someone else\'s idea', async () => {
      const { agent } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        status: 'IN_PROGRESS',
        assigneeId: 'otheruser',
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/complete');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should not complete idea not in progress', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        status: 'APPROVED',
        assigneeId: user.id,
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/complete');

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/ideas/:id', () => {
    test('should delete idea as ADMIN', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        title: 'Test Idea',
        status: 'SUBMITTED',
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);
      mockPrismaFunctions.idea.delete.mockResolvedValue(existingIdea);

      const response = await agent.delete('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Idea deleted');
      expect(mockPrismaFunctions.idea.delete).toHaveBeenCalledWith({
        where: { id: 'aaaaaaaaaaaaaaaaaaaaa001' },
      });
    });

    test('should not delete as regular USER', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      const response = await agent.delete('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should not delete as POWER_USER', async () => {
      const { agent } = await loginAsUser(app, 'POWER_USER');

      const response = await agent.delete('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should return 404 for non-existent idea', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(null);

      const response = await agent.delete('/api/ideas/ccccccccccccccccccccc404');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Idea not found');
    });
  });

  describe('POST /api/ideas/:id/steps', () => {
    test('should add step as assignee to IN_PROGRESS idea', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        status: 'IN_PROGRESS',
        assigneeId: user.id,
      };

      const mockStep = {
        id: 'step1',
        ideaId: 'aaaaaaaaaaaaaaaaaaaaa001',
        text: 'Implemented the first part',
        createdAt: new Date(),
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);
      mockPrismaFunctions.ideaStep.create.mockResolvedValue(mockStep);

      const response = await agent.post('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/steps').send({
        text: 'Implemented the first part',
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('text', 'Implemented the first part');
      expect(mockPrismaFunctions.ideaStep.create).toHaveBeenCalledWith({
        data: {
          ideaId: 'aaaaaaaaaaaaaaaaaaaaa001',
          text: 'Implemented the first part',
        },
      });
    });

    test('should not add step as non-assignee', async () => {
      const { agent } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        status: 'IN_PROGRESS',
        assigneeId: 'otheruser',
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.post('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/steps').send({
        text: 'Trying to add a step',
      });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should not add step to non-IN_PROGRESS idea', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        status: 'APPROVED',
        assigneeId: user.id,
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.post('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/steps').send({
        text: 'Trying to add a step',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    test('should return 404 for non-existent idea', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(null);

      const response = await agent.post('/api/ideas/ccccccccccccccccccccc404/steps').send({
        text: 'Step for missing idea',
      });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Idea not found');
    });

    test('should fail with empty text', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        status: 'IN_PROGRESS',
        assigneeId: user.id,
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.post('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/steps').send({
        text: '',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });
});
