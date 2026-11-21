import { describe, expect, it } from 'vitest';

import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { HostAnswer, Scripts } from '@plot-pm/domain/ports/scripts';
import type { PrListing, PrListingQuery } from '@plot-pm/domain/ports/host';
import type { Refs } from '@plot-pm/domain/ports/refs';

import { emptyWalk, withWalkRefs } from './walk-fake.js';
import { saidListingWorld } from './listing-over-said.js';
import { freshScanState, scanOnce, scanPrListLimit, type ScanOptions, type ScanWorld } from '../../src/shared/fleet-scan.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: `readBitbucketListing`
 * (`docs/plans/2026-10-28-a-bitbucket-scan-reads-a-delta.md`) reads a delta
 * where the host can prove one whole, and falls back to a full read where it
 * cannot — same as `readGithubListing` already does for GitHub. A full read
 * asks two unbranched listings with the scan's `--limit` and keeps the rows of
 * the tracked branches.
 *
 * `fleet-scan-backoff.test.ts` covers the back-off these refusals feed; this
 * file covers the fold itself: what the delta's two calls look like, and the
 * two ways a delta's "whole page" claim can fail.
 */

const READING: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [],
  summary: {
    plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0,
    waiting: 0, prereq_missing: 0, host: 'unknown' as const,
  },
};

const ok = <T>(value: T) => ({ ok: true as const, value });

const refsFakeWith = (branches: readonly string[]): Refs =>
  withWalkRefs({
    branchDates: async () => ok([]),
    branchTips: async () => ok([]),
    listBlobs: async () => ok([]),
    listBranches: async () => ok(branches),
    remoteUrl: async () => ok(''),
  } as unknown as Partial<Refs>);

const OPEN_ROW = (head: string, updatedAt: string) =>
  `${JSON.stringify({ head, state: 'OPEN', updatedAt })}\n`;

const cleanStream: Scripts['stream'] = async (_s, _a, onLine) => {
  onLine(JSON.stringify({ kind: 'reading', reading: READING }));
};

/** A full read's answer for one state: one whole page holding `stdout`'s rows. */
const wholePageAnswer = (state: string, stdout = ''): HostAnswer => ({
  answer: 'answered',
  stdout,
  stderr: `plot-host: bitbucket pr-list state=${state} page complete (0 rows below requested limit ${scanPrListLimit()}) — this page holds every pull request the host has in this state`,
});

const LIMIT = String(scanPrListLimit());

const worldOf = (branches: readonly string[], stream: Scripts['stream'], hostSaid: Scripts['hostSaid']): ScanWorld => saidListingWorld({
  repoRoot: '/repo',
  scripts: {
    stream,
    hostSaid,
    config: async () => ok('docs/plans/'),
    planMeta: async () => ok(''),
  } as unknown as Scripts,
  refs: refsFakeWith(branches),
  backend: async () => 'bitbucket',
  walk: emptyWalk(),
});

const OPTIONS: ScanOptions = { record: false };

describe('readBitbucketListing via scanOnce: a delta the host can prove whole', () => {
  it('asks the unbranched open call with the scan limit and a windowed --since rest call', async () => {
    const state = freshScanState();
    // Seed a prior complete listing recent enough, and with a watermark, that
    // scanListingWindowFor offers a delta rather than a full read.
    state.listingHeld = {
      rows: [{ head: 'feature_a', state: 'OPEN', updatedAt: '2026-10-01T00:00:00Z' }],
      complete: true,
      fullReadAt: Date.now() - 1000,
    };
    state.listing = '.branches\t1\t-\t-\nfeature_a\tOPEN\tgreen\tfalse\n.list-arrived\t1\t-\t-\n';
    state.listingAt = Date.now() - (300_000 + 1);

    const seenArgs: string[][] = [];
    const hostSaid: Scripts['hostSaid'] = async (args) => {
      seenArgs.push([...args]);
      const state_ = args[args.indexOf('--state') + 1];
      if (state_ === 'open') {
        return {
          answer: 'answered',
          stdout: OPEN_ROW('feature_a', '2026-10-01T00:00:00Z'),
          stderr: 'plot-host: bitbucket pr-list state=open page complete (1 rows below requested limit 3000) — this page holds every pull request the host has in this state',
        };
      }
      return {
        answer: 'answered',
        stdout: '',
        stderr: 'plot-host: bitbucket pr-list state=all window complete (0 rows) — this window holds every pull request the host has in this state since the stamp',
      };
    };

    await scanOnce(worldOf(['feature_a'], cleanStream, hostSaid), state, OPTIONS);

    const openCall = seenArgs.find((call) => call.includes('open'));
    expect(openCall).toBeDefined();
    expect(openCall).toContain('--limit');
    expect(openCall?.[openCall.indexOf('--limit') + 1]).toBe(LIMIT);
    expect(openCall).not.toContain('--branch');

    const restCall = seenArgs.find((call) => call.includes('all'));
    expect(restCall).toBeDefined();
    expect(restCall).toContain('--since');
    expect(restCall).not.toContain('--branch');

    // A delta that folds cleanly costs 2 pr-list calls, not a sweep over every
    // branch — plus the one spend-rate call scanOnce always makes first.
    expect(seenArgs.length).toBe(3);
    expect(state.listing).not.toBe('');
  });
});

