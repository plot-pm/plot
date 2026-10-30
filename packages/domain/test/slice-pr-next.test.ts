import { describe, expect, it } from 'vitest';

import type { PrIndexRow } from '../src/entities/pr-index.js';
import type { Sprint } from '../src/entities/sprint.js';
import { defaultBranchRed } from '../src/rules/default-branch.js';
import type { DefaultBranchReading } from '../src/entities/default-branch.js';
import { nextMerge, slicePrNext, type SlicePrNextReadings } from '../src/rules/slice-pr-next.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = Date.parse('2026-10-30T12:00:00Z');
const BRANCH = 'feature/x';

const row = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 7,
  head: BRANCH,
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'green',
  plotReview: 'absent',
  ...over,
});

const readings = (over: Partial<SlicePrNextReadings> = {}): SlicePrNextReadings => ({
  row: row(),
  newestMerged: null,
  scope: { read: 'scope', sprint: {} as Sprint, slugs: ['x'], branches: [BRANCH] },
  reviewRun: null,
  reviewStarts: null,
  verdict: { read: 'absent' },
  defaultBranch: null,
  desk: { dead: false, why: 'live' },
  config: { autoReview: true, reviewBoundMs: 3_600_000, startBudget: 3, checksWaitMs: 3_600_000 },
  now: NOW,
  ...over,
});

