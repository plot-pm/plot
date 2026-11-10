import { describe, expect, it } from 'vitest';

import { nextDeadline, type DeadlineBounds, type DeadlineReadings, type DeadlineRule } from '../src/rules/next-deadline.js';

const MIN = 60_000;
const bounds: DeadlineBounds = {
  claimStaleMs: 24 * 60 * MIN,
  sliceIdleMs: 120 * MIN,
  workerBoundMs: 480 * MIN,
  checksWaitMs: 60 * MIN,
  fixerBoundMs: 60 * MIN,
  issueRefreshMs: 2 * MIN,
  prBeatMs: MIN,
};
const NOW = 1_000_000_000_000;

describe('nextDeadline returns the next change time of each deadline rule', () => {
  // One row per bound: each anchored 10 s ago, so it is the only deadline and the answer is anchor + bound.
  const anchor = NOW - 10_000;
  const rows: [DeadlineRule, DeadlineReadings, number][] = [
    ['claim-stale', { claimedAt: [anchor] }, bounds.claimStaleMs],
    ['slice-idle', { sliceIdleSince: [anchor] }, bounds.sliceIdleMs],
    ['worker-bound', { workerStartedAt: [anchor] }, bounds.workerBoundMs],
    ['checks-wait', { checksPendingSince: [anchor] }, bounds.checksWaitMs],
    ['fixer-bound', { fixerStartedAt: [anchor] }, bounds.fixerBoundMs],
    ['default-branch-reask', { defaultBranchAskedAt: anchor }, bounds.checksWaitMs / 2],
    ['issue-read', { issueReadAt: anchor }, bounds.issueRefreshMs],
    ['pr-read', { prReadAt: anchor }, bounds.prBeatMs],
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
      at: NOW - 3600_000 + bounds.claimStaleMs,
      rule: 'claim-stale',
    });
  });

  it('skips a deadline at or before now and keeps the next one', () => {
    expect(nextDeadline({ prReadAt: NOW - MIN, issueReadAt: NOW - 1000 }, bounds, NOW)).toEqual({
      at: NOW - 1000 + bounds.issueRefreshMs,
      rule: 'issue-read',
    });
    expect(nextDeadline({ prReadAt: NOW - MIN }, bounds, NOW)).toBeNull();
  });

  it('names the first rule on a tie', () => {
    expect(nextDeadline({ prReadAt: NOW, issueReadAt: NOW + MIN - bounds.issueRefreshMs }, bounds, NOW)?.rule).toBe('issue-read');
  });
});
