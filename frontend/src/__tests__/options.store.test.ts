import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useOptionsStore } from '../stores/options';

// Replace the real network layer; the store must never hit axios.
vi.mock('../api/options', () => ({
  optionsApi: {
    get: vi.fn(),
  },
}));

import { optionsApi } from '../api/options';
const mockedApi = vi.mocked(optionsApi);

describe('options store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('defaults both flags to false before any fetch', () => {
    const store = useOptionsStore();
    expect(store.mailEnabled).toBe(false);
    expect(store.ssoShowLogout).toBe(false);
  });

  it('reflects both flags from the API on a successful fetch', async () => {
    mockedApi.get.mockResolvedValueOnce({ mailEnabled: true, ssoShowLogout: true });
    const store = useOptionsStore();

    await store.fetch();

    expect(mockedApi.get).toHaveBeenCalledTimes(1);
    expect(store.mailEnabled).toBe(true);
    expect(store.ssoShowLogout).toBe(true);
  });

  it('applies each flag independently', async () => {
    mockedApi.get.mockResolvedValueOnce({ mailEnabled: true, ssoShowLogout: false });
    const store = useOptionsStore();

    await store.fetch();

    expect(store.mailEnabled).toBe(true);
    expect(store.ssoShowLogout).toBe(false);
  });

  it('silently degrades every flag to false when the fetch fails', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('network down'));
    const store = useOptionsStore();

    await store.fetch();

    // Fail-safe: nothing gated on the flags is exposed, and no error is thrown.
    expect(store.mailEnabled).toBe(false);
    expect(store.ssoShowLogout).toBe(false);
  });

  it('shares a single in-flight request across overlapping fetch() calls', async () => {
    let resolveGet!: (value: { mailEnabled: boolean; ssoShowLogout: boolean }) => void;
    mockedApi.get.mockImplementationOnce(
      () => new Promise((resolve) => (resolveGet = resolve))
    );
    const store = useOptionsStore();

    const first = store.fetch();
    const second = store.fetch();

    // Overlapping calls must not fire a second network request (a late-failing
    // duplicate would reset flags a concurrent successful read just set).
    expect(mockedApi.get).toHaveBeenCalledTimes(1);

    resolveGet({ mailEnabled: true, ssoShowLogout: true });
    await Promise.all([first, second]);

    expect(store.mailEnabled).toBe(true);
    expect(store.ssoShowLogout).toBe(true);
  });

  it('resets previously-true flags to false when a later fetch fails', async () => {
    const store = useOptionsStore();

    mockedApi.get.mockResolvedValueOnce({ mailEnabled: true, ssoShowLogout: true });
    await store.fetch();
    expect(store.mailEnabled).toBe(true);

    mockedApi.get.mockRejectedValueOnce(new Error('boom'));
    await store.fetch();

    expect(store.mailEnabled).toBe(false);
    expect(store.ssoShowLogout).toBe(false);
  });
});
