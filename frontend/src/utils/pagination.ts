// Shared by every server-paged list view. A view lands past the last page when
// the final page's last row disappears (deleted, claimed, reviewed away) or a
// filter shrinks the result set. Returns the page to snap back to — the caller
// then refetches at that page — or null when the current page is still valid.
export function clampedPage(dataLength: number, page: number, totalPages: number): number | null {
  if (dataLength === 0 && page > 1 && totalPages < page) {
    return Math.max(1, totalPages);
  }
  return null;
}
