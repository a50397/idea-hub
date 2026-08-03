import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the axios instance so the api layer never hits the network. The module has a
// default export, so the factory must return it under `default`.
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import client from '../api/client';
import { webexSettingsApi } from '../api/webexSettings';

const mockedClient = vi.mocked(client);

describe('webexSettingsApi.getRooms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GETs /webex-settings/rooms and returns the rooms listing (no reason on success)', async () => {
    mockedClient.get.mockResolvedValueOnce({
      data: { rooms: [{ id: 'r1', title: 'Room One' }, { id: 'r2', title: 'Room Two' }] },
    });

    const result = await webexSettingsApi.getRooms();

    expect(mockedClient.get).toHaveBeenCalledWith('/webex-settings/rooms');
    expect(result.rooms).toEqual([
      { id: 'r1', title: 'Room One' },
      { id: 'r2', title: 'Room Two' },
    ]);
    expect(result.reason).toBeUndefined();
  });

  it('passes through the empty list and the fixed reason when rooms cannot be loaded', async () => {
    // The endpoint always answers 200; a failure is { rooms: [], reason }.
    mockedClient.get.mockResolvedValueOnce({ data: { rooms: [], reason: 'config_error' } });

    const result = await webexSettingsApi.getRooms();

    expect(result.rooms).toEqual([]);
    expect(result.reason).toBe('config_error');
  });

  it('passes through a genuinely empty list with NO reason as a success', async () => {
    // A valid bot that simply is not in any space yet: empty rooms and NO reason. The
    // absent reason is what tells the caller this is a success, not a load failure.
    mockedClient.get.mockResolvedValueOnce({ data: { rooms: [] } });

    const result = await webexSettingsApi.getRooms();

    expect(result.rooms).toEqual([]);
    expect(result.reason).toBeUndefined();
  });
});
