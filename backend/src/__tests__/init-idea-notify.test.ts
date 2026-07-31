const mockPrisma = {
  $runCommandRaw: jest.fn(),
};

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import { ensureIdeaNotifyDefaults } from '../utils/init-idea-notify';

describe('ensureIdeaNotifyDefaults', () => {
  let mockExit: jest.SpyInstance;
  let mockConsoleError: jest.SpyInstance;
  let mockConsoleLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test('backfills missing notifyOnChange via a raw Mongo update and logs the count', async () => {
    mockPrisma.$runCommandRaw.mockResolvedValue({ nModified: 3, n: 3 });

    await ensureIdeaNotifyDefaults();

    expect(mockPrisma.$runCommandRaw).toHaveBeenCalledWith({
      update: 'ideas',
      updates: [
        {
          q: { notifyOnChange: { $exists: false } },
          u: { $set: { notifyOnChange: false } },
          multi: true,
        },
      ],
    });
    expect(mockConsoleLog).toHaveBeenCalledWith(
      'Backfilled notifyOnChange=false on 3 legacy idea(s)'
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  test('logs nothing when no legacy documents needed the backfill', async () => {
    mockPrisma.$runCommandRaw.mockResolvedValue({ nModified: 0, n: 0 });

    await ensureIdeaNotifyDefaults();

    expect(mockConsoleLog).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  test('logs and continues (no process.exit) when the backfill fails — reads tolerate the missing field', async () => {
    mockPrisma.$runCommandRaw.mockRejectedValue(new Error('db down'));

    await expect(ensureIdeaNotifyDefaults()).resolves.toBeUndefined();

    expect(mockConsoleError).toHaveBeenCalledWith(
      'Failed to ensure idea notify defaults (continuing):',
      expect.any(Error)
    );
    expect(mockExit).not.toHaveBeenCalled();
  });
});