describe('slicePrNext', () => {
  it('answers none for a null store', () => {
    expect(slicePrNext(readings({ row: null }))).toEqual({ step: 'none', why: 'no-row' });
  });

  it('answers none for a draft, a closed PR, no scope and a branch out of scope', () => {
    expect(slicePrNext(readings({ row: row({ draft: true }) }))).toMatchObject({ step: 'none', why: 'draft' });
    expect(slicePrNext(readings({ row: row({ state: 'MERGED' }) }))).toMatchObject({ why: 'not-open' });
    expect(slicePrNext(readings({ scope: { read: 'none', why: 'no-active-sprint' } }))).toMatchObject({
      step: 'none',
      why: 'scope-no-active-sprint',
    });
    expect(slicePrNext(readings({ row: row({ head: 'feature/other' }) }))).toMatchObject({ why: 'out-of-scope' });
  });

  it('answers none for a row with no plotReview field: the index never says no', () => {
    const { plotReview: _, ...bare } = row();
    expect(slicePrNext(readings({ row: bare }))).toEqual({ step: 'none', why: 'not-asked' });
  });

  it('reviews a green head whose review is absent', () => {
    expect(slicePrNext(readings())).toEqual({ step: 'review', head: HEAD });
  });

  it('reviews a head when the review names an older SHA', () => {
    const r = row({ plotReview: 'success', plotReviewSha: OLD });
    expect(slicePrNext(readings({ row: r }))).toEqual({ step: 'review', head: HEAD });
  });

  it('does not review a head that holds a review on it', () => {
    const r = row({ plotReview: 'success', plotReviewSha: HEAD });
    // With no default-branch reading the merge arm holds, so a passed head no longer ends at `reviewed`.
    expect(slicePrNext(readings({ row: r }))).toEqual({ step: 'hold', reason: 'default-branch-unread' });
  });

  it('holds on a live review run', () => {
    const reviewRun = { head: HEAD, pid: 1, startedAt: NOW, live: true };
    expect(slicePrNext(readings({ reviewRun }))).toEqual({ step: 'hold', reason: 'review-in-flight' });
  });

  it('does not hold on a live run for an older head', () => {
    const reviewRun = { head: OLD, pid: 1, startedAt: NOW, live: true };
    expect(slicePrNext(readings({ reviewRun }))).toEqual({ step: 'review', head: HEAD });
  });

  it('answers none for a fresh pending and reviews a pending past the bound', () => {
    const fresh = row({ plotReview: 'pending', plotReviewSha: HEAD, plotReviewAt: new Date(NOW - 60_000).toISOString() });
    expect(slicePrNext(readings({ row: fresh }))).toMatchObject({ step: 'none', why: 'reviewed' });
    const stale = row({ plotReview: 'pending', plotReviewSha: HEAD, plotReviewAt: new Date(NOW - 3_700_000).toISOString() });
    expect(slicePrNext(readings({ row: stale }))).toEqual({ step: 'review', head: HEAD });
  });

  it('answers none with the budget spent, and with the backoff before the next start', () => {
    const spent = { head: HEAD, count: 3, lastAt: NOW - 10 * 3_600_000 };
    expect(slicePrNext(readings({ reviewStarts: spent }))).toEqual({ step: 'none', why: 'budget-spent' });
    const soon = { head: HEAD, count: 1, lastAt: NOW - 14 * 60_000 };
    expect(slicePrNext(readings({ reviewStarts: soon }))).toEqual({ step: 'none', why: 'backoff' });
    const later = { head: HEAD, count: 1, lastAt: NOW - 16 * 60_000 };
    expect(slicePrNext(readings({ reviewStarts: later }))).toEqual({ step: 'review', head: HEAD });
    const second = { head: HEAD, count: 2, lastAt: NOW - 30 * 60_000 };
    expect(slicePrNext(readings({ reviewStarts: second }))).toEqual({ step: 'none', why: 'backoff' });
  });

  it('counts starts per head: a record for an older head allows a start', () => {
    const old = { head: OLD, count: 3, lastAt: NOW };
    expect(slicePrNext(readings({ reviewStarts: old }))).toEqual({ step: 'review', head: HEAD });
  });

  it('answers none with Auto-review off', () => {
    const config = { autoReview: false, reviewBoundMs: 1, startBudget: 3, checksWaitMs: 1 };
    expect(slicePrNext(readings({ config }))).toEqual({ step: 'none', why: 'auto-review-off' });
  });

  it('answers none when the checks are not bound to the head or not green', () => {
    expect(slicePrNext(readings({ row: row({ checksSha: OLD }) }))).toMatchObject({ why: 'checks-unbound' });
    expect(slicePrNext(readings({ row: row({ ciChecks: 'pending' }) }))).toMatchObject({ why: 'ci-not-green' });
  });

  it('still reviews on a red default branch', () => {
    const defaultBranch = { v: 1, askedAt: new Date(NOW).toISOString(), sha: HEAD, state: 'red' } as never;
    expect(slicePrNext(readings({ defaultBranch }))).toEqual({ step: 'review', head: HEAD });
  });

  it('writes the status of a verdict file the index does not reflect', () => {
    const verdict = { read: 'verdict', state: 'failure', description: 'HIGH 1' } as const;
    expect(slicePrNext(readings({ verdict }))).toEqual({
      step: 'write-status',
      head: HEAD,
      state: 'failure',
      description: 'HIGH 1',
      why: 'verdict-unwritten',
    });
  });

  it('writes nothing when the index already reflects the verdict', () => {
    const verdict = { read: 'verdict', state: 'success', description: 'ok' } as const;
    const r = row({ plotReview: 'success', plotReviewSha: HEAD });
    expect(slicePrNext(readings({ verdict, row: r }))).toEqual({ step: 'hold', reason: 'default-branch-unread' });
  });

  it('holds on an unreadable verdict file', () => {
    expect(slicePrNext(readings({ verdict: { read: 'unread' } }))).toEqual({ step: 'hold', reason: 'unread' });
  });

  it('holds on a live fixer mark over an otherwise green new head, before the review arm', () => {
    const fixer = { read: 'record', inFlight: true } as const;
    expect(slicePrNext(readings({ fixer }))).toEqual({ step: 'hold', reason: 'fixer-in-flight' });
    expect(slicePrNext(readings({ fixer: { read: 'record', inFlight: false } }))).toEqual({ step: 'review', head: HEAD });
  });

  it('holds on an unread sibling record', () => {
    expect(slicePrNext(readings({ fixer: { read: 'unread' } }))).toEqual({ step: 'hold', reason: 'unread' });
    expect(slicePrNext(readings({ ticket: { read: 'unread' } }))).toEqual({ step: 'hold', reason: 'unread' });
  });

  it('holds on a live run of the head before it writes a status', () => {
    const reviewRun = { head: HEAD, pid: 1, startedAt: NOW, live: true };
    const verdict = { read: 'verdict', state: 'success', description: 'ok' } as const;
    expect(slicePrNext(readings({ reviewRun, verdict }))).toEqual({ step: 'hold', reason: 'review-in-flight' });
  });

  it('answers none for a verdict with no headSha or plotReview to match against', () => {
    const verdict = { read: 'verdict', state: 'success', description: 'ok' } as const;
    const { headSha: _h, ...noHeadSha } = row();
    expect(slicePrNext(readings({ verdict, row: noHeadSha }))).toEqual({ step: 'none', why: 'not-asked' });
    const { plotReview: _p, ...noPlotReview } = row();
    expect(slicePrNext(readings({ verdict, row: noPlotReview }))).toEqual({ step: 'none', why: 'not-asked' });
  });

  it('holds on an unread repair record once every earlier arm answers none', () => {
    const config = { autoReview: false, reviewBoundMs: 1, startBudget: 3, checksWaitMs: 1 };
    expect(slicePrNext(readings({ repair: { read: 'unread' }, config }))).toEqual({ step: 'hold', reason: 'unread' });
  });
});

