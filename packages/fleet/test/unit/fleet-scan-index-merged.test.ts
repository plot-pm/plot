import { describe, expect, it } from 'vitest';

import { planRecord, planStoreFixture } from '@plot-pm/domain/adapters/plan-store/plan-store-fixture';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import { allSlicesConfirmed } from '@plot-pm/domain/rules/deliverable';

import { walkOnce, type ScanWorld } from '../../src/shared/fleet-scan.js';
import { emptyWalk, withWalkRefs } from './walk-fake.js';

const ok = <T>(value: T) => ({ ok: true as const, value });

const PLAN = 'docs/plans/2026-11-01-a-plan.md';
const BRANCH = 'feature/the-fleet-payload-indexes-its-plans';

// A complete listing that lacks the branch's row, as a listing reused across beats does.
const LISTING = 'feature_other\tMERGED\t-\t-\n.branches\t1\t-\t-\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n';

const row = (head: string, state: string, draft = false): PrIndexRow =>
  ({ number: 3053, head, state, draft, checks: 'green', review: '', url: '', mergeable: 'mergeable', failing_checks: [], author: 'jwloka' }) as unknown as PrIndexRow;

/** One approved plan whose only branch has no ref and a merge subject on main, younger than the plan. */
const worldWith = (rows: readonly PrIndexRow[] | undefined): ScanWorld => ({
  repoRoot: '/repo',
  scripts: {
    config: async (key: string, fallback: string) => ok(key === 'Main branch' ? 'main' : fallback),
  } as unknown as Scripts,
  refs: withWalkRefs({
    listBlobs: async () => ok([{ mode: '100644', sha: 'p1', path: PLAN }]),
    remoteUrl: async () => ok('git@github.com:plot-pm/plot.git'),
    mergeSubjects: async () => ok([{ sha: 'mg1', subject: `Merge pull request #3053 from plot-pm/${BRANCH}` }]),
    planAdditions: async () => ok(new Map([[PLAN, 'add1']])),
    containsMany: async (pairs: readonly unknown[]) => ok(pairs.map(() => 'no')),
  } as unknown as Partial<Refs>),
  backend: async () => 'github',
  walk: emptyWalk({
    plans: () =>
      planStoreFixture({
        plans: [planRecord({ file: PLAN, phase: 'approved', slices: [{ name: 'only', branches: [{ branch: BRANCH, deferred: false, deferredReason: '', claimed: '', waitsOn: [] }] }] })],
      }),
    ...(rows === undefined ? {} : { prIndexRows: async () => rows }),
  }),
});

const branchOf = (reading: Awaited<ReturnType<typeof walkOnce>>) => reading.plans[0]!.slices[0]!.branches[0]!;

describe('walkOnce reads the PR index for a subject-proven branch (#3055)', () => {
  it('confirms the merge from a MERGED index row the listing lacks, so the plan reads deliverable', async () => {
    const reading = await walkOnce(worldWith([row(BRANCH, 'MERGED')]), LISTING);
    expect(branchOf(reading)).toMatchObject({ branch: BRANCH, state: 'merged' });
    expect(branchOf(reading).evidence).toBeUndefined();
    expect(allSlicesConfirmed({ file: PLAN }, reading, true)).toBe('merged');
  });

  it('keeps the subject evidence where the index holds no MERGED row, a draft row, or no index at all', async () => {
    for (const rows of [[], [row(BRANCH, 'OPEN')], [row(BRANCH, 'MERGED', true)], undefined]) {
      const reading = await walkOnce(worldWith(rows), LISTING);
      expect(branchOf(reading)).toMatchObject({ state: 'merged', evidence: 'subject' });
      expect(allSlicesConfirmed({ file: PLAN }, reading, true)).toBe('unknown');
    }
  });

  // A listing reused across beats still carries the OPEN row of a PR merged
  // since it was read. Measured 2026-11-06 on PR #3105: the index read MERGED,
  // the pulse kept `evidence: subject`, and auto-deliver never picked the plan.
  it('confirms the merge from a MERGED index row over a stale OPEN listing row', async () => {
    const stale = `${BRANCH.replaceAll('/', '_')}\tOPEN\t-\t-\n.branches\t1\t-\t-\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n`;
    const reading = await walkOnce(worldWith([row(BRANCH, 'MERGED')]), stale);
    expect(branchOf(reading).evidence).toBeUndefined();
    expect(allSlicesConfirmed({ file: PLAN }, reading, true)).toBe('merged');
    const reopened = await walkOnce(worldWith([row(BRANCH, 'MERGED'), { ...row(BRANCH, 'OPEN'), number: 3200 } as PrIndexRow]), stale);
    expect(branchOf(reading).state).toBe('merged');
    expect(branchOf(reopened).evidence).toBe('subject');
  });
});
