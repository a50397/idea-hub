// The Jira sibling of init-idea-notify.test.ts. This backfill is LOAD-BEARING, not
// merely belt-and-braces: the dispatch endpoint claims an idea with
// `updateMany({ where: { ..., jiraSyncActive: false } })`, and a Prisma+Mongo
// where-clause does NOT match a *missing* scalar — without the backfill an idea that
// predates the feature would answer 409 forever. (The real-Mongo proof of that
// missing-vs-null behavior lives in the integration tier.)

const mockPrisma = {
  $runCommandRaw: jest.fn(),
};

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import { ensureIdeaJiraDefaults } from '../utils/init-idea-jira';

describe('ensureIdeaJiraDefaults', () => {
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

  test('backfills missing jiraSyncActive via a raw Mongo update and logs the count', async () => {
    mockPrisma.$runCommandRaw.mockResolvedValue({ nModified: 2, n: 2 });

    await ensureIdeaJiraDefaults();

    // $exists:false is the ONLY way to match the documents that predate the field.
    expect(mockPrisma.$runCommandRaw).toHaveBeenCalledWith({
      update: 'ideas',
      updates: [
        {
          q: { jiraSyncActive: { $exists: false } },
          u: { $set: { jiraSyncActive: false } },
          multi: true,
        },
      ],
    });
    expect(mockConsoleLog).toHaveBeenCalledWith('Backfilled jiraSyncActive=false on 2 legacy idea(s)');
    expect(mockExit).not.toHaveBeenCalled();
  });

  test('is idempotent: logs nothing when every idea already has the field', async () => {
    mockPrisma.$runCommandRaw.mockResolvedValue({ nModified: 0, n: 0 });

    await ensureIdeaJiraDefaults();

    expect(mockConsoleLog).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  test('logs and continues (no process.exit) when the backfill fails — it runs after the server is listening', async () => {
    mockPrisma.$runCommandRaw.mockRejectedValue(new Error('db down'));

    await expect(ensureIdeaJiraDefaults()).resolves.toBeUndefined();

    expect(mockConsoleError).toHaveBeenCalledWith(
      'Failed to ensure idea jira defaults (continuing):',
      expect.any(Error)
    );
    expect(mockExit).not.toHaveBeenCalled();
  });
});
