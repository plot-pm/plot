import { describe, expect, it } from 'vitest';

import { LISTING_BACKOFF_BASE_MS } from '@plot-pm/domain';

import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { freshScanState, scanOnce, type ScanOptions, type ScanWorld } from '../../src/shared/fleet-scan.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: a refused scan listing backs off rather
 * than retrying every beat, on both backends, and the back-off never stops
 * the scan itself (`docs/plans/2026-10-28-supervisor-tick-s-fleet-scan-reads.md`).
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
  remoteUrl: async () => ok(''),
} as unknown as Refs;

const worldOf = (backend: 'github' | 'bitbucket', stream: Scripts['stream']): ScanWorld => ({
  repoRoot: '/repo',
  scripts: {
    stream,
    hostSaid: async () => ({ answer: 'unaskable', stdout: '' }),
    config: async () => ok('docs/plans/'),
    planMeta: async () => ok(''),
  } as unknown as Scripts,
  refs: refsFake,
  backend: async () => backend,
});

const OPTIONS: ScanOptions = { record: false };

/** A clean Bitbucket-shaped scan that reports a reading with the given host verdict. */
const cleanBitbucket = (host: FleetReading['summary']['host']): Scripts['stream'] =>
  async (_s, _a, onLine) => {
    onLine(JSON.stringify({ kind: 'reading', reading: readingWith(host) }));
  };

describe('scanOnce backs off a refused listing', () => {
  it('opens a back-off on a Bitbucket sweep the reading reports as throttled', async () => {
    const state = freshScanState();
    await scanOnce(worldOf('bitbucket', cleanBitbucket('throttled')), state, OPTIONS);
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

  it('clears the back-off on the next adopted (ok) listing', async () => {
    const state = freshScanState();
    state.backoffUntil = Date.now() - 1;
    state.backoffMs = LISTING_BACKOFF_BASE_MS * 4;
    await scanOnce(worldOf('bitbucket', cleanBitbucket('ok')), state, OPTIONS);
    expect(state.backoffUntil).toBeNull();
    expect(state.backoffMs).toBeNull();
  });

  it('grows the back-off on a repeated refusal rather than repeating the base', async () => {
    const state = freshScanState();
    state.backoffUntil = Date.now() - 1;
    state.backoffMs = LISTING_BACKOFF_BASE_MS;
    await scanOnce(worldOf('bitbucket', cleanBitbucket('secondary')), state, OPTIONS);
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
    const result = await scanOnce(worldOf('bitbucket', recording), state, OPTIONS);
    expect(result.reading.summary.host).toBe('ok');
    // The carried listing is handed to the shell untouched — no host spend attempted.
    expect(seen[0]?.PLOT_PR_LISTING).toBe(state.listing);
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
  it('reports the refusal as a back-off with nothing to carry — the shell sweeps for itself every beat', async () => {
    const state = freshScanState();
    const seen: Array<Record<string, string> | undefined> = [];
    const recording: Scripts['stream'] = async (_s, _a, onLine, options) => {
      seen.push(options?.env);
      onLine(JSON.stringify({ kind: 'reading', reading: readingWith('failed') }));
    };
    await scanOnce(worldOf('bitbucket', recording), state, OPTIONS);

    // Measured: with no prior listing, state.listing stays empty and the back-off
    // still opens. The shell is handed PLOT_PR_LISTING='' and, per its own
    // unaffected sweep logic, makes its own per-beat Bitbucket sweep rather than
    // skipping it — this scan-side back-off alone does not stop that shell sweep
    // when there was never a listing to carry. A shell-side guard (e.g. honouring
    // a backoff env var) is not in this slice's scope.
    expect(state.listing).toBe('');
    expect(seen[0]?.PLOT_PR_LISTING).toBe('');
    expect(state.backoffUntil).not.toBeNull();
  });
});
