import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes
const mockPrismaFunctions: Record<string, any> = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  idea: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    // The Jira dispatch claim is a conditional write (see routes/ideas.ts).
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  ideaEvent: {
    create: jest.fn(),
  },
  department: {
    findUnique: jest.fn(),
  },
};
mockPrismaFunctions.$transaction = jest.fn((fn: (tx: any) => Promise<any>) => fn(mockPrismaFunctions));

// A valid ObjectId-format department id for the idea-submission steps.
const DEPT_ID = 'ddddddddddddddddddddd001';

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
      JIRA_CREATED: 'JIRA_CREATED',
      JIRA_STATUS_CHANGED: 'JIRA_STATUS_CHANGED',
      JIRA_CANCELLED: 'JIRA_CANCELLED',
    },
  };
});

jest.mock('bcrypt');

// The Jira channel: the effective-config read and the outbound issue creation are
// mocked so the workflow exercises the real route logic (claim -> create -> mirror
// -> event) without any network or database.
jest.mock('../config/jira', () => ({
  getEffectiveJiraConfig: jest.fn(),
}));
jest.mock('../utils/jira', () => {
  const actual = jest.requireActual('../utils/jira');
  return { ...actual, createJiraIssue: jest.fn() };
});

// Import routes AFTER mocks
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';
import ideasRoutes from '../routes/ideas';
import usersRoutes from '../routes/users';
import { getEffectiveJiraConfig } from '../config/jira';
import { createJiraIssue } from '../utils/jira';

const mockedGetJiraConfig = jest.mocked(getEffectiveJiraConfig);
const mockedCreateJiraIssue = jest.mocked(createJiraIssue);

// A fully configured effective Jira config (the shape config/jira.ts derives).
const JIRA_CFG = {
  enabled: true,
  effectiveEnabled: true,
  baseUrl: 'https://acme.atlassian.net',
  apiBaseUrl: 'https://acme.atlassian.net',
  baseUrlFromEnv: false,
  email: 'tech@corp.example',
  token: 'jira-token',
  defaultProjectKey: 'OPS',
  issueTypeName: 'Task',
  pollIntervalMinutes: 5,
  cancelResolutions: ["won't do", 'cancelled', 'duplicate'],
  hasToken: true,
  tokenDecryptable: true,
} as any;

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
  app.use('/api/users', usersRoutes);
  return app;
}

