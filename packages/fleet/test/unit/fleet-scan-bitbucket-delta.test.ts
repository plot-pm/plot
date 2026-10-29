import { describe, expect, it } from 'vitest';

import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { HostAnswer, Scripts } from '@plot-pm/domain/ports/scripts';
import type { Refs } from '@plot-pm/domain/ports/refs';

import { freshScanState, scanOnce, type ScanOptions, type ScanWorld } from '../../src/shared/fleet-scan.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: `readBitbucketListing`
 * (`docs/plans/2026-10-28-a-bitbucket-scan-reads-a-delta.md`) reads a delta
 * where the host can prove one whole, and falls back to a full branch sweep
 * where it cannot — same as `readGithubListing` already does for GitHub.
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
  ({
    branchDates: async () => ok([]),
    branchTips: async () => ok([]),
    listBlobs: async () => ok([]),
    listBranches: async () => ok(branches),
    remoteUrl: async () => ok(''),
  }) as unknown as Refs;

const OPEN_ROW = (head: string, updatedAt: string) =>
  `${JSON.stringify({ head, state: 'OPEN', updatedAt })}\n`;

const cleanStream: Scripts['stream'] = async (_s, _a, onLine) => {
  onLine(JSON.stringify({ kind: 'reading', reading: READING }));
};

/** A `pr-list --branch ...` full-sweep answer: one whole page, no rows. */
const emptySweepAnswer = (state: string): HostAnswer => ({
  answer: 'answered',
  stdout: '',
  stderr: `plot-host: bitbucket pr-list sweep complete (0 rows across 1 branch) — every tracked branch was asked and each answered`,
});

const worldOf = (branches: readonly string[], stream: Scripts['stream'], hostSaid: Scripts['hostSaid']): ScanWorld => ({
  repoRoot: '/repo',
  scripts: {
    stream,
    hostSaid,
    config: async () => ok('docs/plans/'),
    planMeta: async () => ok(''),
  } as unknown as Scripts,
  refs: refsFakeWith(branches),
  backend: async () => 'bitbucket',
});

const OPTIONS: ScanOptions = { record: false };

describe('readBitbucketListing via scanOnce: a delta the host can prove whole', () => {
  it('asks the unbranched open call capped at 49 and a windowed --since rest call', async () => {
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
      const state_ = args[1] === '--state' ? args[2] : '';
      if (state_ === 'open') {
        return {
          answer: 'answered',
          stdout: OPEN_ROW('feature_a', '2026-10-01T00:00:00Z'),
          stderr: 'plot-host: bitbucket pr-list state=open page complete (1 rows below requested limit 49) — this page holds every pull request the host has in this state',
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
    expect(openCall?.[openCall.indexOf('--limit') + 1]).toBe('49');
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

describe('readBitbucketListing via scanOnce: a delta the host cannot prove whole falls back to a sweep', () => {
  it('falls back to a full branch sweep when the open call lands exactly at the 49-row cap', async () => {
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
      // The delta's open call: 49 rows at the 49-row cap. `pr_list_report_complete`
      // requires `count < limit` to claim a page whole, so a page landing exactly
      // at the cap carries no whole-page notice — the host cannot tell whether a
      // 50th row exists past this page, so it prints no claim either way.
      if (args.includes('open') && args.includes('49')) {
        const rows = Array.from({ length: 49 }, (_, i) => OPEN_ROW(`feature_${i}`, '2026-10-01T00:00:00Z')).join('');
        return { answer: 'answered', stdout: rows, stderr: '' };
      }
      // The delta's windowed rest call, asked alongside the open call, before
      // the refusal is known — it is whole on its own, but the open half isn't.
      if (args.includes('all') && args.includes('--since')) {
        return { answer: 'answered', stdout: '', stderr: 'plot-host: bitbucket pr-list state=all window complete (0 rows) — this window holds every pull request the host has in this state since the stamp' };
      }
      // The fallback full sweep: one branch, both states, whole and empty.
      return emptySweepAnswer(args[2] ?? '');
    };

    await scanOnce(worldOf(['feature_a'], cleanStream, hostSaid), state, OPTIONS);

    const branchCalls = seenArgs.filter((call) => call.includes('--branch'));
    expect(branchCalls.length).toBe(2);
    expect(branchCalls.every((call) => call.includes('feature_a'))).toBe(true);
    // One spend-rate call, two delta-side pr-list calls (open capped at 49,
    // since-windowed rest), plus two full-sweep calls — the retry
    // `readBitbucketListing` makes on refusal.
    expect(seenArgs.length).toBe(5);
  });

  it('falls back to a full branch sweep when a carried OPEN row vanishes from both new answers', async () => {
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
      if (args.includes('open') && !args.includes('--branch')) {
        return {
          answer: 'answered',
          stdout: OPEN_ROW('feature_a', '2026-10-01T00:00:00Z'),
          stderr: 'plot-host: bitbucket pr-list state=open page complete (1 rows below requested limit 49) — this page holds every pull request the host has in this state',
        };
      }
      if (args.includes('all') && args.includes('--since')) {
        return { answer: 'answered', stdout: '', stderr: 'plot-host: bitbucket pr-list state=all window complete (0 rows) — this window holds every pull request the host has in this state since the stamp' };
      }
      return emptySweepAnswer(args[2] ?? '');
    };

    await scanOnce(worldOf(['feature_a', 'feature_gone'], cleanStream, hostSaid), state, OPTIONS);

    const branchCalls = seenArgs.filter((call) => call.includes('--branch'));
    expect(branchCalls.length).toBe(2);
    // One spend-rate call, two delta-side pr-list calls, plus the two
    // full-sweep calls the retry makes on the vanished-row refusal.
    expect(seenArgs.length).toBe(5);
  });
});
