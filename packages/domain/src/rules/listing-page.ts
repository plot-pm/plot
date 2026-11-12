/**
 * How a host's pull-request listing pages, as the adapter knows it.
 *
 * `honours-limit` is a listing that returns up to the requested limit.
 * `fixed-page` is a listing served in pages of a fixed length, which the
 * adapter walks by `next` up to the limit; `pageLength` is that page's length
 * where the adapter has measured it for the CLI that answered, and null where
 * it has not.
 */
export type ListingPaging =
  | { readonly kind: 'honours-limit' }
  | { readonly kind: 'fixed-page'; readonly pageLength: number | null };

/**
 * What the envelope of the page where a listing stopped said about a further
 * page. `'absent'`: it named none. `'present'`: it named one, or the walk
 * trimmed rows to the limit. `'unknown'`: no envelope was read.
 */
export type EnvelopeNext = 'absent' | 'present' | 'unknown';

/** One state's page of a pull-request listing. */
export interface ListingPage {
  /** The limit the caller requested; null where it requested none. */
  readonly limit: number | null;
  /** How many rows the listing returned, after any trim to the limit. */
  readonly rows: number;
  /** How the listing pages. */
  readonly paging: ListingPaging;
  /**
   * Whether the stopping page's envelope named a further page. Defaults to
   * `'unknown'` so every existing caller keeps `paging`'s verdict unchanged.
   */
  readonly envelopeNext?: EnvelopeNext;
}

/**
 * Decides whether one state's listing may hold fewer rows than the host has.
 *
 * A listing owes no answer where no limit was requested. An empty listing
 * hides nothing unless its envelope named a further page. An envelope known to
 * carry no further page is complete regardless of row count or `paging`, for
 * any host CLI version. A listing that honours the limit is short only at the
 * limit. A fixed-page listing that stopped with a further page named, or with
 * rows trimmed, is possibly truncated; with no envelope read, it is complete
 * only below its measured page length, and an unmeasured length proves nothing.
 *
 * @param page - the requested limit, the row count, how the listing pages,
 *   and what the page's own envelope said about a further page.
 * @returns true where the page is possibly truncated.
 */
export const pagePossiblyTruncated = (page: ListingPage): boolean => {
  const next = page.envelopeNext ?? 'unknown';
  if (page.limit === null || (page.rows <= 0 && next !== 'present')) return false;
  if (next === 'absent') return false;
  if (page.paging.kind === 'honours-limit') return page.rows >= page.limit;
  if (next === 'present' || page.paging.pageLength === null) return true;
  return page.rows >= page.paging.pageLength;
};

/** One page of a fixed-page listing: its row count and what its envelope said about a further page. */
export interface ListedPage {
  readonly rows: number;
  readonly envelopeNext: EnvelopeNext;
}

/** Whether a row-limit walk stops after the pages it has read, and what it reports if it does. */
export interface WalkStep {
  /** True where the walk reads no further page. */
  readonly stops: boolean;
  /** The rows read so far, trimmed to the limit. */
  readonly rows: number;
  /** The last page's `envelopeNext`, or `'present'` where the trim drops a row. */
  readonly envelopeNext: EnvelopeNext;
}

/**
 * Decides whether a walk over a fixed-page listing stops after `pages`.
 *
 * The walk stops after the first page that names no further page, brings the
 * total to `limit` rows, adds no rows, or is page ceil(`limit` / `pageLength`).
 * A walk that has read no page stops with no rows.
 *
 * @param pages - the pages read so far, in order.
 * @param limit - the caller's row limit, at least 1.
 * @param pageLength - the page length the request asks for.
 * @returns whether the walk stops, the row count trimmed to `limit`, and the
 *   last page's `envelopeNext`, or `'present'` where the trim drops a row.
 */