describe('the merge arm', () => {
  const TIP = 'c'.repeat(40);
  const reading = (over: Partial<DefaultBranchReading> = {}): DefaultBranchReading => ({
    v: 1,
    branch: 'main',
    headSha: TIP,
    head: 'green',
    settled: { sha: TIP, state: 'green' },
    failingRuns: [],
    headSince: '2026-10-30T11:00:00Z',
    askedAt: '2026-10-30T11:55:00Z',
    at: '2026-10-30T11:55:00Z',
    ...over,
  });
  const passed = row({ plotReview: 'success', plotReviewSha: HEAD });
  const merging = (over: Partial<SlicePrNextReadings> = {}) =>
    slicePrNext(readings({ row: passed, defaultBranch: reading(), ...over }));

  it('merges a passed review on the head against a settled green reading', () => {
    expect(merging()).toEqual({ step: 'merge', head: HEAD });
  });

  it('answers none for a review not on the head, and for a row never asked', () => {
    expect(merging({ row: row({ plotReview: 'success', plotReviewSha: OLD }) })).toEqual({ step: 'review', head: HEAD });
    expect(merging({ row: row({ plotReview: 'failure', plotReviewSha: HEAD }) })).toMatchObject({ step: 'none' });
    const { plotReview: _, ...bare } = row();
    expect(merging({ row: bare })).toMatchObject({ step: 'none' });
  });

  it('holds default-branch-unread with no reading', () => {
    expect(merging({ defaultBranch: null })).toEqual({ step: 'hold', reason: 'default-branch-unread' });
  });

  it('holds default-branch-red on a fresh settled red', () => {
    const red = reading({ settled: { sha: TIP, state: 'red' } });
    expect(merging({ defaultBranch: red })).toEqual({ step: 'hold', reason: 'default-branch-red' });
  });

  it('holds default-branch-stale where defaultBranchRed lifts its own hold on the same reading', () => {
    const old = reading({ settled: { sha: TIP, state: 'red' }, askedAt: '2026-10-30T09:00:00Z' });
    expect(defaultBranchRed(old, NOW, 3_600_000)).toBe(false);
    expect(merging({ defaultBranch: old })).toEqual({ step: 'hold', reason: 'default-branch-stale' });
    const oldGreen = reading({ askedAt: '2026-10-30T09:00:00Z' });
    expect(merging({ defaultBranch: oldGreen })).toEqual({ step: 'hold', reason: 'default-branch-stale' });
    expect(merging({ defaultBranch: reading({ askedAt: 'never' }) })).toEqual({ step: 'hold', reason: 'default-branch-stale' });
  });

  it('holds default-branch-unsettled for a settled state that is not green', () => {
    expect(merging({ defaultBranch: reading({ settled: { sha: TIP, state: 'pending' } }) })).toEqual({
      step: 'hold',
      reason: 'default-branch-unsettled',
    });
    expect(merging({ defaultBranch: reading({ settled: undefined }) })).toMatchObject({ reason: 'default-branch-unsettled' });
  });

  it('holds merge-in-flight where the settled commit is not the head', () => {
    expect(merging({ defaultBranch: reading({ headSha: 'd'.repeat(40) }) })).toEqual({
      step: 'hold',
      reason: 'merge-in-flight',
    });
  });

  it('holds merge-in-flight where a merged row is newer than the reading, though the reading looks settled', () => {
    expect(merging({ newestMerged: { mergedAt: '2026-10-30T11:58:00Z' } })).toEqual({
      step: 'hold',
      reason: 'merge-in-flight',
    });
    expect(merging({ newestMerged: { mergedAt: 'garbled' } })).toMatchObject({ reason: 'merge-in-flight' });
    expect(merging({ newestMerged: { mergedAt: '2026-10-30T11:50:00Z' } })).toMatchObject({ step: 'merge' });
  });

  it('holds conflicting and merger-app-missing', () => {
    expect(merging({ row: { ...passed, mergeable: 'CONFLICTING' } })).toEqual({ step: 'hold', reason: 'conflicting' });
    expect(merging({ mergerAppMissing: true })).toEqual({ step: 'hold', reason: 'merger-app-missing' });
    expect(merging({ mergerAppMissing: false })).toMatchObject({ step: 'merge' });
  });

  it('keeps the unread hold on an unread repair record', () => {
    expect(merging({ repair: { read: 'unread' } })).toEqual({ step: 'hold', reason: 'unread' });
  });
});

describe('nextMerge', () => {
  const m = (pr: number) => ({ pr, step: { step: 'merge' as const, head: `h${pr}` } });
  it('picks the lowest PR number among the merge steps', () => {
    expect(nextMerge([m(9), m(4), { pr: 2, step: { step: 'hold', reason: 'conflicting' } }, m(6)])).toEqual({ pr: 4, head: 'h4' });
  });
  it('answers null where no row merges', () => {
    expect(nextMerge([{ pr: 2, step: { step: 'none', why: 'x' } }])).toBeNull();
    expect(nextMerge([])).toBeNull();
  });
});