describe('readBitbucketListing via scanOnce: a delta the host cannot prove whole falls back to a full read', () => {
  it('folds a delta whose open walk reads 50 or more rows and reaches the last page', async () => {
    const state = freshScanState();
    state.listingHeld = {
      rows: [{ head: 'feature_a', state: 'OPEN', updatedAt: '2026-10-01T00:00:00Z' }],
      complete: true,
      fullReadAt: Date.now() - 1000,
    };
    state.listing = '.branches\t1\t-\t-\nfeature_a\tOPEN\tgreen\tfalse\n.list-arrived\t1\t-\t-\n';
    state.listingAt = Date.now() - (300_000 + 1);

    const seenArgs: string[][] = [];
    const hostSaid: Scripts['hostSaid'] = async (args) => {
      seenArgs.push([...args]);
      if (args.includes('open')) {
        const rows = [OPEN_ROW('feature_a', '2026-10-01T00:00:00Z'), ...Array.from({ length: 59 }, (_, i) => OPEN_ROW(`feature_${i}`, '2026-10-01T00:00:00Z'))].join('');
        return wholePageAnswer('open', rows);
      }
      return { answer: 'answered', stdout: '', stderr: 'plot-host: bitbucket pr-list state=all window complete (0 rows) — this window holds every pull request the host has in this state since the stamp' };
    };

    await scanOnce(worldOf(['feature_a'], cleanStream, hostSaid), state, OPTIONS);

    // One spend-rate call and the delta's two pr-list calls: no full read.
    expect(seenArgs.length).toBe(3);
    expect(state.listingWalked).toEqual({ all: null, open: 60 });
  });

  it('falls back to a full read when the open walk makes no whole-page claim', async () => {
    const state = freshScanState();
    state.listingHeld = {
      rows: [{ head: 'feature_a', state: 'OPEN', updatedAt: '2026-10-01T00:00:00Z' }],
      complete: true,
      fullReadAt: Date.now() - 1000,
    };
    state.listing = '.branches\t1\t-\t-\nfeature_a\tOPEN\tgreen\tfalse\n.list-arrived\t1\t-\t-\n';
    state.listingAt = Date.now() - (300_000 + 1);

    const seenArgs: string[][] = [];
    let openCalls = 0;
    const hostSaid: Scripts['hostSaid'] = async (args) => {
      seenArgs.push([...args]);
      // The delta's open walk stopped at its limit with a further page, so it
      // prints no whole-page claim.
      if (args.includes('open') && openCalls++ === 0) {
        return { answer: 'answered', stdout: OPEN_ROW('feature_a', '2026-10-01T00:00:00Z'), stderr: '' };
      }
      if (args.includes('all') && args.includes('--since')) {
        return { answer: 'answered', stdout: '', stderr: 'plot-host: bitbucket pr-list state=all window complete (0 rows) — this window holds every pull request the host has in this state since the stamp' };
      }
      return wholePageAnswer(args[args.indexOf('--state') + 1] ?? '');
    };

    await scanOnce(worldOf(['feature_a'], cleanStream, hostSaid), state, OPTIONS);

    expect(seenArgs.some((call) => call.includes('--branch'))).toBe(false);
    const fullCalls = seenArgs.slice(3);
    expect(fullCalls.map((call) => call[call.indexOf('--state') + 1])).toEqual(['open', 'all']);
    expect(fullCalls.every((call) => call[call.indexOf('--limit') + 1] === LIMIT)).toBe(true);
    // One spend-rate call, two delta-side pr-list calls, plus the full read's
    // two calls — the retry `readBitbucketListing` makes on refusal.
    expect(seenArgs.length).toBe(5);
  });

  it('falls back to a full read when a carried OPEN row vanishes from both new answers', async () => {
    const state = freshScanState();
    // Two carried OPEN rows; the delta's answers below report only one of them,
    // so `feature_gone` vanished without the delta's own window explaining why.
    state.listingHeld = {
      rows: [
        { head: 'feature_a', state: 'OPEN', updatedAt: '2026-10-01T00:00:00Z' },
        { head: 'feature_gone', state: 'OPEN', updatedAt: '2026-10-01T00:00:00Z' },
      ],
      complete: true,
      fullReadAt: Date.now() - 1000,
    };
    state.listing = '.branches\t2\t-\t-\nfeature_a\tOPEN\tgreen\tfalse\nfeature_gone\tOPEN\tgreen\tfalse\n.list-arrived\t1\t-\t-\n';
    state.listingAt = Date.now() - (300_000 + 1);

    const seenArgs: string[][] = [];
    const hostSaid: Scripts['hostSaid'] = async (args) => {
      seenArgs.push([...args]);
      if (args.includes('open') && !args.includes(LIMIT)) {
        return {
          answer: 'answered',
          stdout: OPEN_ROW('feature_a', '2026-10-01T00:00:00Z'),
          stderr: 'plot-host: bitbucket pr-list state=open page complete (1 rows below requested limit 3000) — this page holds every pull request the host has in this state',
        };
      }
      if (args.includes('all') && args.includes('--since')) {
        return { answer: 'answered', stdout: '', stderr: 'plot-host: bitbucket pr-list state=all window complete (0 rows) — this window holds every pull request the host has in this state since the stamp' };
      }
      return wholePageAnswer(args[args.indexOf('--state') + 1] ?? '');
    };

    await scanOnce(worldOf(['feature_a', 'feature_gone'], cleanStream, hostSaid), state, OPTIONS);

    expect(seenArgs.some((call) => call.includes('--branch'))).toBe(false);
    // One spend-rate call, two delta-side pr-list calls, plus the full read's
    // two calls the retry makes on the vanished-row refusal.
    expect(seenArgs.length).toBe(5);
  });
});

