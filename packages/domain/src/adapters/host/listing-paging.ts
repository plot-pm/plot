import type { EnvelopeNext, ListingPaging } from '../../rules/listing-page.js';

/**
 * The page length of Bitbucket's plain listing, per `bb` version measured.
 *
 * The listing is `bb api …/pullrequests?state=<S>&pagelen=50`, so the length is
 * the one the request asks for, and it holds only where `bb api` passes the
 * query through unchanged. A version is listed once it is measured to:
 * on `quatico/quaweb-website`, bb 1.9.0 returned 50 merged rows in one request
 * on 2026-09-30, and on 2026-10-01 answered `pagelen: 50` with 50 rows, a
 * `next` and `size: 895`. craftamap/bb has no `--json` and never reaches this
 * listing. `plot-host.sh` holds the same table as `BB_LIST_PAGE_VERSIONS`, and
 * `corpus/listing-page.corpus.test.ts` holds the pair.
 */
export const BITBUCKET_PAGE_LENGTHS: Readonly<Record<string, number>> = {
  '1.9.0': 50,
};

/**
 * How a host's pull-request listing pages, for the CLI version that answered.
 *
 * @param backend - the git host's backend word.
 * @param cliVersion - the host CLI's version, `''` where it is not known.
 * @returns `honours-limit` for GitHub; a fixed page otherwise, whose length is
 *   null for a backend or a version nobody measured.
 */
/**
 * Bitbucket stays `fixed-page`: `plot-host.sh`'s `_bb_paged_walk` follows
 * `next` over fixed `pagelen`-row pages up to a `--limit`, and
 * `pagePossiblyTruncated` proves completeness from the stopping page's
 * envelope as `walkToLimit` reports it, never from comparing the row count
 * against the limit — the trait that makes GitHub's listing `honours-limit`.
 */
export const listingPagingFor = (backend: string, cliVersion: string): ListingPaging => {
  if (backend === 'github') return { kind: 'honours-limit' };
  const pageLength = backend === 'bitbucket' ? BITBUCKET_PAGE_LENGTHS[cliVersion] : undefined;
  return { kind: 'fixed-page', pageLength: pageLength ?? null };
};

/** The page length `plot-host.sh` asks Bitbucket's plain listing for (`BB_LIST_PAGELEN`). */
export const BITBUCKET_REQUEST_PAGELEN = 50;

/** One page of a Bitbucket listing: its row count and what its envelope said about a further page. */
export interface ListedPage {
  readonly rows: number;
  readonly envelopeNext: EnvelopeNext;
}

/**
 * Where `plot-host.sh`'s `_bb_paged_walk` stops in its row-limit mode, and what
 * it reports. `corpus/listing-page.corpus.test.ts` holds the pair.
 *
 * The walk reads `pages` in order and stops at the first page that names no
 * further page, brings the total to `limit` rows, adds no rows, or is page
 * ceil(`limit` / `pageLength`). A walk past the end of `pages` stops there.
 *
 * @param pages - the pages the host serves, in order.
 * @param limit - the caller's row limit, at least 1.
 * @param pageLength - the page length the request asks for.
 * @returns the row count printed, trimmed to `limit`, and the stopping page's
 *   `envelopeNext`, or `'present'` where the trim dropped a row.
 */
export const walkToLimit = (
  pages: readonly ListedPage[],
  limit: number,
  pageLength: number = BITBUCKET_REQUEST_PAGELEN,
): { readonly rows: number; readonly envelopeNext: EnvelopeNext } => {
  const bound = Math.ceil(limit / pageLength);
  let rows = 0;
  let last: EnvelopeNext = 'unknown';
  for (const [index, page] of pages.entries()) {
    rows += page.rows;
    last = page.envelopeNext;
    if (last !== 'present' || rows >= limit || page.rows === 0 || index + 1 >= bound) break;
  }
  return { rows: Math.min(rows, limit), envelopeNext: rows > limit ? 'present' : last };
};

/**
 * Reads whether a Bitbucket listing page's own envelope named a further page.
 *
 * Mirrors `plot-host.sh`'s `bb_state_listing`: a page carrying both a `values`
 * key and Bitbucket's own `page` marker is a real paginated envelope, and its
 * `next` key's presence answers directly, for any `bb` version — `'absent'`
 * proves the page complete regardless of row count. `page` is required
 * because a `values`-only shape with no pagination metadata at all never
 * carries `next` regardless of whether more rows exist, so its absence there
 * proves nothing; `listingPagingFor`'s version-table fallback decides instead.
 *
 * @param page - the raw response `bb api` returned for one state's listing.
 * @returns `'absent'`, `'present'`, or `'unknown'` where the shape is not a paginated envelope.
 */
export const envelopeNextFor = (page: unknown): EnvelopeNext => {
  if (
    typeof page !== 'object' ||
    page === null ||
    Array.isArray(page) ||
    !Object.hasOwn(page, 'values') ||
    !Object.hasOwn(page, 'page')
  ) {
    return 'unknown';
  }
  return Object.hasOwn(page, 'next') ? 'present' : 'absent';
};
