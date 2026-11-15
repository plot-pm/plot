import { afterEach, describe, expect, it } from 'vitest';

import { bitbucketPrListing } from '../src/adapters/host/bitbucket-pr-listing.js';
import { emptySnapshot, PrIndexRowSchema } from '../src/index.js';
import type { PortResult } from '../src/port-result.js';
import type { PrListing } from '../src/ports/host.js';
import { recordReading } from '../src/rules/snapshot-record.js';
import {
  bitbucketReplayClient,
  startBitbucketReplay,
  type BitbucketReplay,
} from './fixtures/bitbucket-replay.js';

const SHA = (c: string): string => c.repeat(40);
const BASE_SHA = SHA('b');

/** One pull request as Bitbucket exports it; `over` replaces top-level keys. */
const pr = (id: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  title: `Change ${id}`,
  state: 'OPEN',
  draft: false,
  updated_on: '2026-10-01T00:00:00.123456+00:00',
  links: { html: { href: `https://bitbucket.org/ws/repo/pull-requests/${id}` } },
  author: { nickname: 'dev' },
  source: { branch: { name: `feature/c-${id}` }, commit: { hash: SHA('a') } },
  destination: { branch: { name: 'main' } },
  ...over,
});

const page = (values: unknown[], over: Record<string, unknown> = {}): { status: number; body: unknown } => ({
  status: 200,
  body: { pagelen: 50, page: 1, size: values.length, values, ...over },
});

interface FakeRefs {
  readonly resolved: string[];
  readonly merges: string[];
  readonly refs: {
    resolve(ref: string): Promise<PortResult<string>>;
    conflictPaths(base: string, branch: string): Promise<PortResult<readonly string[]>>;
  };
}

/** A clone whose `origin/main` is `BASE_SHA` and whose merges conflict on `conflicts` paths. */
const fakeRefs = (conflicts: readonly string[] = []): FakeRefs => {
  const resolved: string[] = [];
  const merges: string[] = [];
  return {
    resolved,
    merges,
    refs: {
      resolve: async (ref) => {
        resolved.push(ref);
        return { ok: true, value: ref.startsWith('origin/') ? BASE_SHA : ref.slice(0, 40) };
      },
      conflictPaths: async (base, branch) => {
        merges.push(`${base}..${branch}`);
        return { ok: true, value: conflicts };
      },
    },
  };
};

let replay: BitbucketReplay | null = null;
let cleanups: (() => void)[] = [];

