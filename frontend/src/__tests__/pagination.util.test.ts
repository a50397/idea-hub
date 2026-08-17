import { describe, it, expect } from 'vitest';
import { clampedPage } from '../utils/pagination';
import { MAX_PAGE_LIMIT } from '../types';

// The snap-back rule every server-paged list view shares. The page-level
// integration of the refetch loop is covered in ApprovedIdeasPage.test.ts.
describe('clampedPage', () => {
  it('returns null while the current page still has rows', () => {
    expect(clampedPage(MAX_PAGE_LIMIT, 2, 3)).toBeNull();
    expect(clampedPage(1, 3, 3)).toBeNull();
  });

  it('returns null for an empty first page — nothing to snap to', () => {
    expect(clampedPage(0, 1, 0)).toBeNull();
    expect(clampedPage(0, 1, 1)).toBeNull();
  });

  it('returns null when the page is empty but still in range', () => {
    // The server claims this page exists; an empty payload then is not an
    // out-of-range condition — no snap, so no refetch loop.
    expect(clampedPage(0, 2, 2)).toBeNull();
  });

  it('snaps to the last remaining page when the current one vanished', () => {
    expect(clampedPage(0, 3, 2)).toBe(2);
    expect(clampedPage(0, 5, 1)).toBe(1);
  });

  it('snaps to page 1 when the result set emptied entirely', () => {
    expect(clampedPage(0, 4, 0)).toBe(1);
  });

  it('terminates: the corrected page is always in range on the next pass', () => {
    const next = clampedPage(0, 7, 3);
    expect(next).toBe(3);
    expect(clampedPage(0, next!, 3)).toBeNull();
  });
});
