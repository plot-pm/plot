import { describe, expect, it } from 'vitest';

import { LISTING_BACKOFF_BASE_MS } from '@plot-pm/domain';

import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { HostAnswer, Scripts } from '@plot-pm/domain/ports/scripts';
import type { Refs } from '@plot-pm/domain/ports/refs';

import { emptyWalk, withWalkRefs } from './walk-fake.js';
import { freshScanState, scanOnce, type ScanOptions, type ScanWorld } from '../../src/shared/fleet-scan.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: a refused scan listing backs off rather
 * than retrying every beat, on both backends, and the back-off never stops
 * the scan itself (`docs/plans/2026-10-28-supervisor-tick-s-fleet-scan-reads.md`).
 *
 * Bitbucket's listing is now read host-side exactly like GitHub's — see
 * `docs/plans/2026-10-28-a-bitbucket-scan-reads-a-delta.md` — so a Bitbucket
 * refusal here is driven by `hostSaid`'s `pr-list` answers, the same lever
 * the GitHub tests already pulled, not by the scan's streamed reading.
 */

const readingWith = (host: FleetReading['summary']['host']): FleetReading => ({
  main: 'main',
  head: 'abc1234',
  plans: [],
  summary: {
    plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0,
    waiting: 0, prereq_missing: 0, host,
  },
});

const ok = <T>(value: T) => ({ ok: true as const, value });

const refsFake = {
  branchDates: async () => ok([]),
  branchTips: async () => ok([]),
  listBlobs: async () => ok([]),
  listBranches: async () => ok([]),
  remoteUrl: async () => ok(''),
} as unknown as Refs;
const refsFakeW = withWalkRefs(refsFake as unknown as Partial<Refs>);

/**
 * A `pr-list` answer whose stderr claims the page whole, carrying one OPEN
 * row for the `open` state and none for any other — `foldScanListing`
 * refuses a full read whose open AND rest pages both come back empty with
 * nothing carried, since that is not proof of a repository with no PRs.
 */
const wholePage = (state: string): HostAnswer => ({
  answer: 'answered',
  stdout: state === 'open' ? `${JSON.stringify({ head: 'feature_a', state: 'OPEN', updatedAt: '2026-10-01T00:00:00Z' })}\n` : '',
  stderr: `plot-host: bitbucket pr-list state=${state} page complete (0 rows below requested limit 49) — this page holds every pull request the host has in this state`,
});

const worldOf = (
  backend: 'github' | 'bitbucket',
  stream: Scripts['stream'],
  hostSaid: Scripts['hostSaid'] = async () => ({ answer: 'unaskable', said: 'no host stub in this world' }),
): ScanWorld => ({
  repoRoot: '/repo',
  scripts: {
    stream,
    hostSaid,
    config: async () => ok('docs/plans/'),
    planMeta: async () => ok(''),
  } as unknown as Scripts,
  refs: refsFakeW,
  backend: async () => backend,
  walk: emptyWalk(),
});

const OPTIONS: ScanOptions = { record: false };

/** A clean scan stream reporting a reading with the given host verdict — the field this file no longer drives Bitbucket backoff from, kept only so a reading still has a shape. */
const cleanReading = (host: FleetReading['summary']['host']): Scripts['stream'] =>
  async (_s, _a, onLine) => {
    onLine(JSON.stringify({ kind: 'reading', reading: readingWith(host) }));
  };

/** A `hostSaid` stub answering every `pr-list` call with a whole page — a Bitbucket host read that succeeds. */
const wholeBitbucketListing: Scripts['hostSaid'] = async (args) => {
  const state = args[1] === '--state' ? args[2] : 'open';
  return wholePage(state ?? 'open');
};

/** A `hostSaid` stub refusing every `pr-list` call — a Bitbucket host read that refuses. */
const refusedBitbucketListing: Scripts['hostSaid'] = async () => ({
  answer: 'failed',
  said: 'plot-host: bitbucket pr-list throttled',
});

