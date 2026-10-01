import { describe, expect, it } from 'vitest';

import { listingPagingFor } from '../src/adapters/host/listing-paging.js';
import { pagePossiblyTruncated, type ListingPaging } from '../src/rules/listing-page.js';

const honours: ListingPaging = { kind: 'honours-limit' };
const fifty: ListingPaging = { kind: 'fixed-page', pageLength: 50 };
const unmeasured: ListingPaging = { kind: 'fixed-page', pageLength: null };

describe('a listing page is possibly truncated', () => {
  it('owes no answer where no limit was requested', () => {
    expect(pagePossiblyTruncated({ limit: null, rows: 50, paging: fifty })).toBe(false);
    expect(pagePossiblyTruncated({ limit: null, rows: 50, paging: unmeasured })).toBe(false);
  });

  it('hides nothing on an empty page', () => {
    expect(pagePossiblyTruncated({ limit: 1000, rows: 0, paging: unmeasured })).toBe(false);
  });

  it('is short at the limit where the listing honours it', () => {
    expect(pagePossiblyTruncated({ limit: 1000, rows: 999, paging: honours })).toBe(false);
    expect(pagePossiblyTruncated({ limit: 1000, rows: 1000, paging: honours })).toBe(true);
  });

  it('is complete below a measured page length — the #1137 case', () => {
    // 20 open PRs on a page of 50: the last page.
    expect(pagePossiblyTruncated({ limit: 1000, rows: 20, paging: fifty })).toBe(false);
    expect(pagePossiblyTruncated({ limit: 1000, rows: 49, paging: fifty })).toBe(false);
  });

  it('stays possibly truncated at or above a measured page length', () => {
    expect(pagePossiblyTruncated({ limit: 1000, rows: 50, paging: fifty })).toBe(true);
    expect(pagePossiblyTruncated({ limit: 1000, rows: 100, paging: fifty })).toBe(true);
  });

  it('never calls a page complete under an unmeasured length', () => {
    expect(pagePossiblyTruncated({ limit: 1000, rows: 1, paging: unmeasured })).toBe(true);
  });
});

describe('how a listing pages, as the adapter reads it', () => {
  it('honours the limit on GitHub, whatever the CLI version', () => {
    expect(listingPagingFor('github', '')).toEqual(honours);
  });

  it('pages by 50 on Bitbucket with the measured bb', () => {
    expect(listingPagingFor('bitbucket', '1.9.0')).toEqual(fifty);
  });

  it.each([['bitbucket', '1.10.0'], ['bitbucket', ''], ['gitlab', '1.9.0']])(
    'knows no length for %s %s', (backend, version) => {
      expect(listingPagingFor(backend, version)).toEqual(unmeasured);
    },
  );
});
