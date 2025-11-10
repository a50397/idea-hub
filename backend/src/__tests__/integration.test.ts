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
  },
  idea: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  ideaEvent: {
    create: jest.fn(),
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
  app.use('/api/ideas', ideasRoutes);
  app.use('/api/users', usersRoutes);
  return app;
}

describe('Integration Tests - Complete Workflows', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe('Full Idea Lifecycle: Submit → Approve → Claim → Complete', () => {
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
        id: 'idea1',
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

      const submitResponse = await userAgent.post('/api/ideas').send({
        title: 'Implement Weekly Team Retrospectives',
        description: 'Regular retrospectives will help us identify and fix process issues quickly',
        benefits: 'Improved team communication, faster problem resolution, better morale',
        effort: 'LESS_THAN_ONE_DAY',
        tags: ['process', 'team'],
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

      const approveResponse = await powerAgent.patch('/api/ideas/idea1/approve').send({
        note: 'Great idea! Let\'s implement this.',
      });

      expect(approveResponse.status).toBe(200);
      expect(approveResponse.body.status).toBe('APPROVED');
      expect(approveResponse.body.approverId).toBe(powerUser.id);

      // Step 5: Another user claims the idea
      const claimerAgent = request.agent(app);
      mockPrismaFunctions.user.findUnique.mockResolvedValue(anotherUser);

      await claimerAgent.post('/api/auth/login').send({
        email: 'jane@example.com',
        password: 'password123',
      });

      const claimedIdea = {
        ...approvedIdea,
        status: 'IN_PROGRESS',
        assigneeId: anotherUser.id,
        assignee: anotherUser,
        startedAt: new Date(),
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(approvedIdea);
      mockPrismaFunctions.idea.update.mockResolvedValue(claimedIdea);

      const claimResponse = await claimerAgent.patch('/api/ideas/idea1/claim');

      expect(claimResponse.status).toBe(200);
      expect(claimResponse.body.status).toBe('IN_PROGRESS');
      expect(claimResponse.body.assigneeId).toBe(anotherUser.id);

      // Step 6: Assigned user completes the idea
      const completedIdea = {
        ...claimedIdea,
        status: 'DONE',
        completedAt: new Date(),
      };

      mockPrismaFunctions.idea.findUnique.mockResolvedValue(claimedIdea);
      mockPrismaFunctions.idea.update.mockResolvedValue(completedIdea);

      const completeResponse = await claimerAgent.patch('/api/ideas/idea1/complete').send({
        note: 'Retrospective process is now in place. First session went great!',
      });

      expect(completeResponse.status).toBe(200);
      expect(completeResponse.body.status).toBe('DONE');
      expect(completeResponse.body.completedAt).toBeDefined();

      // Verify all events were logged
      expect(mockPrismaFunctions.ideaEvent.create).toHaveBeenCalledTimes(4); // Submit, Approve, Claim, Complete
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
        id: 'idea2',
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

      await userAgent.post('/api/ideas').send({
        title: 'Install Nap Pods',
        description: 'Add nap pods for employees',
        benefits: 'Better rest',
        effort: 'MORE_THAN_THREE_DAYS',
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

      const rejectResponse = await powerAgent.patch('/api/ideas/idea2/reject').send({
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
        id: 'newuser',
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
        password: 'welcome123',
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

      const updateResponse = await adminAgent.patch('/api/users/newuser').send({
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

      const approveResponse = await userAgent.patch('/api/ideas/idea1/approve');
      expect(approveResponse.status).toBe(403);

      const rejectResponse = await userAgent.patch('/api/ideas/idea1/reject');
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
      const approve1 = await agent1.patch('/api/ideas/idea1/approve');
      expect(approve1.status).toBe(403);

      mockPrismaFunctions.idea.findUnique.mockResolvedValue({ id: 'idea1', status: 'SUBMITTED' });
      mockPrismaFunctions.idea.update.mockResolvedValue({ id: 'idea1', status: 'APPROVED' });
      mockPrismaFunctions.ideaEvent.create.mockResolvedValue({});

      const approve2 = await agent2.patch('/api/ideas/idea1/approve');
      expect(approve2.status).toBe(200);
    });
  });
});