describe('scanOnce backs off a refused listing', () => {
  it('opens a back-off on a Bitbucket host read that refuses', async () => {
    const state = freshScanState();
    await scanOnce(worldOf('bitbucket', cleanReading('unknown'), refusedBitbucketListing), state, OPTIONS);
    expect(state.backoffUntil).not.toBeNull();
    expect(state.backoffMs).toBe(LISTING_BACKOFF_BASE_MS);
  });

  it('opens a back-off on a GitHub host read that refuses (null hostRead)', async () => {
    const state = freshScanState();
    // No gh stub on PATH in this world — readGithubListing's host call fails, so
    // hostRead stays null and the scan's own stream never adopts a listing either.
    const seen: Array<Record<string, string> | undefined> = [];
    const recording: Scripts['stream'] = async (_s, _a, onLine, options) => {
      seen.push(options?.env);
      onLine(JSON.stringify({ kind: 'reading', reading: readingWith('unknown') }));
    };
    await scanOnce(worldOf('github', recording), state, OPTIONS);
    expect(state.backoffUntil).not.toBeNull();
    expect(state.backoffMs).toBe(LISTING_BACKOFF_BASE_MS);
  });

  it('clears the back-off on the next adopted (ok) Bitbucket host read', async () => {
    const state = freshScanState();
    state.backoffUntil = Date.now() - 1;
    state.backoffMs = LISTING_BACKOFF_BASE_MS * 4;
    await scanOnce(worldOf('bitbucket', cleanReading('ok'), wholeBitbucketListing), state, OPTIONS);
    expect(state.backoffUntil).toBeNull();
    expect(state.backoffMs).toBeNull();
  });

  it('grows the back-off on a repeated refusal rather than repeating the base', async () => {
    const state = freshScanState();
    state.backoffUntil = Date.now() - 1;
    state.backoffMs = LISTING_BACKOFF_BASE_MS;
    await scanOnce(worldOf('bitbucket', cleanReading('unknown'), refusedBitbucketListing), state, OPTIONS);
    expect(state.backoffMs).toBeGreaterThan(LISTING_BACKOFF_BASE_MS);
  });

  it('skips only the listing while a back-off is held: the scan still runs and still writes a terminal pulse', async () => {
    const state = freshScanState();
    state.backoffUntil = Date.now() + 60_000;
    state.backoffMs = LISTING_BACKOFF_BASE_MS;
    state.listing = '.branches\t1\t-\t-\nfeature_a\tOPEN\tgreen\tfalse\n.list-arrived\t1\t-\t-\n';
    state.listingAt = Date.now();
    const seen: Array<Record<string, string> | undefined> = [];
    const recording: Scripts['stream'] = async (_s, _a, onLine, options) => {
      seen.push(options?.env);
      onLine(JSON.stringify({ kind: 'reading', reading: readingWith('ok') }));
    };
    const carried = state.listing;
    const result = await scanOnce(worldOf('bitbucket', recording), state, OPTIONS);
    expect(result.reading.summary.host).toBe('ok');
    // A back-off held means not due — no host spend attempted and the carried
    // listing stays untouched.
    expect(state.listing).toBe(carried);
  });

  it('does not open a back-off on a reused (not due) pass that spent nothing', async () => {
    const state = freshScanState();
    state.listingAt = Date.now();
    state.listing = '.branches\t1\t-\t-\nfeature_a\tOPEN\tgreen\tfalse\n.list-arrived\t1\t-\t-\n';
    const stream: Scripts['stream'] = async (_s, _a, onLine) => {
      onLine(JSON.stringify({ kind: 'reading', reading: readingWith('unknown') }));
    };
    await scanOnce(worldOf('bitbucket', stream), state, OPTIONS);
    expect(state.backoffUntil).toBeNull();
  });
});

describe('scanOnce when the very first listing is refused', () => {
  it('reports the refusal as a back-off with nothing to carry, on Bitbucket same as GitHub', async () => {
    const state = freshScanState();
    await scanOnce(worldOf('bitbucket', async () => undefined as never, refusedBitbucketListing), state, OPTIONS);

    // With no prior listing and a refused host read, state.listing stays empty
    // and the back-off opens.
    expect(state.listing).toBe('');
    expect(state.backoffUntil).not.toBeNull();
  });
});
