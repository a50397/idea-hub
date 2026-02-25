import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes
const mockPrismaFunctions = {
  user: {
    findUnique: jest.fn(),
  },
  idea: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  ideaEvent: {
    create: jest.fn(),
    createMany: jest.fn(),
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

// Import routes AFTER mocks
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';
import ideasRoutes from '../routes/ideas';
import { IdeaStatus, Effort } from '@prisma/client';

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
          id: 'idea1',
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

      const response = await agent.get('/api/ideas');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toHaveProperty('title', 'Test Idea 1');
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
  });

  describe('GET /api/ideas/:id', () => {
    test('should return single idea with events', async () => {
      const { agent } = await loginAsUser(app);

      const mockIdea = {
        id: 'idea1',
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

      const response = await agent.get('/api/ideas/idea1');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('title', 'Test Idea');
      expect(response.body.events).toHaveLength(1);
    });

    test('should return 404 for non-existent idea', async () => {
      const { agent } = await loginAsUser(app);

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(null);

      const response = await agent.get('/api/ideas/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Idea not found');
    });
  });

  describe('POST /api/ideas', () => {
    test('should create idea with valid data', async () => {
      const { agent, user } = await loginAsUser(app);

      const mockIdea = {
        id: 'idea1',
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

      const response = await agent.post('/api/ideas').send({
        title: 'New Idea',
        description: 'This is a new idea description with enough characters',
        benefits: 'Great benefits that are well described',
        effort: 'ONE_TO_THREE_DAYS',
        tags: ['innovation'],
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
        id: 'idea1',
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

      const response = await agent.post('/api/ideas').send({
        title: 'New Idea',
        description: 'This is a new idea description',
        benefits: 'Great benefits',
        effort: 'ONE_TO_THREE_DAYS',
      });

      expect(response.status).toBe(201);
      expect(response.body.tags).toEqual([]);
    });
  });

  describe('PATCH /api/ideas/:id', () => {
    test('should update own idea in SUBMITTED status', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'idea1',
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

      const response = await agent.patch('/api/ideas/idea1').send({
        title: 'Updated Title',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('title', 'Updated Title');
    });

    test('should not update someone else\'s idea', async () => {
      const { agent } = await loginAsUser(app);

      const existingIdea = {
        id: 'idea1',
        title: 'Original Title',
        status: 'SUBMITTED',
        submitterId: 'otheruser',
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/idea1').send({
        title: 'Updated Title',
      });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should not update approved idea', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'idea1',
        title: 'Original Title',
        status: 'APPROVED',
        submitterId: user.id,
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/idea1').send({
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
        id: 'idea1',
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

      const response = await agent.patch('/api/ideas/idea1/approve').send({
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

      const response = await agent.patch('/api/ideas/idea1/approve').send({
        note: 'Trying to approve',
      });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should not approve already approved idea', async () => {
      const { agent } = await loginAsUser(app, 'POWER_USER');

      const existingIdea = {
        id: 'idea1',
        status: 'APPROVED',
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/idea1/approve');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PATCH /api/ideas/:id/reject', () => {
    test('should reject idea as POWER_USER', async () => {
      const { agent, user } = await loginAsUser(app, 'POWER_USER');

      const existingIdea = {
        id: 'idea1',
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

      const response = await agent.patch('/api/ideas/idea1/reject').send({
        note: 'Not feasible at this time',
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('REJECTED');
    });

    test('should not reject as regular USER', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      const response = await agent.patch('/api/ideas/idea1/reject');

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /api/ideas/:id/claim', () => {
    test('should claim approved idea', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'idea1',
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

      const response = await agent.patch('/api/ideas/idea1/claim');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('IN_PROGRESS');
      expect(response.body.assigneeId).toBe(user.id);
    });

    test('should not claim non-approved idea', async () => {
      const { agent } = await loginAsUser(app);

      const existingIdea = {
        id: 'idea1',
        status: 'SUBMITTED',
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/idea1/claim');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PATCH /api/ideas/:id/complete', () => {
    test('should complete own assigned idea', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'idea1',
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

      const response = await agent.patch('/api/ideas/idea1/complete').send({
        note: 'Successfully implemented',
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('DONE');
    });

    test('should not complete someone else\'s idea', async () => {
      const { agent } = await loginAsUser(app);

      const existingIdea = {
        id: 'idea1',
        status: 'IN_PROGRESS',
        assigneeId: 'otheruser',
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/idea1/complete');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    test('should not complete idea not in progress', async () => {
      const { agent, user } = await loginAsUser(app);

      const existingIdea = {
        id: 'idea1',
        status: 'APPROVED',
        assigneeId: user.id,
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(existingIdea);

      const response = await agent.patch('/api/ideas/idea1/complete');

      expect(response.status).toBe(400);
    });
  });
});
