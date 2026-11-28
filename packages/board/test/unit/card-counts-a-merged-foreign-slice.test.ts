import { describe, expect, it } from 'vitest';

import { HOST_BRANCH_URL_SCHEMES } from '@plot-pm/domain/adapters/host/host-branch-urls';
import { planRecord, planStoreFixture } from '@plot-pm/domain/adapters/plan-store/plan-store-fixture';
import { emptySnapshot, RepoSnapshotSchema, type Readings, type RepoSnapshot } from '@plot-pm/domain/entities/snapshot';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import { fleetViewFrom } from '@plot-pm/domain/workflows/board-view';
import { freshWalkCache } from '@plot-pm/domain/workflows/plan-walk-cache';
import type { RecordReading } from '@plot-pm/fleet/shared/snapshot-fill';
import { walkOnce, type ScanWorld } from '@plot-pm/fleet/shared/fleet-scan';

import { slicesFromPulse } from '../../src/server/board.js';
import type { FleetReading, PlanMeta } from '../../src/contract/schema.js';

const ok = <T>(value: T) => ({ ok: true as const, value });

// The shape of the AXSY plan integration-0.2 (#3762): a tracer of this
// repository, an implementation wave holding a slice that lives in another
// repository and merged there, and a third wave of this repository.
const PLAN = 'docs/plans/2026-11-25-integration-0.2.md';
const FOREIGN = 'feature/invoice-questions-views';
const LISTING = 'feature_tenant-gates\tMERGED\t-\t-\n.branches\t1\t-\t-\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n';

const claim = (branch: string, line?: string) => ({ branch, deferred: false, deferredReason: '', claimed: '', waitsOn: [], ...(line === undefined ? {} : { line }) });
const slices = [
  { name: 'Tracer', branches: [claim('feature/tenant-gates')] },
  { name: 'Implementation', branches: [claim(FOREIGN, `- \`${FOREIGN}\` — axsy-portal (Bitbucket): the views → quatico/axsy-portal#59`)] },
  { name: 'Wave 3', branches: [claim('feature/axsy-structures')] },
];
const meta = { file: `/repo/${PLAN}`, phase: 'approved', slices: slices.map((s) => ({ branches: s.branches.map((b) => b.branch) })) } as unknown as PlanMeta;

const world = (foreign: 'MERGED' | 'OPEN', record?: RecordReading): ScanWorld => ({
  repoRoot: '/repo',
  scripts: { config: async (key: string, fallback: string) => ok(key === 'Main branch' ? 'main' : fallback) } as unknown as Scripts,
  refs: {
    resolve: async () => ok('abc1234def5678'),
    listBlobs: async () => ok([{ mode: '100644', sha: 'p1', path: PLAN }]),
    branchTips: async () => ok([]),
    readBlobs: async () => ok(new Map()),
    remoteUrl: async () => ok('git@bitbucket.org:quatico/axsy-integrationlayer.git'),
    defaultBranch: async () => ok('main'),
    mergeSubjects: async () => ok([]),
    commitFiles: async () => ok([]),
    changedFiles: async () => ok([]),
    headChanges: async () => ok([]),
    commitSubjects: async () => ok([]),
    containsMany: async () => ok(new Map()),
    planAdditions: async () => ok(new Map([[PLAN, 'add1']])),
    planAuthors: async () => ok(new Map()),
  } as unknown as Refs,
  backend: async () => 'bitbucket',
  ...(record === undefined ? {} : { record }),
  walk: {
    host: {
      backend: async () => ok('bitbucket'),
      prList: async () => ok([]),
      lastRefusal: () => ({ kind: 'failed', said: '' }),
      prState: async (ref: string | number, opts?: { repo?: string }) =>
        ok(opts?.repo === undefined ? null : {
          number: Number(ref), repo: opts.repo, head: FOREIGN, base: 'develop', state: foreign,
          mergedAt: foreign === 'MERGED' ? '2026-11-27T10:00:00Z' : null, mergeCommit: '', draft: false,
          mergeable: 'unknown', review: 'none', checks: 'none', failingChecks: [], url: '', author: '',
        }),
    },
    plans: () => planStoreFixture({ plans: [planRecord({ file: PLAN, phase: 'approved', slices })] }),
    worktree: { listDir: async () => ok([]), readPlans: async () => ok([]) },
    trees: { list: async () => ok([]), fetch: async () => ok(undefined) },
    agents: {},
    processes: {},
  } as unknown as ScanWorld['walk'],
});

/** The card's slice count from the board's own scan: no fleetd. */
const withoutFleetd = async (foreign: 'MERGED' | 'OPEN') =>
  slicesFromPulse(meta, await walkOnce(world(foreign), LISTING, '', freshWalkCache()), new Map());

/** The card's slice count from the snapshot fleetd records and the channel carries. */
const fromFleetdSnapshot = async (foreign: 'MERGED' | 'OPEN') => {
  const readings: Readings = { ...emptySnapshot().readings };
  const record: RecordReading = (key, reading) => {
    (readings as Record<string, unknown>)[key] = reading;
  };
  await walkOnce(world(foreign, record), LISTING, '', freshWalkCache());
  const carried: RepoSnapshot = RepoSnapshotSchema.parse(JSON.parse(JSON.stringify({ generation: 1, readings })));
  const view = fleetViewFrom(carried, Date.now(), HOST_BRANCH_URL_SCHEMES);
  if (view.pulse === 'unknown') throw new Error('the snapshot answers no pulse');
  return slicesFromPulse(meta, view.pulse as FleetReading, new Map());
};

describe('a plan card counts the wave of a merged foreign slice complete (#3762)', () => {
  it('counts it from the board\'s own scan, with no fleetd', async () => {
    expect(await withoutFleetd('MERGED')).toMatchObject({ total: 3, complete: 2, eligible: 1 });
    expect(await withoutFleetd('OPEN')).toMatchObject({ total: 3, complete: 1, eligible: 0 });
  });

  it('counts it from a fleetd snapshot carried over the channel', async () => {
    expect(await fromFleetdSnapshot('MERGED')).toMatchObject({ total: 3, complete: 2, eligible: 1 });
    expect(await fromFleetdSnapshot('OPEN')).toMatchObject({ total: 3, complete: 1, eligible: 0 });
  });
});
