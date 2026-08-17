import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the axios instance so the api layer never hits the network. The module has a
// default export, so the factory must return it under `default`.
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import client from '../api/client';
import { ideasApi } from '../api/ideas';
import { IdeaStatus, MAX_PAGE_LIMIT } from '../types';

const mockedClient = vi.mocked(client);

// The api layer builds one URL string; parse its query back out so the
// assertions pin the values rather than the (irrelevant) append order.
function requestedUrl(call: number = 0): string {
  return mockedClient.get.mock.calls[call][0] as string;
}

function requestedQuery(call: number = 0): URLSearchParams {
  const url = requestedUrl(call);
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

const envelope = {
  data: [{ id: 'idea-1', title: 'An idea' }],
  pagination: { page: 1, limit: MAX_PAGE_LIMIT, total: 250, totalPages: 3 },
};

describe('ideasApi.getAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedClient.get.mockResolvedValue({ data: envelope });
  });

  it('GETs /ideas and returns the { data, pagination } envelope unwrapped', async () => {
    const result = await ideasApi.getAll();

    expect(mockedClient.get).toHaveBeenCalledTimes(1);
    expect(requestedUrl()).toBe('/ideas?');
    // `pagination` is what tells a page the server capped its page; it must not
    // be swallowed the way a bare `data` unwrap would.
    expect(result.data).toEqual(envelope.data);
    expect(result.pagination).toEqual(envelope.pagination);
  });

  it('forwards every filter, including the page limit, into the query string', async () => {
    await ideasApi.getAll({
      status: IdeaStatus.APPROVED,
      submitterId: 'u1',
      assigneeId: 'u2',
      departmentId: 'd2',
      tags: ['automation', 'productivity'],
      limit: MAX_PAGE_LIMIT,
      page: 2,
    });

    const q = requestedQuery();
    expect(requestedUrl().startsWith('/ideas?')).toBe(true);
    expect(q.get('status')).toBe(IdeaStatus.APPROVED);
    expect(q.get('submitterId')).toBe('u1');
    expect(q.get('assigneeId')).toBe('u2');
    expect(q.get('departmentId')).toBe('d2');
    expect(q.getAll('tags')).toEqual(['automation', 'productivity']);
    // The pages that read org-wide lists ask for the maximum page explicitly;
    // dropping this would silently cut every such list to the default 20.
    expect(q.get('limit')).toBe(String(MAX_PAGE_LIMIT));
    // The pager depends on this reaching the server; dropping it would pin
    // every list to page 1 while the pager pretends to navigate.
    expect(q.get('page')).toBe('2');
  });

  it('omits the keys the caller left out instead of sending empty values', async () => {
    await ideasApi.getAll({ status: IdeaStatus.SUBMITTED });

    const q = requestedQuery();
    expect(q.get('status')).toBe(IdeaStatus.SUBMITTED);
    expect(q.has('submitterId')).toBe(false);
    expect(q.has('departmentId')).toBe(false);
    expect(q.has('limit')).toBe(false);
    expect(q.has('page')).toBe(false);
  });
});