describe('readBitbucketListing via scanOnce: the listing is a typed host answer', () => {
  it('asks Host.prListing unbranched with the scan limit and for the window with since, and never reads pr-list stdout', async () => {
    const queries: PrListingQuery[] = [];
    const hostSaid: Scripts['hostSaid'] = async () => ({ answer: 'failed', said: 'hostSaid must not be asked', kind: 'failed' } as unknown as HostAnswer);
    const typed = (world: ScanWorld): ScanWorld => ({
      ...world,
      walk: {
        ...world.walk,
        host: {
          ...world.walk.host,
          prListing: async (query: PrListingQuery): Promise<PrListing> => {
            queries.push(query);
            return { answer: 'answered', rows: [], complete: { [query.state]: 'whole' }, refusal: null };
          },
        },
      },
    });

    await scanOnce(typed(worldOf(['feature_a', 'feature_b'], cleanStream, hostSaid)), freshScanState(), OPTIONS);
    expect(queries).toEqual([
      { state: 'open', rich: true, limit: scanPrListLimit() },
      { state: 'all', limit: scanPrListLimit() },
    ]);

    queries.length = 0;
    const state = freshScanState();
    state.listingHeld = { rows: [{ head: 'feature_a', state: 'OPEN', updatedAt: '2026-10-01T00:00:00Z' }], complete: true, fullReadAt: Date.now() - 1000 };
    state.listing = '.branches\t0\t-\t-\n.list-arrived\t1\t-\t-\n';
    state.listingAt = Date.now() - (300_000 + 1);
    await scanOnce(typed(worldOf(['feature_a'], cleanStream, hostSaid)), state, OPTIONS);
    expect(queries[0]).toEqual({ state: 'open', rich: true, limit: scanPrListLimit() });
    expect(queries[1]?.state).toBe('all');
    expect(typeof queries[1]?.since).toBe('string');
    expect(queries[1]?.branches).toBeUndefined();
  });
});

describe('readBitbucketListing via scanOnce: a full read costs the same for every tracked-branch count', () => {
  const ROWS = 120;
  const OPEN = 7;
  const fullRead = async (tracked: number) => {
    const branches = Array.from({ length: tracked }, (_, i) => `feature_${i}`);
    const queries: PrListingQuery[] = [];
    const rowsFor = (state: string) => Array.from({ length: state === 'open' ? OPEN : ROWS }, (_, i) => ({
      head: `feature_${i}`, state: i < OPEN ? 'OPEN' : 'MERGED', updatedAt: '2026-10-01T00:00:00Z',
    }));
    const world = worldOf(branches, cleanStream, async () => ({ answer: 'failed', said: 'unused', kind: 'failed' } as unknown as HostAnswer));
    const typed: ScanWorld = {
      ...world,
      walk: {
        ...world.walk,
        host: {
          ...world.walk.host,
          prListing: async (query: PrListingQuery): Promise<PrListing> => {
            queries.push(query);
            return { answer: 'answered', rows: rowsFor(query.state) as never, complete: { [query.state]: 'whole' }, refusal: null };
          },
        },
      },
    };
    const state = freshScanState();
    await scanOnce(typed, state, OPTIONS);
    return { queries, state };
  };

  it.each([1, 53, 200])('asks two listings for %i tracked branches and walks the same rows', async (tracked) => {
    const { queries, state } = await fullRead(tracked);
    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.branches === undefined)).toBe(true);
    expect(state.listingWalked).toEqual({ all: ROWS, open: OPEN });
  });

  it('keeps only the rows of the tracked branches', async () => {
    const { state } = await fullRead(3);
    const heads = (state.listingHeld?.rows ?? []).map((row) => row.head).sort();
    expect(heads).toEqual(['feature_0', 'feature_1', 'feature_2']);
  });
});
