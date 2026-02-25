const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('bcrypt');

import bcrypt from 'bcrypt';
import { ensureAdminExists } from '../utils/init-admin';

describe('ensureAdminExists', () => {
  const originalEnv = process.env;
  let mockExit: jest.SpyInstance;
  let mockConsoleError: jest.SpyInstance;
  let mockConsoleLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnv;
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test('should do nothing if an admin already exists', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: '1', role: 'ADMIN' });

    await ensureAdminExists();

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({ where: { role: 'ADMIN' } });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  test('should exit if no admin exists and ADMIN_EMAIL is missing', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    delete process.env.ADMIN_EMAIL;
    process.env.ADMIN_PASSWORD = 'password';

    await ensureAdminExists();

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('ADMIN_EMAIL / ADMIN_PASSWORD are not set')
    );
  });

  test('should exit if no admin exists and ADMIN_PASSWORD is missing', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    process.env.ADMIN_EMAIL = 'admin@test.com';
    delete process.env.ADMIN_PASSWORD;

    await ensureAdminExists();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('should exit if both ADMIN_EMAIL and ADMIN_PASSWORD are missing', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;

    await ensureAdminExists();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('should create admin when no admin exists and env vars are set', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'new-admin' });
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

    process.env.ADMIN_EMAIL = 'admin@test.com';
    process.env.ADMIN_PASSWORD = 'secret123';

    await ensureAdminExists();

    expect(bcrypt.hash).toHaveBeenCalledWith('secret123', 10);
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        name: 'Admin',
        email: 'admin@test.com',
        passwordHash: 'hashed-password',
        role: 'ADMIN',
      },
    });
    expect(mockExit).not.toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith('Default admin created: admin@test.com');
  });

  test('should use ADMIN_NAME from env if provided', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'new-admin' });
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

    process.env.ADMIN_EMAIL = 'admin@test.com';
    process.env.ADMIN_PASSWORD = 'secret123';
    process.env.ADMIN_NAME = 'Super Admin';

    await ensureAdminExists();

    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Super Admin' }),
    });
  });

  test('should exit if prisma.user.findFirst throws', async () => {
    mockPrisma.user.findFirst.mockRejectedValue(new Error('DB connection failed'));

    await ensureAdminExists();

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockConsoleError).toHaveBeenCalledWith(
      'Failed to ensure admin exists:',
      expect.any(Error)
    );
  });

  test('should exit if prisma.user.create throws', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockRejectedValue(new Error('Duplicate key'));
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

    process.env.ADMIN_EMAIL = 'admin@test.com';
    process.env.ADMIN_PASSWORD = 'secret123';

    await ensureAdminExists();

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
