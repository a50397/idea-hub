import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the axios instance so the api layer never hits the network. The module has a
// default export, so the factory must return it under `default`.
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import client from '../api/client';
import { reportsApi } from '../api/reports';
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

describe('reportsApi.getFiltered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedClient.get.mockResolvedValue({ data: envelope });
  });

  it('GETs /reports/filtered and returns the { data, pagination } envelope unwrapped', async () => {
    const result = await reportsApi.getFiltered();

    expect(mockedClient.get).toHaveBeenCalledTimes(1);
    expect(requestedUrl()).toBe('/reports/filtered?');
    // `pagination.total` is the true match count the page shows in its header
    // and its truncation notice, so it must survive the unwrap.
    expect(result.data).toEqual(envelope.data);
    expect(result.pagination).toEqual(envelope.pagination);
  });

  it('forwards every filter, including the date range and the page limit', async () => {
    await reportsApi.getFiltered({
      status: IdeaStatus.DONE,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      submitterId: 'u1',
      assigneeId: 'u2',
      departmentId: 'd2',
      tags: ['automation', 'productivity'],
      limit: MAX_PAGE_LIMIT,
      page: 2,
    });

    const q = requestedQuery();
    expect(requestedUrl().startsWith('/reports/filtered?')).toBe(true);
    expect(q.get('status')).toBe(IdeaStatus.DONE);
    expect(q.get('startDate')).toBe('2026-01-01');
    expect(q.get('endDate')).toBe('2026-01-31');
    expect(q.get('submitterId')).toBe('u1');
    expect(q.get('assigneeId')).toBe('u2');
    expect(q.get('departmentId')).toBe('d2');
    expect(q.getAll('tags')).toEqual(['automation', 'productivity']);
    expect(q.get('limit')).toBe(String(MAX_PAGE_LIMIT));
    // The pager depends on this reaching the server; dropping it would pin
    // the report table to page 1 while the pager pretends to navigate.
    expect(q.get('page')).toBe('2');
  });

  it('serializes page 1 explicitly — 1-based paging must survive truthiness checks', async () => {
    await reportsApi.getFiltered({ page: 1, limit: MAX_PAGE_LIMIT });

    const q = requestedQuery();
    expect(q.get('page')).toBe('1');
    expect(q.get('limit')).toBe(String(MAX_PAGE_LIMIT));
  });

  it('omits the keys the caller left out instead of sending empty values', async () => {
    await reportsApi.getFiltered({ status: IdeaStatus.SUBMITTED });

    const q = requestedQuery();
    expect(q.get('status')).toBe(IdeaStatus.SUBMITTED);
    expect(q.has('startDate')).toBe(false);
    expect(q.has('endDate')).toBe(false);
    expect(q.has('limit')).toBe(false);
    expect(q.has('page')).toBe(false);
  });
});

describe('reportsApi.exportCSV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedClient.get.mockResolvedValue({ data: new Blob(['id,title'], { type: 'text/csv' }) });
  });

  it('requests the CSV format at the MAXIMUM page limit, as a blob', async () => {
    const blob = await reportsApi.exportCSV();

    const q = requestedQuery();
    expect(requestedUrl().startsWith('/reports/filtered?')).toBe(true);
    expect(q.get('format')).toBe('csv');
    // The contract nothing else pins: without this the server's default page of
    // 20 would silently truncate every export to 20 rows.
    expect(q.get('limit')).toBe('100');
    expect(q.get('limit')).toBe(String(MAX_PAGE_LIMIT));
    // A CSV body must not be parsed as JSON/text by axios.
    expect(mockedClient.get.mock.calls[0][1]).toEqual({ responseType: 'blob' });
    expect(blob).toBeInstanceOf(Blob);
  });

  it('keeps the caller filters alongside format and limit', async () => {
    await reportsApi.exportCSV({
      status: IdeaStatus.DONE,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      submitterId: 'u1',
      assigneeId: 'u2',
      departmentId: 'd2',
      tags: ['automation'],
    });

    const q = requestedQuery();
    expect(q.get('format')).toBe('csv');
    expect(q.get('limit')).toBe(String(MAX_PAGE_LIMIT));
    expect(q.get('status')).toBe(IdeaStatus.DONE);
    expect(q.get('startDate')).toBe('2026-01-01');
    expect(q.get('endDate')).toBe('2026-01-31');
    expect(q.get('submitterId')).toBe('u1');
    expect(q.get('assigneeId')).toBe('u2');
    expect(q.get('departmentId')).toBe('d2');
    expect(q.getAll('tags')).toEqual(['automation']);
  });
});