export const walkStep = (pages: readonly ListedPage[], limit: number, pageLength: number): WalkStep => {
  const rows = pages.reduce((sum, page) => sum + page.rows, 0);
  const last = pages.at(-1);
  const next = last?.envelopeNext ?? 'unknown';
  const stops = last === undefined || next !== 'present' || rows >= limit || last.rows === 0
    || pages.length >= Math.ceil(limit / pageLength);
  return { stops, rows: Math.min(rows, limit), envelopeNext: rows > limit ? 'present' : next };
};

/** The rows `gh` fetches per request when it lists pull requests or issues. */
export const GH_PAGE_ROWS = 100;

/**
 * How many requests `gh pr list` or `gh issue list` made for a listing that
 * returned `rows` rows.
 *
 * `gh` pages at {@link GH_PAGE_ROWS} rows per request inside one process and
 * prints no page count, so the count derives from the rows: `ceil(rows / 100)`,
 * and 1 for an empty listing. Measured with `GH_DEBUG=api`: 250 rows made 3
 * requests and a 150-row `--search` delta made 2. The count is requests, not
 * GraphQL points; a rich page can cost more than one point.
 *
 * @param rows - the rows the listing returned. A value that is not a
 *   non-negative integer counts as 0.
 * @returns the requests the listing made; never less than 1.
 */
export const githubListingPages = (rows: number): number =>
  Number.isInteger(rows) && rows > 0 ? Math.ceil(rows / GH_PAGE_ROWS) : 1;

/**
 * The requests a `gh` listing made beyond the first, which the wrapper around
 * `gh` already records as its one request per process.
 *
 * @param rows - the rows the listing returned.
 * @returns `githubListingPages(rows) - 1`.
 */
export const githubExtraPages = (rows: number): number => githubListingPages(rows) - 1;

/**
 * Whether a branch sweep may claim every tracked branch was asked and each
 * answered: `plot-host.sh`'s `pr_sweep_report`.
 *
 * A sweep asks each branch once per state, and a branch's absence is proved
 * only where every state answered. A call that asked no branch makes no sweep
 * claim, and a state that failed withholds it.
 *
 * @param sweep.branches - how many branches the call asked; 0 for a listing that is no sweep.
 * @param sweep.statesAnswered - how many states answered in full.
 * @param sweep.statesAsked - how many states the call asked.
 * @returns true where the claim holds.
 */
export const sweepComplete = (sweep: { branches: number; statesAnswered: number; statesAsked: number }): boolean =>
  sweep.branches > 0 && sweep.statesAnswered === sweep.statesAsked;

/** What a listing claimed about each state it read: the input of {@link listingWords}. */
export interface ListingClaims {
  /** The states a page or a window claimed whole. */
  readonly claimed: ReadonlySet<string>;
  /** The states a page reported possibly truncated. */
  readonly doubted: ReadonlySet<string>;
  /** Whether the call made the sweep claim of {@link sweepComplete}. */
  readonly sweep: boolean;
}

/**
 * Folds a listing's claims into one completeness word per state.
 *
 * A state a claim names is `whole` where it is claimed and not doubted. The
 * asked state is `whole` where the sweep claim holds, or where no claim names
 * it, at least one claim names another state, and every named state is
 * `whole`. Every other state, and the asked state of a call with no claim, is
 * `possibly-truncated`.
 *
 * @param claims - what the listing claimed.
 * @param asked - the state word the call asked for.
 * @returns the word per state; the asked state is always present.
 */
export const listingWords = (claims: ListingClaims, asked: string): Record<string, 'whole' | 'possibly-truncated'> => {
  const words: Record<string, 'whole' | 'possibly-truncated'> = {};
  for (const state of [...claims.claimed, ...claims.doubted]) {
    words[state] = claims.claimed.has(state) && !claims.doubted.has(state) ? 'whole' : 'possibly-truncated';
  }
  const reported = Object.values(words);
  if (claims.sweep) words[asked] = 'whole';
  else if (words[asked] === undefined) {
    words[asked] = reported.length > 0 && reported.every((word) => word === 'whole') ? 'whole' : 'possibly-truncated';
  }
  return words;
};
