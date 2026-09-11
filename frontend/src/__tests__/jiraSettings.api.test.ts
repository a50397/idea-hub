import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the axios instance so the api layer never hits the network. The module has a
// default export, so the factory must return it under `default`.
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import client from '../api/client';
import { EXTERNAL_CALL_TIMEOUT_MS } from '../api/timeouts';
import { jiraSettingsApi } from '../api/jiraSettings';

const mockedClient = vi.mocked(client);

describe('jiraSettingsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('GETs /jira-settings and returns the masked settings', async () => {
      const settings = {
        enabled: true,
        baseUrl: 'https://acme.atlassian.net',
        email: 'tech@corp.example',
        defaultProjectKey: 'OPS',
        issueTypeName: 'Task',
        pollIntervalMinutes: 5,
        cancelResolutions: "Won't Do,Cancelled,Duplicate",
        hasToken: true,
      };
      mockedClient.get.mockResolvedValueOnce({ data: settings });

      const result = await jiraSettingsApi.get();

      expect(mockedClient.get).toHaveBeenCalledWith('/jira-settings');
      expect(result).toEqual(settings);
    });
  });

  describe('update', () => {
    it('PUTs /jira-settings with the given payload and returns the masked response', async () => {
      const response = {
        enabled: true,
        baseUrl: 'https://acme.atlassian.net',
        email: 'tech@corp.example',
        defaultProjectKey: 'OPS',
        issueTypeName: 'Task',
        pollIntervalMinutes: 10,
        cancelResolutions: "Won't Do",
        hasToken: true,
      };
      mockedClient.put.mockResolvedValueOnce({ data: response });

      const payload = {
        enabled: true,
        baseUrl: 'https://acme.atlassian.net',
        email: 'tech@corp.example',
        defaultProjectKey: 'OPS',
        issueTypeName: 'Task',
        pollIntervalMinutes: 10,
        cancelResolutions: "Won't Do",
        apiToken: 'brand-new-token',
      };
      const result = await jiraSettingsApi.update(payload);

      expect(mockedClient.put).toHaveBeenCalledWith('/jira-settings', payload);
      expect(result).toEqual(response);
    });
  });

  describe('test', () => {
    it('POSTs /jira-settings/test with no body and returns the structured ok result', async () => {
      mockedClient.post.mockResolvedValueOnce({ data: { ok: true } });

      const result = await jiraSettingsApi.test();

      expect(mockedClient.post).toHaveBeenCalledWith('/jira-settings/test', undefined, {
        timeout: EXTERNAL_CALL_TIMEOUT_MS,
      });
      expect(result).toEqual({ ok: true });
    });

    it('passes through a failure result with its fixed reason', async () => {
      mockedClient.post.mockResolvedValueOnce({ data: { ok: false, reason: 'invalid_credentials' } });

      const result = await jiraSettingsApi.test();

      expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
    });
  });

  describe('getProjects', () => {
    it('GETs /jira-settings/projects and returns the listing (no reason on success)', async () => {
      mockedClient.get.mockResolvedValueOnce({
        data: { projects: [{ key: 'OPS', name: 'Operations' }, { key: 'MKT', name: 'Marketing' }] },
      });

      const result = await jiraSettingsApi.getProjects();

      expect(mockedClient.get).toHaveBeenCalledWith('/jira-settings/projects', {
        timeout: EXTERNAL_CALL_TIMEOUT_MS,
      });
      expect(result.projects).toEqual([
        { key: 'OPS', name: 'Operations' },
        { key: 'MKT', name: 'Marketing' },
      ]);
      expect(result.reason).toBeUndefined();
    });

    it('passes through the empty list and the fixed reason when projects cannot be loaded', async () => {
      // The endpoint always answers 200; a failure is { projects: [], reason }.
      mockedClient.get.mockResolvedValueOnce({ data: { projects: [], reason: 'config_error' } });

      const result = await jiraSettingsApi.getProjects();

      expect(result.projects).toEqual([]);
      expect(result.reason).toBe('config_error');
    });
  });
});
