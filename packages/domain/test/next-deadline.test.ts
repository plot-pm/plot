import { describe, expect, it } from 'vitest';

import { earliestDeadline, nextDeadline, type DeadlineBounds, type DeadlineReadings, type DeadlineRule } from '../src/rules/next-deadline.js';

const MIN = 60_000;
const bounds: DeadlineBounds = {
  claimStaleMs: 24 * 60 * MIN,
  sliceIdleMs: 120 * MIN,
  workerBoundMs: 480 * MIN,
  checksWaitMs: 60 * MIN,
  fixerBoundMs: 60 * MIN,
  issueRefreshMs: 2 * MIN,
  prBeatMs: MIN,
  questionEscalationMs: [15 * MIN, 60 * MIN, 240 * MIN],
  launchGraceMs: 30_000,
  launchPidBoundMs: 480 * MIN,
};
const NOW = 1_000_000_000_000;

describe('nextDeadline returns the next change time of each deadline rule', () => {
  // One row per bound: each anchored 10 s ago, so it is the only deadline. A rule that compares
  // strictly (`age > bound`) changes its answer 1 ms after anchor + bound; the others at anchor + bound.
  const anchor = NOW - 10_000;
  const rows: [DeadlineRule, DeadlineReadings, number][] = [
    ['claim-stale', { claimedAt: [anchor] }, bounds.claimStaleMs! + 1],
    ['slice-idle', { sliceIdleSince: [anchor] }, bounds.sliceIdleMs! + 1],
    ['worker-bound', { workerStartedAt: [anchor] }, bounds.workerBoundMs!],
    ['checks-wait', { checksPendingSince: [anchor] }, bounds.checksWaitMs!],
    ['fixer-bound', { fixerStartedAt: [anchor] }, bounds.fixerBoundMs!],
    ['question-escalation', { questionAskedAt: [anchor] }, 15 * MIN + 1],
    ['launch-grace', { launchedAt: [anchor] }, 30_000],
    ['launch-pid-bound', { launchedPidAt: [anchor] }, 480 * MIN],
    ['default-branch-red', { defaultBranchRedAskedAt: anchor }, bounds.checksWaitMs! + 1],
    ['default-branch-reask', { defaultBranchAskedAt: anchor }, bounds.checksWaitMs! / 2],
    ['issue-read', { issueReadAt: anchor }, bounds.issueRefreshMs!],
    ['pr-read', { prReadAt: anchor }, bounds.prBeatMs!],
  ];
  it.each(rows)('%s', (rule, readings, bound) => {
    expect(nextDeadline(readings, bounds, NOW)).toEqual({ at: anchor + bound, rule });
  });

  it('returns none for an empty estate', () => {
    expect(nextDeadline({}, bounds, NOW)).toBeNull();
    expect(nextDeadline({ defaultBranchAskedAt: null, issueReadAt: null, prReadAt: null, claimedAt: [] }, bounds, NOW)).toBeNull();
  });

  it('returns the earliest of several anchors and rules', () => {
    const found = nextDeadline({ claimedAt: [NOW, NOW - 3600_000], prReadAt: NOW - 30_000, issueReadAt: NOW }, bounds, NOW);
    expect(found).toEqual({ at: NOW - 30_000 + MIN, rule: 'pr-read' });
    expect(nextDeadline({ claimedAt: [NOW, NOW - 3600_000] }, bounds, NOW)).toEqual({
      at: NOW - 3600_000 + bounds.claimStaleMs! + 1,
      rule: 'claim-stale',
    });
  });

  it('skips a deadline at or before now and keeps the next one', () => {
    expect(nextDeadline({ prReadAt: NOW - MIN, issueReadAt: NOW - 1000 }, bounds, NOW)).toEqual({
      at: NOW - 1000 + bounds.issueRefreshMs!,
      rule: 'issue-read',
    });
    expect(nextDeadline({ prReadAt: NOW - MIN }, bounds, NOW)).toBeNull();
  });

  it('names the first rule on a tie', () => {
    expect(nextDeadline({ prReadAt: NOW, issueReadAt: NOW + MIN - bounds.issueRefreshMs! }, bounds, NOW)?.rule).toBe('issue-read');
  });

  it('names the first rung of a question past now, strictly after its age', () => {
    expect(nextDeadline({ questionAskedAt: [NOW - 20 * MIN] }, bounds, NOW)).toEqual({ at: NOW + 40 * MIN + 1, rule: 'question-escalation' });
    expect(nextDeadline({ questionAskedAt: [NOW - 15 * MIN] }, bounds, NOW)).toEqual({ at: NOW + 1, rule: 'question-escalation' });
    expect(nextDeadline({ questionAskedAt: [NOW - 5 * 60 * MIN] }, bounds, NOW)).toBeNull();
  });

  it('holds no deadline for a rule whose bound is absent', () => {
    expect(nextDeadline({ questionAskedAt: [NOW], launchedAt: [NOW], sliceIdleSince: [NOW] }, { sliceIdleMs: MIN }, NOW)).toEqual({
      at: NOW + MIN + 1,
      rule: 'slice-idle',
    });
    expect(nextDeadline({ questionAskedAt: [NOW] }, { questionEscalationMs: [] }, NOW)).toBeNull();
  });
});

describe('earliestDeadline', () => {
  it('returns the earliest of several deadlines and skips the absent ones', () => {
    expect(earliestDeadline([null, { at: 5, rule: 'pr-read' }, undefined, { at: 3, rule: 'slice-idle' }])).toEqual({ at: 3, rule: 'slice-idle' });
    expect(earliestDeadline([null, undefined])).toBeNull();
    expect(earliestDeadline([{ at: 3, rule: 'claim-stale' }, { at: 3, rule: 'pr-read' }])).toEqual({ at: 3, rule: 'claim-stale' });
  });
});
