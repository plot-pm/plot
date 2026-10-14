/** The one query parameter the Discovery tab's *Show archived* toggle keeps. */
export const ARCHIVED_PARAM = 'archived';

/**
 * Whether the Show archived toggle is on in a query string.
 *
 * @param search - a `location.search` value.
 * @returns true only for `archived=1`; no other parameter counts.
 */
export const archivedOn = (search: string): boolean => new URLSearchParams(search).get(ARCHIVED_PARAM) === '1';

/**
 * The address with the toggle written: `archived=1` set, or `archived` removed.
 * Every other parameter stays as it was.
 *
 * @param href - the current address.
 * @param on - the toggle's new state.
 * @returns the address to keep in the history.
 */
export const withArchived = (href: string, on: boolean): URL => {
  const url = new URL(href);
  if (on) url.searchParams.set(ARCHIVED_PARAM, '1');
  else url.searchParams.delete(ARCHIVED_PARAM);
  return url;
};

/**
 * The board request's address for a query string: `?archived=1` with the
 * toggle on, and no query otherwise. No other parameter rides it.
 *
 * @param search - a `location.search` value.
 * @returns the path and query of the board fetch.
 */
export const boardPath = (search: string): string => `/api/board${archivedOn(search) ? `?${ARCHIVED_PARAM}=1` : ''}`;
