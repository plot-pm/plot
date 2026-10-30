import { describe, expect, it } from 'vitest';

import type { PrIndexRow } from '../src/entities/pr-index.js';
import type { Sprint } from '../src/entities/sprint.js';
import type { RunLogLine } from '../src/ports/run-log.js';
import {
  encodeNotifyOutcome,
  groupChangesets,
  lastNotifiedChangesets,
  releasePrepareNext,
  releaseStage,
  type ReleasePrepareReadings,
  releaseStageView,
  releaseStageViewOf,
} from '../src/rules/release-prepare.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = Date.parse('2026-10-30T12:00:00Z');
const BRANCH = 'changeset-release/main';

const row = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 9,
  head: BRANCH,
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'none',
  plotReview: 'success',
  plotReviewSha: HEAD,
  ...over,
});

const greenRuns = { read: 'runs', runs: [{ workflow: 'CI', status: 'completed', conclusion: 'success' }] } as const;

const line = (over: Partial<RunLogLine> = {}): RunLogLine => ({
  plan: 'sprint',
  branch: BRANCH,
  pr: '9',
  head: HEAD,
  step: 'release-notified',
  outcome: encodeNotifyOutcome('sent', ['a.md']),
  at: '2026-10-30T11:00:00Z',
  ...over,
});

const readings = (over: Partial<ReleasePrepareReadings> = {}): ReleasePrepareReadings => ({
  scope: { read: 'scope', sprint: {} as Sprint, slugs: ['x', 'y'], branches: [] },
  phases: new Map([['x', 'delivered'], ['y', 'delivered']]),
  pr: row(),
  checks: greenRuns,
  changesets: [{ file: 'a.md', plan: '2026-10-29-x' }],
  log: [],
  reviewRun: null,
  reviewStarts: null,
  finish: 'none',
  config: { requiredWorkflow: 'CI', reviewBoundMs: 3_600_000, startBudget: 3 },
  now: NOW,
  ...over,
});

