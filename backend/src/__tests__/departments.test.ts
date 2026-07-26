import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes
const mockPrismaFunctions: Record<string, any> = {
  user: {
    findUnique: jest.fn(),
  },
  department: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  idea: {
    count: jest.fn(),
  },
};
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
  };
});

jest.mock('bcrypt');

// Import routes AFTER mocks
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';
import departmentsRoutes from '../routes/departments';

// A Prisma-style known-request error carries a `.code`; the route branches on it.
function prismaError(code: string) {
  return Object.assign(new Error(`Prisma error ${code}`), { code });
}

const VALID_ID = 'aaaaaaaaaaaaaaaaaaaaa001';
const UNKNOWN_ID = 'ccccccccccccccccccccc404';

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
  app.use('/api/departments', departmentsRoutes);
  return app;
}

async function loginAsUser(app: express.Application, role: string = 'ADMIN') {
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

describe('Departments API', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe('GET /api/departments', () => {
    test('returns a plain sorted array with idea counts for any authenticated user', async () => {
      const { agent } = await loginAsUser(app, 'USER');

      const departments = [
        { id: 'a', name: 'Všeobecné', order: 0, _count: { ideas: 3 } },
        { id: 'b', name: 'Marketing', order: 1, _count: { ideas: 1 } },
      ];
      mockPrismaFunctions.department.findMany.mockResolvedValue(departments);

      const response = await agent.get('/api/departments');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toMatchObject({ name: 'Všeobecné', _count: { ideas: 3 } });
      expect(mockPrismaFunctions.department.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ order: 'asc' }, { name: 'asc' }],
          include: { _count: { select: { ideas: true } } },
        })
      );
    });

    test('returns 401 when not authenticated', async () => {
      const response = await request(app).get('/api/departments');
      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    // notificationEmails is internal admin-only data — visible to ADMIN sessions only.
    const withEmails = [
      { id: 'a', name: 'Všeobecné', order: 0, notificationEmails: ['ops@corp.example'], _count: { ideas: 3 } },
      { id: 'b', name: 'Marketing', order: 1, notificationEmails: [], _count: { ideas: 1 } },
    ];

    test('includes notificationEmails for an ADMIN session', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findMany.mockResolvedValue(withEmails);

      const response = await agent.get('/api/departments');

      expect(response.status).toBe(200);
      expect(response.body[0]).toHaveProperty('notificationEmails', ['ops@corp.example']);
      expect(response.body[1]).toHaveProperty('notificationEmails', []);
      // Other fields still present.
      expect(response.body[0]).toMatchObject({ name: 'Všeobecné', _count: { ideas: 3 } });
    });

    test('omits notificationEmails for a non-admin (USER) session', async () => {
      const { agent } = await loginAsUser(app, 'USER');
      mockPrismaFunctions.department.findMany.mockResolvedValue(withEmails);

      const response = await agent.get('/api/departments');

      expect(response.status).toBe(200);
      expect(response.body[0]).not.toHaveProperty('notificationEmails');
      expect(response.body[1]).not.toHaveProperty('notificationEmails');
      // The rest of the shape is unchanged for non-admins.
      expect(response.body[0]).toMatchObject({ id: 'a', name: 'Všeobecné', order: 0, _count: { ideas: 3 } });
    });

    test('omits notificationEmails for a POWER_USER session', async () => {
      const { agent } = await loginAsUser(app, 'POWER_USER');
      mockPrismaFunctions.department.findMany.mockResolvedValue(withEmails);

      const response = await agent.get('/api/departments');

      expect(response.status).toBe(200);
      expect(response.body[0]).not.toHaveProperty('notificationEmails');
    });
  });

  describe('role guards on mutations', () => {
    const mutations: Array<[string, string, Record<string, unknown> | undefined]> = [
      ['post', '/api/departments', { name: 'Sales' }],
      ['patch', '/api/departments/reorder', { ids: [VALID_ID] }],
      ['patch', `/api/departments/${VALID_ID}`, { name: 'Sales' }],
      ['delete', `/api/departments/${VALID_ID}`, undefined],
    ];

    for (const role of ['USER', 'POWER_USER']) {
      for (const [method, path, body] of mutations) {
        test(`${role} gets 403 on ${method.toUpperCase()} ${path}`, async () => {
          const { agent } = await loginAsUser(app, role);
          let req = (agent as any)[method](path);
          if (body) req = req.send(body);
          const response = await req;
          expect(response.status).toBe(403);
          expect(response.body).toHaveProperty('error');
        });
      }
    }
  });

  describe('POST /api/departments', () => {
    test('ADMIN creates a department, appending order = max + 1', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findFirst.mockResolvedValue({ id: 'x', order: 4 });
      mockPrismaFunctions.department.create.mockResolvedValue({ id: 'new', name: 'Sales', order: 5 });

      const response = await agent.post('/api/departments').send({ name: 'Sales' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ name: 'Sales', order: 5 });
      expect(mockPrismaFunctions.department.create).toHaveBeenCalledWith({
        data: { name: 'Sales', order: 5 },
      });
    });

    test('ADMIN creates the first department with order 0 when none exist', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findFirst.mockResolvedValue(null);
      mockPrismaFunctions.department.create.mockResolvedValue({ id: 'new', name: 'Sales', order: 0 });

      const response = await agent.post('/api/departments').send({ name: 'Sales' });

      expect(response.status).toBe(201);
      expect(mockPrismaFunctions.department.create).toHaveBeenCalledWith({
        data: { name: 'Sales', order: 0 },
      });
    });

    test('trims the name and rejects an all-whitespace name with 400', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.post('/api/departments').send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.department.create).not.toHaveBeenCalled();
    });

    test('rejects a name longer than 100 chars with 400', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.post('/api/departments').send({ name: 'A'.repeat(101) });

      expect(response.status).toBe(400);
    });

    test('duplicate name (Prisma P2002) returns 409', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findFirst.mockResolvedValue(null);
      mockPrismaFunctions.department.create.mockRejectedValue(prismaError('P2002'));

      const response = await agent.post('/api/departments').send({ name: 'Duplicate' });

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PATCH /api/departments/reorder', () => {
    test('ADMIN reorders departments, applying order = array index', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findMany
        .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
        .mockResolvedValueOnce([
          { id: 'c', name: 'C', order: 0, _count: { ideas: 0 } },
          { id: 'a', name: 'A', order: 1, _count: { ideas: 0 } },
          { id: 'b', name: 'B', order: 2, _count: { ideas: 0 } },
        ]);
      mockPrismaFunctions.department.update.mockResolvedValue({});

      const response = await agent.patch('/api/departments/reorder').send({ ids: ['c', 'a', 'b'] });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(3);
      expect(response.body[0]).toMatchObject({ id: 'c', order: 0 });
      expect(mockPrismaFunctions.department.update).toHaveBeenCalledWith({ where: { id: 'c' }, data: { order: 0 } });
      expect(mockPrismaFunctions.department.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { order: 1 } });
      expect(mockPrismaFunctions.department.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { order: 2 } });
    });

    test('a different set of ids returns 400 and applies nothing', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

      const response = await agent.patch('/api/departments/reorder').send({ ids: ['a', 'b', 'z'] });

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.department.update).not.toHaveBeenCalled();
    });

    test('a wrong-size id list returns 400', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

      const response = await agent.patch('/api/departments/reorder').send({ ids: ['a', 'b'] });

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.department.update).not.toHaveBeenCalled();
    });

    test('duplicate ids return 400', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

      const response = await agent.patch('/api/departments/reorder').send({ ids: ['a', 'a', 'b'] });

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.department.update).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/departments/:id', () => {
    test('ADMIN renames a department', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findUnique.mockResolvedValue({ id: VALID_ID, name: 'Old', order: 0 });
      mockPrismaFunctions.department.update.mockResolvedValue({ id: VALID_ID, name: 'New', order: 0 });

      const response = await agent.patch(`/api/departments/${VALID_ID}`).send({ name: 'New' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ name: 'New' });
      expect(mockPrismaFunctions.department.update).toHaveBeenCalledWith({
        where: { id: VALID_ID },
        data: { name: 'New' },
      });
    });

    test('renaming an unknown department returns 404', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findUnique.mockResolvedValue(null);

      const response = await agent.patch(`/api/departments/${UNKNOWN_ID}`).send({ name: 'New' });

      expect(response.status).toBe(404);
      expect(mockPrismaFunctions.department.update).not.toHaveBeenCalled();
    });

    test('renaming to a duplicate name (P2002) returns 409', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findUnique.mockResolvedValue({ id: VALID_ID, name: 'Old', order: 0 });
      mockPrismaFunctions.department.update.mockRejectedValue(prismaError('P2002'));

      const response = await agent.patch(`/api/departments/${VALID_ID}`).send({ name: 'Taken' });

      expect(response.status).toBe(409);
    });

    test('a malformed id returns 400', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.patch('/api/departments/not-an-object-id').send({ name: 'New' });

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.department.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/departments/:id — notification emails', () => {
    beforeEach(() => {
      mockPrismaFunctions.department.findUnique.mockResolvedValue({ id: VALID_ID, name: 'Old', order: 0 });
      mockPrismaFunctions.department.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: VALID_ID, name: 'Old', order: 0, notificationEmails: [], ...data })
      );
    });

    test('updates notificationEmails only, leaving name untouched', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent
        .patch(`/api/departments/${VALID_ID}`)
        .send({ notificationEmails: ['ops@corp.example'] });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('notificationEmails', ['ops@corp.example']);
      expect(mockPrismaFunctions.department.update).toHaveBeenCalledWith({
        where: { id: VALID_ID },
        data: { notificationEmails: ['ops@corp.example'] },
      });
    });

    test('updates name only (no notificationEmails key in the update data)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.patch(`/api/departments/${VALID_ID}`).send({ name: 'Renamed' });

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.department.update).toHaveBeenCalledWith({
        where: { id: VALID_ID },
        data: { name: 'Renamed' },
      });
    });

    test('updates both name and notificationEmails together', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent
        .patch(`/api/departments/${VALID_ID}`)
        .send({ name: 'Renamed', notificationEmails: ['a@corp.example', 'b@corp.example'] });

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.department.update).toHaveBeenCalledWith({
        where: { id: VALID_ID },
        data: { name: 'Renamed', notificationEmails: ['a@corp.example', 'b@corp.example'] },
      });
    });

    test('trims and de-duplicates notification emails', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent
        .patch(`/api/departments/${VALID_ID}`)
        .send({ notificationEmails: ['  dup@corp.example  ', 'dup@corp.example', 'other@corp.example'] });

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.department.update).toHaveBeenCalledWith({
        where: { id: VALID_ID },
        data: { notificationEmails: ['dup@corp.example', 'other@corp.example'] },
      });
    });

    test('accepts an empty array (clears the list)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.patch(`/api/departments/${VALID_ID}`).send({ notificationEmails: [] });

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.department.update).toHaveBeenCalledWith({
        where: { id: VALID_ID },
        data: { notificationEmails: [] },
      });
    });

    test('rejects an invalid email entry with 400 and does not update', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent
        .patch(`/api/departments/${VALID_ID}`)
        .send({ notificationEmails: ['ok@corp.example', 'not-an-email'] });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockPrismaFunctions.department.update).not.toHaveBeenCalled();
    });

    test('rejects more than 20 notification emails with 400', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      const emails = Array.from({ length: 21 }, (_, i) => `user${i}@corp.example`);

      const response = await agent.patch(`/api/departments/${VALID_ID}`).send({ notificationEmails: emails });

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.department.update).not.toHaveBeenCalled();
    });

    test('rejects a non-array notificationEmails with 400', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent
        .patch(`/api/departments/${VALID_ID}`)
        .send({ notificationEmails: 'ops@corp.example' });

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.department.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/departments/:id', () => {
    test('ADMIN deletes an unreferenced, non-last department', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findUnique.mockResolvedValue({ id: VALID_ID, name: 'X', order: 1 });
      mockPrismaFunctions.idea.count.mockResolvedValue(0);
      mockPrismaFunctions.department.count.mockResolvedValue(3);
      mockPrismaFunctions.department.delete.mockResolvedValue({});

      const response = await agent.delete(`/api/departments/${VALID_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(mockPrismaFunctions.department.delete).toHaveBeenCalledWith({ where: { id: VALID_ID } });
    });

    test('delete is blocked (409) when the department still has ideas', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findUnique.mockResolvedValue({ id: VALID_ID, name: 'X', order: 1 });
      mockPrismaFunctions.idea.count.mockResolvedValue(5);

      const response = await agent.delete(`/api/departments/${VALID_ID}`);

      expect(response.status).toBe(409);
      expect(mockPrismaFunctions.department.delete).not.toHaveBeenCalled();
    });

    test('delete is blocked (409) when it is the last remaining department', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findUnique.mockResolvedValue({ id: VALID_ID, name: 'X', order: 0 });
      mockPrismaFunctions.idea.count.mockResolvedValue(0);
      mockPrismaFunctions.department.count.mockResolvedValue(1);

      const response = await agent.delete(`/api/departments/${VALID_ID}`);

      expect(response.status).toBe(409);
      expect(mockPrismaFunctions.department.delete).not.toHaveBeenCalled();
    });

    test('deleting an unknown department returns 404', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.department.findUnique.mockResolvedValue(null);

      const response = await agent.delete(`/api/departments/${UNKNOWN_ID}`);

      expect(response.status).toBe(404);
      expect(mockPrismaFunctions.department.delete).not.toHaveBeenCalled();
    });

    test('a malformed id returns 400', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.delete('/api/departments/not-an-object-id');

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.department.findUnique).not.toHaveBeenCalled();
    });
  });
});
