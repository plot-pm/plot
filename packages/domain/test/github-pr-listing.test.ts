import { afterEach, describe, expect, it } from 'vitest';

import { exportedPullRequest, githubPrListing } from '../src/adapters/host/github-pr-listing.js';
import { githubApi } from '../src/adapters/host/github-api.js';
import type { PrListing, PrListingQuery } from '../src/ports/host.js';
import { refusalKind } from '../src/rules/refusal.js';
import { foldScanListing, scanListingRowsOf, type ScanListingAnswer } from '../src/rules/scan-listing.js';
import { readListingFixtures, replayClient, startGithubReplay, type GithubReplay, type ReplayOverride } from './fixtures/github-replay.js';

const fixtures = new Map(readListingFixtures().map((f) => [f.name, f]));
const open: { replay: GithubReplay; cleanup: () => void }[] = [];

afterEach(async () => {
  for (const one of open.splice(0)) {
    await one.replay.close();
    one.cleanup();
  }
});

/** A listing over a stub that answers the named fixture's exchanges, or the override first. */
const listingOver = async (name: string | null, override?: ReplayOverride) => {
  const replay = await startGithubReplay(name === null ? [] : (fixtures.get(name)?.exchanges ?? []), override);
  const { api, cleanup } = replayClient(replay.url);
  open.push({ replay, cleanup });
  return { listing: githubPrListing(api), replay };
};

/** A merged pull request node as the plain fragment answers it. */
const node = (n: number) => ({
  number: n, title: `t${n}`, state: 'MERGED', headRefName: `b${n}`, isDraft: false, url: `u${n}`,
  updatedAt: '2026-11-01T00:00:00Z', author: { login: 'dev', id: 'U', name: 'Dev' }, headRefOid: 'abc', mergedAt: '2026-11-01T00:00:00Z',
});

/** One page of the repository listing. */
const page = (from: number, count: number, hasNextPage: boolean) => ({
  status: 200,
  body: { data: { repository: { pullRequests: { totalCount: 500, nodes: Array.from({ length: count }, (_, i) => node(from - i)), pageInfo: { hasNextPage, endCursor: `c${from}` } } } } },
});

const SECONDARY = 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.';

/** The scan's reading of one listing, as `fleet-scan.ts`'s `askPrListing` reads it. */
const scanAnswer = (listing: PrListing, query: PrListingQuery): ScanListingAnswer => {
  if (listing.answer === 'failed' || listing.answer === 'unaskable') return { verdict: 'failed', rows: [], complete: 'possibly-truncated' };
  return { verdict: listing.answer === 'partial' ? 'partial' : 'ok', rows: scanListingRowsOf(listing.rows) ?? [], complete: listing.complete[query.state] ?? 'possibly-truncated' };
};

describe('a truncated page is never whole', () => {
  it('a page that returns exactly limit rows answers possibly-truncated, and foldScanListing refuses it', async () => {
    const query = fixtures.get('open-rich-at-limit')?.query as PrListingQuery;
    const { listing } = await listingOver('open-rich-at-limit');
    const answered = await listing.prListing(query);
    expect(answered.rows).toHaveLength(5);
    expect(answered.complete).toEqual({ open: 'possibly-truncated' });
    const rest = scanAnswer(await (await listingOver('open-rich-empty')).listing.prListing({ state: 'open', limit: 50, rich: true }), query);
    expect(foldScanListing(null, scanAnswer(answered, query), rest)).toEqual({ ok: false, refusal: 'no-whole-page-claim' });
  });

  it('a listing asked with no limit claims nothing', async () => {
    const { listing } = await listingOver('open-rich-no-limit');
    expect((await listing.prListing({ state: 'open', rich: true })).complete).toEqual({ open: 'possibly-truncated' });
  });
});