afterEach(async () => {
  await replay?.close();
  replay = null;
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

/** Serves `answers` in order, whatever the path, and returns a listing over them. */
const serve = async (answers: { status: number; body: unknown }[] | ((base: string) => { status: number; body: unknown }[]), refs = fakeRefs()) => {
  const exchanges: never[] = [];
  let given: { status: number; body: unknown }[] = [];
  replay = await startBitbucketReplay(exchanges, (_path, index) => given[index] ?? { status: 500, body: { error: 'unexpected request' } });
  given = typeof answers === 'function' ? answers(replay.base) : answers;
  const { api, cleanup } = bitbucketReplayClient(replay.base);
  cleanups.push(cleanup);
  return { listing: bitbucketPrListing(api, refs.refs), refs, sent: replay.sent, base: replay.base };
};

describe('a refusal in the middle of a walk', () => {
  it('is never whole: rows read so far come back partial with every state possibly-truncated', async () => {
    const first = Array.from({ length: 50 }, (_, i) => pr(i + 1));
    const { listing } = await serve((base) => [
      page(first, { next: `${base}/repositories/ws/repo/pullrequests?state=MERGED&pagelen=50&page=2` }),
      { status: 500, body: { error: 'boom' } },
    ]);
    const read: PrListing = await listing.prListing({ state: 'merged', limit: 200 });
    expect(read.answer).toBe('partial');
    expect(read.rows).toHaveLength(50);
    expect(read.complete).toEqual({ merged: 'possibly-truncated' });
    expect(read.refusal?.kind).toBe('failed');
  });

  it('stops every later state of the call', async () => {
    const { listing, sent } = await serve([{ status: 500, body: {} }]);
    const read = await listing.prListing({ state: 'all', limit: 100 });
    expect(read.answer).toBe('failed');
    expect(read.rows).toEqual([]);
    expect(Object.values(read.complete).every((word) => word === 'possibly-truncated')).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

describe('a next link', () => {
  it('outside the base URL is refused and never requested', async () => {
    const { listing, sent } = await serve([page([pr(1)], { next: 'https://evil.example/2.0/repositories/ws/repo/pullrequests?page=2' })]);
    const read = await listing.prListing({ state: 'merged', limit: 100 });
    expect(read.answer).toBe('partial');
    expect(read.refusal).not.toBeNull();
    expect(read.complete).toEqual({ merged: 'possibly-truncated' });
    expect(sent).toHaveLength(1);
  });
});

describe('a window read', () => {
  it('that comes back short of its reported size is refused rather than claimed whole', async () => {
    const { listing } = await serve([page([pr(1), pr(2)], { size: 5 })]);
    const read = await listing.prListing({ state: 'merged', since: '2026-10-01T00:00:00Z' });
    expect(read.refusal).not.toBeNull();
    expect(read.complete.merged).toBe('possibly-truncated');
  });

  it('that comes back at its reported size is whole', async () => {
    const { listing } = await serve([page([pr(2, { state: 'MERGED' }), pr(1, { state: 'MERGED' })], { size: 2 })]);
    const read = await listing.prListing({ state: 'merged', since: '2026-10-01T00:00:00Z' });
    expect(read.answer).toBe('answered');
    expect(read.complete.merged).toBe('whole');
    expect(read.rows.map((r) => r.number)).toEqual([1, 2]);
  });
});

describe('the mergeability of an open row', () => {
  it('runs one merge-tree for a head and base it has already read', async () => {
    const refs = fakeRefs();
    const row = pr(7);
    const { listing } = await serve([page([row]), page([row])], refs);
    const first = await listing.prListing({ state: 'open', rich: true });
    expect(first.rows[0]?.mergeable).toBe('mergeable');
    const headProbes = refs.resolved.filter((ref) => ref.endsWith('^{commit}')).length;
    expect(refs.merges).toHaveLength(1);
    const second = await listing.prListing({ state: 'open', rich: true });
    expect(second.rows[0]?.mergeable).toBe('mergeable');
    expect(refs.merges).toHaveLength(1);
    expect(refs.resolved.filter((ref) => ref.endsWith('^{commit}'))).toHaveLength(headProbes);
  });

  it('runs a new merge-tree when the base moved', async () => {
    let baseSha = SHA('b');
    const refs = fakeRefs();
    const moving = { ...refs.refs, resolve: async (ref: string) => (ref.startsWith('origin/') ? { ok: true as const, value: baseSha } : refs.refs.resolve(ref)) };
    const { listing } = await serve([page([pr(7)]), page([pr(7)])], { ...refs, refs: moving });
    await listing.prListing({ state: 'open', rich: true });
    baseSha = SHA('c');
    await listing.prListing({ state: 'open', rich: true });
    expect(refs.merges).toHaveLength(2);
  });

  it('reads conflicting where the merge names conflicting paths', async () => {
    const { listing } = await serve([page([pr(7)])], fakeRefs(['a.txt']));
    const read = await listing.prListing({ state: 'open', rich: true });
    expect(read.rows[0]?.mergeable).toBe('conflicting');
  });

  it('reads unknown, and caches nothing, where the base cannot be resolved', async () => {
    const merges: string[] = [];
    const refs = {
      resolve: async () => ({ ok: false as const, why: 'failed' as const }),
      conflictPaths: async (base: string, branch: string) => {
        merges.push(`${base}..${branch}`);
        return { ok: true as const, value: [] as readonly string[] };
      },
    };
    const { listing } = await serve([page([pr(7)])], { resolved: [], merges, refs });
    const read = await listing.prListing({ state: 'open', rich: true });
    expect(read.rows[0]?.mergeable).toBe('unknown');
    expect(merges).toEqual([]);
  });
});

describe('the index row', () => {
  /** The rich rows one read of `prs` returns, narrowed to the keys the store's row schema names and parsed by it. */
  const rowsOf = async (prs: Record<string, unknown>[], refs = fakeRefs()) => {
    const { listing } = await serve([page(prs)], refs);
    const read = await listing.prListing({ state: 'all', rich: true, limit: 50 });
    const known = new Set(Object.keys(PrIndexRowSchema.shape));
    return read.rows.map((row) => PrIndexRowSchema.parse(Object.fromEntries(Object.entries(row).filter(([key]) => known.has(key)))));
  };

  const recorded = (rows: unknown[]) => recordReading(emptySnapshot(), 'prs', { state: 'read', readAt: 1, value: rows as never }).snapshot;
  const changedBy = (before: unknown[], after: unknown[]) => recordReading(recorded(before), 'prs', { state: 'read', readAt: 2, value: after as never }).changed;

  const cases: [string, Record<string, unknown>, Record<string, unknown>?][] = [
    ['number', { id: 8 }],
    ['head', { source: { branch: { name: 'feature/other' }, commit: { hash: SHA('a') } } }],
    ['state', { state: 'DECLINED' }],
    ['draft', { draft: true }],
    ['url', { links: { html: { href: 'https://bitbucket.org/ws/repo/pull-requests/other' } } }],
    ['author', { author: { nickname: 'someone-else' } }],
    ['updatedAt', { updated_on: '2026-10-02T00:00:00.123456+00:00' }],
    ['headSha', { source: { branch: { name: 'feature/c-7' }, commit: { hash: SHA('d') } } }],
    ['mergedAt', { state: 'MERGED' }],
  ];

  for (const [field, over] of cases) {
    it(`reports a change to ${field} alone as changed: ['prs']`, async () => {
      const before = await rowsOf([pr(7)]);
      const after = await rowsOf([pr(7, over)]);
      const moved = Object.keys(after[0] ?? {}).filter((key) => JSON.stringify((after[0] as Record<string, unknown>)[key]) !== JSON.stringify((before[0] as Record<string, unknown>)[key]));
      expect(moved, field).toContain(field);
      expect(changedBy(before, after)).toEqual(['prs']);
    });
  }

  it("reports a change to mergeable alone as changed: ['prs']", async () => {
    const before = await rowsOf([pr(7)], fakeRefs());
    const after = await rowsOf([pr(7)], fakeRefs(['a.txt']));
    const moved = Object.keys(after[0] ?? {}).filter((key) => JSON.stringify((after[0] as Record<string, unknown>)[key]) !== JSON.stringify((before[0] as Record<string, unknown>)[key]));
    expect(moved).toEqual(['mergeable']);
    expect(changedBy(before, after)).toEqual(['prs']);
  });

  it('reports no change for the same read twice', async () => {
    const before = await rowsOf([pr(7)]);
    const after = await rowsOf([pr(7)]);
    expect(changedBy(before, after)).toEqual([]);
  });

  it('sets the standing answers Bitbucket gives for what it cannot say', async () => {
    const [row] = await rowsOf([pr(7, { state: 'MERGED' })]);
    expect([row?.checks, row?.review, row?.failing_checks]).toEqual(['unknown', '', []]);
  });
});
