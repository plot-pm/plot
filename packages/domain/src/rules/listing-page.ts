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