describe('releasePrepareNext', () => {
  it('holds on a scope read as none, never ready', () => {
    const r = readings({ scope: { read: 'none', why: 'no-active-sprint' } });
    expect(releasePrepareNext(r)).toEqual({ step: 'hold', reason: 'waiting-scope' });
    expect(releaseStage(r)).toBe('waiting-scope');
  });

  it('holds while one scope plan is still Approved', () => {
    const r = readings({ phases: new Map([['x', 'delivered'], ['y', 'approved']]) });
    expect(releasePrepareNext(r)).toEqual({ step: 'hold', reason: 'waiting-scope' });
  });

  it('holds unaskable where the plans could not be read', () => {
    expect(releasePrepareNext(readings({ phases: 'unaskable' }))).toEqual({ step: 'hold', reason: 'unaskable' });
  });

  it('holds, and never says no release PR, on a PR read that failed', () => {
    expect(releaseStage(readings({ pr: 'unaskable' }))).toBe('preparing');
    expect(releasePrepareNext(readings({ pr: 'unaskable' }))).toEqual({ step: 'hold', reason: 'unaskable' });
    expect(releasePrepareNext(readings({ pr: 'none' }))).toEqual({ step: 'none', why: 'no-release-pr' });
  });

  it('holds unaskable when the changesets or the log cannot be read at ready', () => {
    expect(releasePrepareNext(readings({ changesets: 'unaskable' }))).toEqual({ step: 'hold', reason: 'unaskable' });
    expect(releasePrepareNext(readings({ log: 'unaskable' }))).toEqual({ step: 'hold', reason: 'unaskable' });
  });

  it('starts a review for a green head with no review', () => {
    const r = readings({ pr: row({ plotReview: 'absent', plotReviewSha: undefined }) });
    expect(releasePrepareNext(r)).toEqual({ step: 'review', head: HEAD });
    expect(releaseStage(r)).toBe('preparing');
  });

  it('reads plotReview success with a stale plotReviewSha as not reviewed on this head', () => {
    const r = readings({ pr: row({ plotReview: 'success', plotReviewSha: OLD }) });
    expect(releaseStage(r)).toBe('preparing');
    expect(releasePrepareNext(r)).toEqual({ step: 'review', head: HEAD });
  });

  it('starts no review before the required workflow is green', () => {
    const pending = { read: 'runs', runs: [{ workflow: 'CI', status: 'in_progress', conclusion: null }] } as const;
    const r = readings({ checks: pending, pr: row({ plotReview: 'absent', plotReviewSha: undefined }) });
    expect(releasePrepareNext(r)).toEqual({ step: 'none', why: 'checks-pending' });
  });

  it('starts no second review while one is live on the head', () => {
    const r = readings({
      pr: row({ plotReview: 'absent', plotReviewSha: undefined }),
      reviewRun: { head: HEAD, pid: 1, startedAt: NOW, live: true },
    });
    expect(releasePrepareNext(r)).toEqual({ step: 'none', why: 'review-in-flight' });
  });

  it('notifies once the head can be approved', () => {
    expect(releasePrepareNext(readings())).toMatchObject({ step: 'notify', head: HEAD, first: true });
    expect(releaseStage(readings())).toBe('ready');
  });

  it('sends no second notification for an unchanged changeset list on a moved head', () => {
    const r = readings({ pr: row({ headSha: OLD, plotReviewSha: OLD }), log: [line()] });
    expect(releasePrepareNext(r)).toEqual({ step: 'none', why: 'notified' });
  });

  it('notifies again where the changeset list differs', () => {
    const r = readings({ log: [line({ outcome: encodeNotifyOutcome('sent', ['z.md']) })] });
    expect(releasePrepareNext(r)).toMatchObject({ step: 'notify', first: false });
  });

  it('reaches ready and notifies with a changeset from outside the scope', () => {
    const r = readings({
      changesets: [
        { file: 'a.md', plan: '2026-10-29-x' },
        { file: 'b.md', plan: '2026-10-29-elsewhere' },
        { file: 'c.md', plan: '' },
      ],
    });
    expect(releaseStage(r)).toBe('ready');
    expect(releasePrepareNext(r)).toMatchObject({
      step: 'notify',
      changesets: { scope: ['a.md'], outside: ['b.md', 'c.md'] },
    });
  });

  it('counts a failed send as no notification', () => {
    const r = readings({ log: [line({ outcome: encodeNotifyOutcome('failed 1', ['a.md']) })] });
    expect(releasePrepareNext(r)).toMatchObject({ step: 'notify', first: true });
  });

  it('does nothing for a merged PR and names the finish stage', () => {
    expect(releaseStage(readings({ pr: row({ state: 'MERGED' }) }))).toBe('merged');
    expect(releaseStage(readings({ pr: row({ state: 'MERGED' }), finish: 'publishing' }))).toBe('publishing');
    expect(releaseStage(readings({ finish: 'released' }))).toBe('released');
    expect(releaseStage(readings({ finish: 'failed' }))).toBe('failed');
    expect(releasePrepareNext(readings({ pr: row({ state: 'MERGED' }) }))).toEqual({ step: 'none', why: 'merged' });
  });

  it('derives readiness from the readings and not from an earlier notification line', () => {
    expect(releaseStage(readings({ log: [line()], phases: new Map([['x', 'approved'], ['y', 'delivered']]) }))).toBe(
      'waiting-scope',
    );
  });
});

describe('release changeset record', () => {
  it('groups by scope slug', () => {
    expect(groupChangesets([{ file: 'q.md', plan: '2026-10-29-x' }], ['x'])).toEqual({ scope: ['q.md'], outside: [] });
  });
  it('reads the newest counted line for the branch', () => {
    const log = [line(), line({ outcome: encodeNotifyOutcome('unaskable', ['b.md', 'a.md']) }), line({ branch: 'other', outcome: 'sent: z.md' })];
    expect(lastNotifiedChangesets(log, BRANCH)).toEqual(['a.md', 'b.md']);
    expect(lastNotifiedChangesets([], BRANCH)).toBeNull();
  });
});

describe('releaseStageView', () => {
  it('enables the approval only at ready', () => {
    const stages = ['waiting-scope', 'preparing', 'ready', 'merged', 'publishing', 'released', 'failed'] as const;
    expect(stages.filter((stage) => releaseStageView(stage).approvable)).toEqual(['ready']);
  });

  it('reads no view from an empty or unknown word', () => {
    expect(releaseStageViewOf('')).toBeNull();
    expect(releaseStageViewOf('toString')).toBeNull();
    expect(releaseStageViewOf('ready')?.label).toBe('ready to approve');
  });
});