describe('a walk refused mid-way is never whole', () => {
  it('page 2 of 5 fails: the answer holds the rows of page 1, possibly-truncated, and the refusal with GitHub\'s message', async () => {
    const { listing, replay } = await listingOver(null, (_body, index) =>
      index === 0 ? page(900, 100, true) : { status: 403, body: { message: SECONDARY }, headers: { 'Retry-After': '60' } },
    );
    const answered = await listing.prListing({ state: 'merged', limit: 500 });
    expect(replay.sent).toHaveLength(2);
    expect(answered.answer).toBe('partial');
    expect(answered.rows).toHaveLength(100);
    expect(answered.rows[0]).toMatchObject({ number: 900, state: 'MERGED' });
    expect(answered.complete).toEqual({ merged: 'possibly-truncated' });
    expect(answered.refusal).toEqual({ kind: 'secondary', said: SECONDARY, waitMs: 60_000 });
    expect(listing.lastRefusal()).toEqual(answered.refusal);
    expect(refusalKind(listing.lastRefusal()?.said ?? '')).toBe('secondary');
  });

  it('a walk refused on its first page answers failed with no rows', async () => {
    const { listing } = await listingOver(null, () => ({ status: 502, body: { message: 'Bad gateway' } }));
    const answered = await listing.prListing({ state: 'open', limit: 10 });
    expect(answered).toEqual({ answer: 'failed', rows: [], complete: { open: 'possibly-truncated' }, refusal: { kind: 'failed', said: 'HTTP 502: Bad gateway (graphql, page 1)' } });
  });

  it('a GraphQL error is a refusal with the messages as gh prints them', async () => {
    const { listing } = await listingOver(null, () => ({ status: 200, body: { data: { repository: null }, errors: [{ message: 'Could not resolve to a Repository' }] } }));
    expect((await listing.prListing({ state: 'open', limit: 10 })).refusal).toEqual({ kind: 'failed', said: 'GraphQL: Could not resolve to a Repository' });
  });

  it('a rich-open listing whose second half fails keeps the open rows and names both states', async () => {
    const recorded = fixtures.get('all-rich-open');
    const { listing } = await listingOver('all-rich-open', (_body, index) => (index === 0 ? null : { status: 502, body: { message: 'Bad gateway' } }));
    const answered = await listing.prListing(recorded?.query as PrListingQuery);
    expect(answered.answer).toBe('partial');
    expect(answered.rows.every((row) => row.state === 'OPEN')).toBe(true);
    expect(answered.complete).toEqual({ open: 'whole', all: 'possibly-truncated' });
  });

  it('a rich-open listing whose open half fails on page 1 answers failed', async () => {
    const { listing } = await listingOver(null, () => ({ status: 502, body: { message: 'Bad gateway' } }));
    const answered = await listing.prListing({ state: 'all', limit: 10, richOpen: true });
    expect(answered.answer).toBe('failed');
    expect(answered.complete).toEqual({ open: 'possibly-truncated', all: 'possibly-truncated' });
  });

  it('a failed search-type question fails the search and is asked again on the next call', async () => {
    const recorded = fixtures.get('since-merged');
    const { listing, replay } = await listingOver('since-merged', (_body, index) => (index === 0 ? { status: 502, body: { message: 'Bad gateway' } } : null));
    expect((await listing.prListing(recorded?.query as PrListingQuery)).answer).toBe('failed');
    expect((await listing.prListing(recorded?.query as PrListingQuery)).answer).toBe('answered');
    expect(replay.sent.filter((b) => JSON.stringify(b).includes('SearchType_enumValues'))).toHaveLength(2);
    expect((await listing.prListing(recorded?.query as PrListingQuery)).answer).toBe('answered');
    expect(replay.sent.filter((b) => JSON.stringify(b).includes('SearchType_enumValues'))).toHaveLength(2);
  });

  it('a search-type answer with a GraphQL error fails the search', async () => {
    const { listing } = await listingOver(null, () => ({ status: 200, body: { errors: [{ message: 'nope' }] } }));
    expect((await listing.prListing({ state: 'merged', limit: 5, since: '2026-11-01T00:00:00Z' })).refusal).toEqual({ kind: 'failed', said: 'GraphQL: nope' });
  });

  it('searches with ISSUE where the host offers no ISSUE_ADVANCED', async () => {
    const { listing, replay } = await listingOver(null, (_body, index) =>
      index === 0
        ? { status: 200, body: { data: { SearchType: { enumValues: [{ name: 'ISSUE' }] } } } }
        : { status: 200, body: { data: { search: { issueCount: 0, nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } },
    );
    await listing.prListing({ state: 'merged', limit: 5, since: '2026-11-01T00:00:00Z' });
    expect((replay.sent[1] as { variables: { type: string } }).variables.type).toBe('ISSUE');
  });
});

describe('an absent carried OPEN row still refuses the fold', () => {
  it('a carried OPEN row absent from both in-process answers refuses as open-row-vanished', async () => {
    const recorded = fixtures.get('since-all-rich-open');
    const query = recorded?.query as PrListingQuery;
    const answered = await (await listingOver('since-all-rich-open')).listing.prListing(query);
    const openRows = answered.rows.filter((row) => row.state === 'OPEN');
    const openAnswer = { verdict: 'ok' as const, rows: scanListingRowsOf(openRows) ?? [], complete: answered.complete.open };
    const restAnswer = { verdict: 'ok' as const, rows: scanListingRowsOf(answered.rows.filter((row) => row.state !== 'OPEN')) ?? [], complete: answered.complete.all };
    const carried = { rows: [{ head: 'feature/gone', state: 'OPEN', updatedAt: '2026-10-20T00:00:00Z' }], complete: true, fullReadAt: 0 };
    expect(foldScanListing(carried, openAnswer, restAnswer)).toEqual({ ok: false, refusal: 'open-row-vanished' });
    const kept = { ...carried, rows: [{ ...carried.rows[0], head: String(openRows[0]?.head) }] };
    expect(foldScanListing(kept, openAnswer, restAnswer).ok).toBe(true);
  });
});

describe('githubPrListing outside the recorded answers', () => {
  it('answers failed where the origin names no repository', async () => {
    const api = githubApi({ origin: null, env: { GH_TOKEN: 'fixture', GITHUB_API_URL: 'http://127.0.0.1:9' } });
    const answered = await githubPrListing(api).prListing({ state: 'open' });
    expect(answered).toEqual({ answer: 'failed', rows: [], complete: { open: 'possibly-truncated' }, refusal: { kind: 'failed', said: 'the origin remote names no GitHub owner/repo' } });
  });

  it('exports an author with no user id as gh does, app/<login>', () => {
    expect(exportedPullRequest({ number: 1, author: null }).author).toEqual({ is_bot: true, login: 'app/' });
    expect(exportedPullRequest({ number: 1, author: { login: 'renovate' } }).author).toEqual({ is_bot: true, login: 'app/renovate' });
  });
});
