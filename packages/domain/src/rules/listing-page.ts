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

/** One state's page of a pull-request listing. */
export interface ListingPage {
  /** The limit the caller requested; null where it requested none. */
  readonly limit: number | null;
  /** How many rows the page returned. */
  readonly rows: number;
  /** How the listing pages. */
  readonly paging: ListingPaging;
}

/**
 * Decides whether one state's listing page may hold fewer rows than the host has.
 *
 * A page owes no answer where no limit was requested, and an empty page hides
 * nothing. A listing that honours the limit is short only at the limit. A
 * fixed page is complete only below its measured length: a page shorter than
 * the length the host pages by is the last page. An unmeasured length proves
 * nothing, so every non-empty page under it is possibly truncated.
 *
 * @param page - the requested limit, the row count, and how the listing pages.
 * @returns true where the page is possibly truncated.
 */
export const pagePossiblyTruncated = (page: ListingPage): boolean => {
  if (page.limit === null || page.rows <= 0) return false;
  if (page.paging.kind === 'honours-limit') return page.rows >= page.limit;
  if (page.paging.pageLength === null) return true;
  return page.rows >= page.paging.pageLength;
};