describe('releasePrepareNext, remaining arms', () => {
  const unreviewed = { plotReview: 'absent', plotReviewSha: undefined } as const;

  it('names each finish stage and reads a merged PR as merged', () => {
    for (const finish of ['failed', 'released', 'publishing'] as const) {
      expect(releaseStage(readings({ finish }))).toBe(finish);
      expect(releasePrepareNext(readings({ finish }))).toEqual({ step: 'none', why: finish });
    }
    expect(releaseStage(readings({ pr: row({ state: 'MERGED' }) }))).toBe('merged');
  });

  it('prepares, not ready, for a PR with no head, a closed PR or an absent PR', () => {
    expect(releaseStage(readings({ pr: row({ headSha: undefined }) }))).toBe('preparing');
    expect(releaseStage(readings({ pr: row({ state: 'CLOSED' }) }))).toBe('preparing');
    expect(releasePrepareNext(readings({ pr: 'none' }))).toEqual({ step: 'none', why: 'no-release-pr' });
    expect(releasePrepareNext(readings({ pr: row({ headSha: undefined }) }))).toEqual({ step: 'hold', reason: 'unaskable' });
  });

  it('holds where the runs could not be read and says why while they fail', () => {
    expect(releasePrepareNext(readings({ checks: { read: 'unaskable' } }))).toEqual({ step: 'hold', reason: 'unaskable' });
    const failed = { read: 'runs', runs: [{ workflow: 'CI', status: 'completed', conclusion: 'failure' }] } as const;
    expect(releasePrepareNext(readings({ checks: failed }))).toEqual({ step: 'none', why: 'checks-not-green' });
  });

  it('starts nothing for a review never asked, a review in its bound, and a spent budget', () => {
    expect(releasePrepareNext(readings({ pr: row({ plotReview: undefined }) }))).toEqual({ step: 'none', why: 'not-asked' });
    const fresh = row({ plotReview: 'pending', plotReviewAt: new Date(NOW - 1000).toISOString() });
    expect(releasePrepareNext(readings({ pr: fresh }))).toEqual({ step: 'none', why: 'review-pending' });
    const spent = readings({ pr: row(unreviewed), reviewStarts: { head: HEAD, count: 3, lastAt: NOW - 1 } });
    expect(releasePrepareNext(spent)).toEqual({ step: 'none', why: 'budget-spent' });
  });

  it('restarts a review that stayed pending past the bound or ended in error', () => {
    const stale = row({ plotReview: 'pending', plotReviewAt: new Date(NOW - 7_200_000).toISOString() });
    expect(releasePrepareNext(readings({ pr: stale }))).toEqual({ step: 'review', head: HEAD });
    expect(releasePrepareNext(readings({ pr: row({ plotReview: 'error' }) }))).toEqual({ step: 'review', head: HEAD });
    const noTime = row({ plotReview: 'pending', plotReviewAt: undefined });
    expect(releasePrepareNext(readings({ pr: noTime }))).toEqual({ step: 'none', why: 'review-pending' });
  });

  it('keeps a live run on another head from blocking a start', () => {
    const r = readings({ pr: row(unreviewed), reviewRun: { head: OLD, pid: 1, startedAt: NOW, live: true } });
    expect(releasePrepareNext(r)).toEqual({ step: 'review', head: HEAD });
  });

  it('holds on an unread scope and not as waiting when the phases are unread', () => {
    expect(releasePrepareNext(readings({ phases: 'unaskable' }))).toEqual({ step: 'hold', reason: 'unaskable' });
  });
});

describe('release changeset record, remaining arms', () => {
  it('reads a bare status, an empty list and a line of another step', () => {
    expect(lastNotifiedChangesets([line({ outcome: 'sent' })], BRANCH)).toEqual([]);
    expect(lastNotifiedChangesets([line({ outcome: 'sent: ' })], BRANCH)).toEqual([]);
    expect(lastNotifiedChangesets([line({ step: 'release-review' })], BRANCH)).toBeNull();
  });

  it('counts a changeset naming no plan as outside work', () => {
    expect(groupChangesets([{ file: 'o.md', plan: '' }], ['x'])).toEqual({ scope: [], outside: ['o.md'] });
  });
});