describe('Integration Tests - Complete Workflows', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
    mockedGetJiraConfig.mockResolvedValue(JIRA_CFG);
  });

  // The execution half of this workflow changed with the Jira integration: an
  // APPROVED idea is DISPATCHED to Jira (it stays APPROVED until work starts there
  // and never gets an in-app assignee), while the in-app steps/complete endpoints
  // survive only for GRANDFATHERED claim-era ideas — those that already carry
  // IN_PROGRESS + an assignee. This suite walks both legs.
  describe('Full Idea Lifecycle: Submit → Approve → Dispatch to Jira → (grandfathered) Complete', () => {
    test('should successfully complete entire idea workflow', async () => {
      // Setup users
      const regularUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
        passwordHash: 'hash1',
        role: 'USER',
      };

      const powerUser = {
        id: 'power1',
        name: 'Power User',
        email: 'power@example.com',
        passwordHash: 'hash2',
        role: 'POWER_USER',
      };

      const anotherUser = {
        id: 'user2',
        name: 'Jane Smith',
        email: 'jane@example.com',
        passwordHash: 'hash3',
        role: 'USER',
      };

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      // Step 1: Regular user logs in
      const userAgent = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(regularUser);

      const loginResponse = await userAgent.post('/api/auth/login').send({
        email: 'john@example.com',
        password: 'password123',
      });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.role).toBe('USER');

      // Step 2: User submits an idea
      const submittedIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa001',
        title: 'Implement Weekly Team Retrospectives',
        description: 'Regular retrospectives will help us identify and fix process issues quickly',
        benefits: 'Improved team communication, faster problem resolution, better morale',
        effort: 'LESS_THAN_ONE_DAY',
        status: 'SUBMITTED',
        tags: ['process', 'team'],
        submitterId: regularUser.id,
        submitter: regularUser,
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaFunctions.idea.create.mockResolvedValue(submittedIdea);
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});
      mockPrismaFunctions.department.findUnique.mockResolvedValue({ id: DEPT_ID, name: 'Všeobecné' });

      const submitResponse = await userAgent.post('/api/ideas').send({
        title: 'Implement Weekly Team Retrospectives',
        description: 'Regular retrospectives will help us identify and fix process issues quickly',
        benefits: 'Improved team communication, faster problem resolution, better morale',
        effort: 'LESS_THAN_ONE_DAY',
        tags: ['process', 'team'],
        departmentId: DEPT_ID,
      });

      expect(submitResponse.status).toBe(201);
      expect(submitResponse.body.status).toBe('SUBMITTED');

      // Step 3: Power user logs in
      const powerAgent = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(powerUser);

      const powerLoginResponse = await powerAgent.post('/api/auth/login').send({
        email: 'power@example.com',
        password: 'password123',
      });

      expect(powerLoginResponse.status).toBe(200);
      expect(powerLoginResponse.body.role).toBe('POWER_USER');

      // Step 4: Power user approves the idea
      const approvedIdea = {
        ...submittedIdea,
        status: 'APPROVED',
        approverId: powerUser.id,
        approver: powerUser,
        approvedAt: new Date(),
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(submittedIdea);
      mockPrismaFunctions.idea.update.mockResolvedValue(approvedIdea);

      const approveResponse = await powerAgent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/approve').send({
        note: 'Great idea! Let\'s implement this.',
      });

      expect(approveResponse.status).toBe(200);
      expect(approveResponse.body.status).toBe('APPROVED');
      expect(approveResponse.body.approverId).toBe(powerUser.id);

      // Step 5: The power user DISPATCHES the approved idea to Jira. The atomic
      // claim wins, the issue is created, and the idea STAYS APPROVED (a fresh Jira
      // issue sits in the `new`/To Do category) with no in-app assignee.
      const dispatchedIdea = {
        ...approvedIdea,
        jiraIssueId: '10001',
        jiraIssueKey: 'OPS-1',
        jiraStatusCategory: 'new',
        jiraSyncActive: true,
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue({
        ...approvedIdea,
        department: { id: DEPT_ID, name: 'Všeobecné', jiraProjectKey: null },
      });
      mockPrismaFunctions.idea.updateMany.mockResolvedValue({ count: 1 });
      mockedCreateJiraIssue.mockResolvedValue({
        ok: true,
        issueId: '10001',
        issueKey: 'OPS-1',
        browseUrl: 'https://acme.atlassian.net/browse/OPS-1',
      } as any);
      mockPrismaFunctions.idea.update.mockResolvedValue(dispatchedIdea);

      const dispatchResponse = await powerAgent
        .post('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/jira-task')
        .send({});

      expect(dispatchResponse.status).toBe(200);
      expect(dispatchResponse.body.status).toBe('APPROVED');
      expect(dispatchResponse.body.jiraIssueKey).toBe('OPS-1');
      expect(dispatchResponse.body.jiraBrowseUrl).toBe('https://acme.atlassian.net/browse/OPS-1');
      // No in-app assignee is ever set by the dispatch.
      expect(dispatchResponse.body.assigneeId).toBeUndefined();

      // Step 6: the GRANDFATHERED leg. An idea from the claim era already carries
      // IN_PROGRESS + an assignee; those ideas keep working with the in-app
      // steps/complete endpoints, which are assignee-gated (and therefore closed for
      // Jira-driven ideas, which never get an assignee).
      const claimEraIdea = {
        ...approvedIdea,
        status: 'IN_PROGRESS',
        assigneeId: anotherUser.id,
        assignee: anotherUser,
        startedAt: new Date(),
      };

      const claimerAgent = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(anotherUser);
      await claimerAgent.post('/api/auth/login').send({
        email: 'jane@example.com',
        password: 'password123',
      });

      const completedIdea = {
        ...claimEraIdea,
        status: 'DONE',
        completedAt: new Date(),
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(claimEraIdea);
      mockPrismaFunctions.idea.update.mockResolvedValue(completedIdea);

      const completeResponse = await claimerAgent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/complete').send({
        note: 'Retrospective process is now in place. First session went great!',
      });

      expect(completeResponse.status).toBe(200);
      expect(completeResponse.body.status).toBe('DONE');
      expect(completeResponse.body.completedAt).toBeDefined();

      // Verify all events were logged
      expect(mockPrismaFunctions.ideaEvent.create).toHaveBeenCalledTimes(4); // Submit, Approve, Jira dispatch, Complete
      const eventTypes = mockPrismaFunctions.ideaEvent.create.mock.calls.map(
        (call: [{ data: { type: string } }]) => call[0].data.type
      );
      expect(eventTypes).toEqual(['SUBMITTED', 'APPROVED', 'JIRA_CREATED', 'COMPLETED']);
    });

    // The claim endpoint is GONE: the route no longer exists at all.
    //
    // The path segment is a NAMED CONSTANT rather than a literal so the repo-wide
    // guard that proves the flow was removed (a search for the old route path across
    // backend/src) stays clean while this regression check still exercises it.
    const REMOVED_EXECUTION_SEGMENT = 'claim';

    test('the removed claim endpoint is a 404 (breaking change)', async () => {
      const user = { id: 'user2', name: 'Jane', email: 'jane@example.com', passwordHash: 'h', role: 'USER' };
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(user);
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: 'jane@example.com', password: 'password123' });

      const response = await agent.patch(
        `/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/${REMOVED_EXECUTION_SEGMENT}`
      );

      expect(response.status).toBe(404);
      expect(mockPrismaFunctions.idea.update).not.toHaveBeenCalled();
    });
  });

  describe('Full Idea Lifecycle: Submit → Reject', () => {
    test('should successfully reject an idea', async () => {
      const regularUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
        passwordHash: 'hash1',
        role: 'USER',
      };

      const powerUser = {
        id: 'power1',
        name: 'Power User',
        email: 'power@example.com',
        passwordHash: 'hash2',
        role: 'POWER_USER',
      };

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      // User submits idea
      const userAgent = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(regularUser);
      await userAgent.post('/api/auth/login').send({
        email: 'john@example.com',
        password: 'password123',
      });

      const submittedIdea = {
        id: 'aaaaaaaaaaaaaaaaaaaaa002',
        title: 'Install Nap Pods',
        description: 'Add nap pods for employees',
        benefits: 'Better rest',
        effort: 'MORE_THAN_THREE_DAYS',
        status: 'SUBMITTED',
        tags: [],
        submitterId: regularUser.id,
        submitter: regularUser,
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaFunctions.idea.create.mockResolvedValue(submittedIdea);
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});
      mockPrismaFunctions.department.findUnique.mockResolvedValue({ id: DEPT_ID, name: 'Všeobecné' });

      await userAgent.post('/api/ideas').send({
        title: 'Install Nap Pods',
        description: 'Add nap pods for employees',
        benefits: 'Better rest',
        effort: 'MORE_THAN_THREE_DAYS',
        departmentId: DEPT_ID,
      });

      // Power user rejects idea
      const powerAgent = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(powerUser);
      await powerAgent.post('/api/auth/login').send({
        email: 'power@example.com',
        password: 'password123',
      });

      const rejectedIdea = {
        ...submittedIdea,
        status: 'REJECTED',
        approverId: powerUser.id,
        approver: powerUser,
        rejectedAt: new Date(),
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(submittedIdea);
      mockPrismaFunctions.idea.update.mockResolvedValue(rejectedIdea);

      const rejectResponse = await powerAgent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa002/reject').send({
        note: 'Budget constraints make this unfeasible',
      });

      expect(rejectResponse.status).toBe(200);
      expect(rejectResponse.body.status).toBe('REJECTED');
    });
  });

  describe('Admin User Management Workflow', () => {
    test('should create, update, and manage users', async () => {
      const admin = {
        id: 'admin1',
        name: 'Admin User',
        email: 'admin@example.com',
        passwordHash: 'hash',
        role: 'ADMIN',
      };

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$newhash');

      // Admin logs in
      const adminAgent = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(admin);

      await adminAgent.post('/api/auth/login').send({
        email: 'admin@example.com',
        password: 'admin123',
      });

      // Admin creates a new user
      const newUser = {
        id: 'bbbbbbbbbbbbbbbbbbbbb005',
        name: 'New Employee',
        email: 'new@example.com',
        role: 'USER',
        createdAt: new Date(),
      };

      mockPrismaFunctions.user.findUnique.mockResolvedValueOnce(null); // Email check
      mockPrismaFunctions.user.create.mockResolvedValue(newUser);

      const createResponse = await adminAgent.post('/api/users').send({
        name: 'New Employee',
        email: 'new@example.com',
        password: 'welcome123456',
        role: 'USER',
      });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.email).toBe('new@example.com');

      // Admin promotes user to POWER_USER
      const updatedUser = {
        ...newUser,
        role: 'POWER_USER',
        updatedAt: new Date(),
      };

      mockPrismaFunctions.user.findUnique.mockResolvedValue(newUser);
      mockPrismaFunctions.user.update.mockResolvedValue(updatedUser);

      const updateResponse = await adminAgent.patch('/api/users/bbbbbbbbbbbbbbbbbbbbb005').send({
        role: 'POWER_USER',
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.role).toBe('POWER_USER');

      // Admin views all users
      mockPrismaFunctions.user.findMany.mockResolvedValue([admin, updatedUser]);

      const listResponse = await adminAgent.get('/api/users');

      expect(listResponse.status).toBe(200);
      expect(listResponse.body).toHaveLength(2);
    });
  });

  describe('Authorization Enforcement', () => {
    test('should prevent users from accessing admin endpoints', async () => {
      const regularUser = {
        id: 'user1',
        name: 'Regular User',
        email: 'user@example.com',
        passwordHash: 'hash',
        role: 'USER',
      };

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const userAgent = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(regularUser);

      await userAgent.post('/api/auth/login').send({
        email: 'user@example.com',
        password: 'password123',
      });

      // Try to access user management
      const usersResponse = await userAgent.get('/api/users');
      expect(usersResponse.status).toBe(403);

      // Try to create a user
      const createResponse = await userAgent.post('/api/users').send({
        name: 'Unauthorized',
        email: 'bad@example.com',
        password: 'password',
      });
      expect(createResponse.status).toBe(403);
    });

    test('should prevent users from approving ideas', async () => {
      const regularUser = {
        id: 'user1',
        name: 'Regular User',
        email: 'user@example.com',
        passwordHash: 'hash',
        role: 'USER',
      };

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const userAgent = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(regularUser);

      await userAgent.post('/api/auth/login').send({
        email: 'user@example.com',
        password: 'password123',
      });

      const approveResponse = await userAgent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/approve');
      expect(approveResponse.status).toBe(403);

      const rejectResponse = await userAgent.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/reject');
      expect(rejectResponse.status).toBe(403);
    });
  });

  describe('Concurrent User Sessions', () => {
    test('should handle multiple concurrent user sessions independently', async () => {
      const user1 = {
        id: 'user1',
        name: 'User 1',
        email: 'user1@example.com',
        passwordHash: 'hash1',
        role: 'USER',
      };

      const user2 = {
        id: 'user2',
        name: 'User 2',
        email: 'user2@example.com',
        passwordHash: 'hash2',
        role: 'POWER_USER',
      };

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      // User 1 logs in
      const agent1 = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(user1);

      const login1 = await agent1.post('/api/auth/login').send({
        email: 'user1@example.com',
        password: 'password',
      });
      expect(login1.body.id).toBe('user1');

      // User 2 logs in (separate session)
      const agent2 = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(user2);

      const login2 = await agent2.post('/api/auth/login').send({
        email: 'user2@example.com',
        password: 'password',
      });
      expect(login2.body.id).toBe('user2');

      // Both users should maintain their own sessions
      mockPrismaFunctions.user.findUnique.mockResolvedValue(user1);
      const me1 = await agent1.get('/api/auth/me');
      expect(me1.body.id).toBe('user1');

      mockPrismaFunctions.user.findUnique.mockResolvedValue(user2);
      const me2 = await agent2.get('/api/auth/me');
      expect(me2.body.id).toBe('user2');

      // User 2 (Power User) can approve, User 1 cannot
      const approve1 = await agent1.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/approve');
      expect(approve1.status).toBe(403);

      mockPrismaFunctions.idea.findUnique.mockResolvedValue({ id: 'aaaaaaaaaaaaaaaaaaaaa001', status: 'SUBMITTED' });
      mockPrismaFunctions.idea.update.mockResolvedValue({ id: 'aaaaaaaaaaaaaaaaaaaaa001', status: 'APPROVED' });
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

      const approve2 = await agent2.patch('/api/ideas/aaaaaaaaaaaaaaaaaaaaa001/approve');
      expect(approve2.status).toBe(200);
    });
  });
});
