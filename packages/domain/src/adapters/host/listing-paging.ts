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
 * Bitbucket stays `fixed-page` even though `plot-host.sh`'s `_bb_paged_walk`
 * now follows `next` up to a `--limit`: that walk changes how many of
 * Bitbucket's own fixed `pagelen`-row pages the shell reads before stopping,
 * not what any one page is. `pagePossiblyTruncated` still proves completeness
 * from `envelopeNext` or the measured page length, never from comparing the
 * row count against the caller's limit — the trait that makes GitHub's
 * listing `honours-limit`. See `packages/domain/corpus/listing-page.corpus.test.ts`,
 * which exercises `--limit` cases against this kind and agrees with the shell.
 */
export const listingPagingFor = (backend: string, cliVersion: string): ListingPaging => {
  if (backend === 'github') return { kind: 'honours-limit' };
  const pageLength = backend === 'bitbucket' ? BITBUCKET_PAGE_LENGTHS[cliVersion] : undefined;
  return { kind: 'fixed-page', pageLength: pageLength ?? null };
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
