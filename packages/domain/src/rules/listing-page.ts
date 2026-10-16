/**
 * How a host's pull-request listing pages, as the adapter knows it.
 *
 * `honours-limit` is a listing that returns up to the requested limit.
 * `fixed-page` is a listing that ignores the limit and returns one page;
 * `pageLength` is that page's length where the adapter has measured it for
 * the CLI that answered, and null where it has not.
 */
export type ListingPaging =
  | { readonly kind: 'honours-limit' }
  | { readonly kind: 'fixed-page'; readonly pageLength: number | null };

/**
 * Whether a page's own envelope answered completeness, independent of
 * `paging.kind` or row count — `false` only when the envelope is known to
 * have carried no further page. `true` means it named one, or that reading it
 * was not possible; either way this field is silent and `paging` decides.
 */
export type EnvelopeNext = 'absent' | 'present' | 'unknown';

/** One state's page of a pull-request listing. */
export interface ListingPage {
  /** The limit the caller requested; null where it requested none. */
  readonly limit: number | null;
  /** How many rows the page returned. */
  readonly rows: number;
  /** How the listing pages. */
  readonly paging: ListingPaging;
  /**
   * Whether this page's own envelope named a further page. Defaults to
   * `'unknown'` so every existing caller keeps `paging`'s verdict unchanged.
   */
  readonly envelopeNext?: EnvelopeNext;
}

/**
 * Decides whether one state's listing page may hold fewer rows than the host has.
 *
 * A page owes no answer where no limit was requested, and an empty page hides
 * nothing. An envelope that is known to carry no further page is complete
 * regardless of row count or `paging` — this is the strongest proof available
 * and supersedes the tests below it, for any host CLI version. A page whose
 * envelope named a further page, or whose envelope is unread, falls through:
 * a listing that honours the limit is short only at the limit; a fixed page
 * is complete only below its measured length, and an unmeasured length proves
 * nothing, so every non-empty page under it is possibly truncated.
 *
 * @param page - the requested limit, the row count, how the listing pages,
 *   and what the page's own envelope said about a further page.
 * @returns true where the page is possibly truncated.
 */
export const pagePossiblyTruncated = (page: ListingPage): boolean => {
  if (page.limit === null || page.rows <= 0) return false;
  if ((page.envelopeNext ?? 'unknown') === 'absent') return false;
  if (page.paging.kind === 'honours-limit') return page.rows >= page.limit;
  if (page.paging.pageLength === null) return true;
  return page.rows >= page.paging.pageLength;
};
