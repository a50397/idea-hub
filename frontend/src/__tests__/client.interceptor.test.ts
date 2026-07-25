import { describe, it, expect, beforeEach } from 'vitest';
import client from '../api/client';

// The response interceptor is registered on the axios instance at import time.
// Grab its rejected handler and invoke it directly with fabricated errors.
const rejectedHandler = (client.interceptors.response as any).handlers[0].rejected as (
  error: any
) => Promise<never>;

describe('client response interceptor (401 handling)', () => {
  let assignedHrefs: string[];

  beforeEach(() => {
    assignedHrefs = [];
    // Replace window.location with a stub that records href assignments,
    // so the interceptor's `window.location.href = '/login'` is observable
    // without triggering a real (happy-dom) navigation.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() {
          return 'http://localhost/current';
        },
        set href(v: string) {
          assignedHrefs.push(v);
        },
      },
    });
  });

  it('exposes a rejected handler on the instance', () => {
    expect(typeof rejectedHandler).toBe('function');
  });

  it('redirects to /login on a 401 for a non-/auth/me URL', async () => {
    const error = { response: { status: 401 }, config: { url: '/ideas' } };
    await expect(rejectedHandler(error)).rejects.toBe(error);
    expect(assignedHrefs).toEqual(['/login']);
  });

  it('redirects to /login on a 401 for another protected URL', async () => {
    const error = { response: { status: 401 }, config: { url: '/users' } };
    await expect(rejectedHandler(error)).rejects.toBe(error);
    expect(assignedHrefs).toEqual(['/login']);
  });

  it('does NOT redirect on a 401 for /auth/me (router guard owns that flow)', async () => {
    const error = { response: { status: 401 }, config: { url: '/auth/me' } };
    await expect(rejectedHandler(error)).rejects.toBe(error);
    expect(assignedHrefs).toEqual([]);
  });

  it('does NOT redirect on non-401 errors', async () => {
    const error = { response: { status: 500 }, config: { url: '/ideas' } };
    await expect(rejectedHandler(error)).rejects.toBe(error);
    expect(assignedHrefs).toEqual([]);
  });

  it('does NOT redirect on a 403 forbidden error', async () => {
    const error = { response: { status: 403 }, config: { url: '/users' } };
    await expect(rejectedHandler(error)).rejects.toBe(error);
    expect(assignedHrefs).toEqual([]);
  });

  it('re-rejects network errors that have no response', async () => {
    const error = { config: { url: '/ideas' } };
    await expect(rejectedHandler(error)).rejects.toBe(error);
    expect(assignedHrefs).toEqual([]);
  });
});
