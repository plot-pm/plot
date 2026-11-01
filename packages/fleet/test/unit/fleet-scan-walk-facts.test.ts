import { describe, expect, it } from 'vitest';

import { planRecord } from '@plot-pm/domain/adapters/plan-store/plan-store-fixture';
import type { Agents } from '@plot-pm/domain/ports/agents';
import type { PlanStore } from '@plot-pm/domain/ports/plan-store';
import type { Processes } from '@plot-pm/domain/ports/processes';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Trees } from '@plot-pm/domain/ports/trees';

import { emptyWalk, withWalkRefs } from './walk-fake.js';
import { freshScanState, scanOnce, type ScanOptions, type ScanWorld } from '../../src/shared/fleet-scan.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: the in-process pulse carries the facts
 * `plot-fleet-scan.sh` measured — a branch's conflicts and changed paths, a
 * desk's dirty worktree — and the summary's `host` word the branch stage read.
 */

const ok = <T>(value: T) => ({ ok: true as const, value });
const OPTIONS: ScanOptions = { record: false };
const PLAN = 'docs/plans/2026-10-01-a-plan.md';
const MAIN_SHA = 'abc1234def5678';
const LISTING = 'feature_busy\tOPEN\t-\t-\n.branches\t1\t-\t-\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n';

/** One plan naming `feature/busy`, a branch with two commits ahead, a desk on this machine and a stalled worker. */
const busyWorld = (conflicts: readonly string[], dirty: readonly string[]): ScanWorld => {
  const plans = {
    readPlansAt: async () => ok([
      planRecord({
        file: PLAN,
        phase: 'approved',
        slices: [{ name: 'only', branches: [{ branch: 'feature/busy', deferred: false, deferredReason: '', claimed: '', waitsOn: [] }] }],
      }),
    ]),
  } as unknown as PlanStore;
  const trees = {
    list: async () => ok([{ path: '/w/busy', branch: 'feature/busy', isMain: false, detached: false, prunable: false }]),
    fetch: async () => ok(undefined),
    locked: async () => ok(false),
    unpushedCommits: async () => ok([]),
    quietSeconds: async () => ok(600),
    dirtyPaths: async () => ok(dirty),
  } as unknown as Trees;
  return {
    repoRoot: '/repo',
    scripts: {
      hostSaid: async () => ({ answer: 'unaskable', said: 'no host in this world' }),
      config: async (_key: string, fallback: string) => ok(fallback),
      planMeta: async () => ok(''),
    } as unknown as Scripts,
    refs: withWalkRefs({
      resolve: async () => ok(MAIN_SHA),
      listBlobs: async (ref: string) => ok(ref === MAIN_SHA ? [{ path: PLAN, sha: 'p1', mode: '100644' }] : []) as never,
      branchTips: async () => ok([{ branch: 'feature/busy', sha: 't1' }]) as never,
      commitSubjects: async () => ok([
        { at: 1, subject: 'feat: one', tree: 'tr2', parentTree: 'tr1' },
        { at: 2, subject: 'feat: two', tree: 'tr3', parentTree: 'tr2' },
      ]) as never,
      changedFiles: async () => ok(['src/a.ts', 'docs/b.md']),
      conflictPaths: async () => ok(conflicts),
      branchDates: async () => ok([]),
      listBranches: async () => ok([]),
    } as never),
    backend: async () => 'github',
    walk: emptyWalk({
      plans: () => plans,
      trees,
      agents: { desk: async () => ok({ question: '', markers: [], pid: '', exit: '0' }) } as unknown as Agents,
      processes: {
        workerState: async () => ok({ state: 'stalled', pid: '', exitCode: '0', activity: '' }),
      } as unknown as Processes,
    }),
  };
};

const carried = () => {
  const state = freshScanState();
  state.listing = LISTING;
  state.listingAt = Date.now();
  return state;
};

const busyRow = async (world: ScanWorld) => {
  const result = await scanOnce(world, carried(), OPTIONS);
  return result.reading.plans.flatMap((p) => p.slices.flatMap((s) => s.branches)).find((b) => b.branch === 'feature/busy')!;
};

describe('the in-process pulse carries the facts the shell measured', () => {
  it('names a wip branch\'s conflicting paths and its changed paths', async () => {
    const row = await busyRow(busyWorld(['src/a.ts'], []));
    expect(row.state).toBe('wip');
    expect(row).toMatchObject({ conflicts_known: true, conflicts: ['src/a.ts'], changed_paths: ['src/a.ts', 'docs/b.md'] });
  });

  it('reads a branch that merges cleanly as known with no conflicts', async () => {
    const row = await busyRow(busyWorld([], []));
    expect(row).toMatchObject({ conflicts_known: true, conflicts: [] });
  });

  it('reads a desk with dirty paths as local_dirty and lists them for its stalled worker', async () => {
    const row = await busyRow(busyWorld([], ['src/half.ts']));
    expect(row).toMatchObject({ worker: 'stalled', local_dirty: true, worker_dirty_paths: ['src/half.ts'] });
  });
});

describe('the summary carries the branch stage\'s host word', () => {
  it('reads failed where no listing is held and a back-off keeps the host unasked', async () => {
    const state = freshScanState();
    state.backoffUntil = Date.now() + 60_000;
    state.backoffMs = 60_000;
    const result = await scanOnce(busyWorld([], []), state, OPTIONS);
    expect(result.reading.summary.host).toBe('failed');
  });

  it('reads ok where a whole listing is carried', async () => {
    const result = await scanOnce(busyWorld([], []), carried(), OPTIONS);
    expect(result.reading.summary.host).toBe('ok');
  });
});
