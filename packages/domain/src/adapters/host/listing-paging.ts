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
export const listingPagingFor = (backend: string, cliVersion: string): ListingPaging => {
  if (backend === 'github') return { kind: 'honours-limit' };
  const pageLength = backend === 'bitbucket' ? BITBUCKET_PAGE_LENGTHS[cliVersion] : undefined;
  return { kind: 'fixed-page', pageLength: pageLength ?? null };
};

/**
 * Reads whether a Bitbucket listing page's own envelope named a further page.
 *
 * Mirrors `plot-host.sh`'s `bb_state_listing`: a page carrying a `values` key
 * is an envelope, and its `next` key's presence answers directly, for any
 * `bb` version — `'absent'` proves the page complete regardless of row count.
 * A response with no `values` key is not an envelope at all, so nothing can
 * be read from it and `listingPagingFor`'s version-table fallback decides.
 *
 * @param page - the raw response `bb api` returned for one state's listing.
 * @returns `'absent'`, `'present'`, or `'unknown'` where the shape is not an envelope.
 */
export const envelopeNextFor = (page: unknown): EnvelopeNext => {
  if (typeof page !== 'object' || page === null || Array.isArray(page) || !Object.hasOwn(page, 'values')) {
    return 'unknown';
  }
  return Object.hasOwn(page, 'next') ? 'present' : 'absent';
};
