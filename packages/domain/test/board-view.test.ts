import { describe, expect, it } from 'vitest';

import { FleetReadingSchema } from '../src/entities/fleet.js';
import type { PlanEntry, RepoSnapshot } from '../src/entities/snapshot.js';
import type { WalkValue } from '../src/entities/view-readings.js';
import { answered } from '../src/port-result.js';
import { assemblePlanWalk, fleetReading } from '../src/workflows/plan-walk-assembly.js';
import { approvalDateOf, branchAgesOf, fleetViewFrom, walkValueOf, type WalkHeader } from '../src/workflows/board-view.js';
import type { BranchStageReadings } from '../src/workflows/plan-walk-branches.js';
import type { DeskStageReadings } from '../src/workflows/plan-walk-desks.js';
import type { Estate } from '../src/workflows/plan-walk-estate.js';
import { fullSnapshot } from './fixtures/snapshot.js';

const MAIN = 'a'.repeat(40);
const TIP = 'b'.repeat(40);
const WORKTREE = '/repo/.worktrees/x';
const FILE = 'docs/plans/2026-01-01-x.md';

const record = (over: Partial<PlanEntry> = {}): PlanEntry => ({
  file: FILE,
  format: 'v2',
  phase: 'approved',
  phaseRaw: 'Approved',
  type: 'feature',
  title: 'X',
  sprint: '',
  story: '',
  assignee: '',
  branches: ['feature/x'],
  prs: [],
  deferredPrs: [],
  slices: [{ name: 'One', branches: [{ branch: 'feature/x', deferred: false, deferredReason: '', claimed: '', waitsOn: [] }] }],
  review: 'pr',
  impl: 'own branches',
  approvedRaw: '2026-01-02, Jan Wloka',
  spikeApprovedRaw: '',
  deliveredRaw: '',
  releasedRaw: '',
  startedRaw: [],
  rejectedRaw: '',
  unreadBranchItems: [],
  ...over,
});

const header: WalkHeader = {
  main: 'main',
  readRef: 'aaaaaaa',
  localHead: 'aaaaaaa',
  fetchFailed: false,
  fetchError: '',
  planDir: 'docs/plans/',
  mergeDetect: 'unaskable',
  nowSeconds: 1_000_000,
};

const estate: Estate = {
  mainSha: MAIN,
  source: 'ref',
  plans: [{ blob: { sha: 'c'.repeat(40), path: FILE, source: 'main' }, record: record() }],
  indexes: [{ index: 'active', path: 'docs/plans/active/2026-01-01-x.md', target: '../2026-01-01-x.md' }],
  dangling: [],
};

const branchStage: BranchStageReadings = {
  mainSha: MAIN,
  backend: 'github',
  origin: 'git@github.com:o/r.git',
  hostReach: 'ok',
  merges: [{ sha: 'd'.repeat(40), subject: 'Merge pull request #1 from o/feature/y' }],
  added: new Map([[FILE, 'e'.repeat(40)]]),
  branches: [
    {
      plan: FILE,
      branch: 'feature/x',
      readings: {
        deferredByPlan: false,
        refTip: TIP,
        mainTip: MAIN,
        mergeSubjectFound: false,
        hostReach: 'ok',
        pr: 'OPEN',
        prListComplete: true,
        commitsAhead: 2,
        realCommitsAhead: 2,
        waits: [],
      },
      landed: [],
      changedPaths: ['src/a.ts'],
      localAhead: 0,
    },
  ],
  listing: { rows: [{ key: 'feature/x', state: 'OPEN', checks: 'green', draft: 'false' }], complete: true, tracked: 1 },
};

const deskStage: DeskStageReadings = {
  mainSha: MAIN,
  desks: [
    {
      branch: 'feature/x',
      worktree: WORKTREE,
      desk: { question: '', markers: [], pid: '42', exit: null },
      process: { state: 'running', pid: '42', exitCode: '', activity: 'working' },
      locked: false,
      unpushed: [],
      quietSeconds: 30,
      dirty: ['src/a.ts'],
    },
  ],
};

const conflicts = new Map([['feature/x', ['src/a.ts']]]);

/** The pulse the walk assembles from its stages directly. */
const walked = () => {
  const assembled = assemblePlanWalk(
    { estate: answered(estate), branches: answered(branchStage), desks: answered(deskStage) },
    { slug: '', offer: false },
  );
  if (!assembled.ok) throw new Error('the fixture does not assemble');
  return fleetReading(assembled.value, { ...header, host: 'ok', planSource: 'ref' }, conflicts);
};

const read = <T>(value: T, readAt = 5_000) => ({ state: 'read' as const, readAt, value });

const snapshotOf = (walk: WalkValue = walkValueOf(estate, branchStage, deskStage, conflicts, header)): RepoSnapshot => {
  const base = fullSnapshot();
  return {
    generation: 3,
    readings: {
      ...base.readings,
      plans: read({ ref: 'origin/main', records: [record()] }),
      deskFiles: read({ [WORKTREE]: { question: '', markers: [], pid: '42', exit: null } }),
      workers: read({ [WORKTREE]: { state: 'running' as const, pid: '42', exitCode: '', activity: 'working' as const } }),
      walk: read(walk),
      branchDates: read([{ branch: 'feature/x', committedAt: 1_000 }]),
      ideaPlans: read({ 'idea/y': '2026-01-03-y.md' }),
      releaseVersions: read({ 'changeset-release/main': '2.0.0' }),
      unmerged: read({ branches: ['feature/x', 'feature/claim'], claimOnly: ['feature/claim'] }),
      questions: read({ 'feature/x': { firstLine: 'which?', askedAt: '2026-01-04T00:00:00Z' } }),
      prs: read([
        { number: 7, head: 'feature/x', state: 'OPEN', draft: false, checks: 'green', review: '', url: 'u7' },
        { number: 6, head: 'feature/x', state: 'CLOSED', draft: false, checks: 'none', review: '', url: 'u6' },
      ]),
    },
  };
};

describe('fleetViewFrom', () => {
  it('assembles the pulse the walk assembles from the same readings', () => {
    expect(fleetViewFrom(snapshotOf(), 0).pulse).toEqual(FleetReadingSchema.parse(walked()));
  });

  it('survives the channel: a JSON round trip changes no field of the view', () => {
    const direct = fleetViewFrom(snapshotOf(), 2_000_000);
    const carried = fleetViewFrom(JSON.parse(JSON.stringify(snapshotOf())) as RepoSnapshot, 2_000_000);
    expect(carried).toEqual(direct);
  });

  it('dates the view by the walk reading and its fetch', () => {
    const view = fleetViewFrom(snapshotOf(), 0);
    expect(view.at).toBe(5_000);
    expect(view.fetchedAt).toBe(5_000);
    const failedFetch = snapshotOf({ ...walkValueOf(estate, branchStage, deskStage, conflicts, header), header: { ...header, fetchFailed: true } });
    expect(fleetViewFrom(failedFetch, 0).fetchedAt).toBeNull();
  });

  it('measures branch ages from now and keeps the tip time', () => {
    const view = fleetViewFrom(snapshotOf(), 1_600_000);
    expect(view.ages).toEqual(new Map([['feature/x', 10]]));
    expect(view.tipAt).toEqual(new Map([['feature/x', 1_000_000]]));
  });

  it('reads the branch-URL prefix from the walk origin', () => {
    expect(fleetViewFrom(snapshotOf(), 0).branchUrlBase).toBe('https://github.com/o/r/tree/');
  });

  it('dates the approval of each plan the pulse lists', () => {
    expect(fleetViewFrom(snapshotOf(), 0).approvedAt).toEqual(new Map([['2026-01-01-x.md', Date.parse('2026-01-02T00:00:00Z')]]));
  });

  it('leaves out a plan with no dated approval and a plan the pulse does not list', () => {
    const snapshot = snapshotOf();
    snapshot.readings.plans = read({ ref: 'origin/main', records: [record({ approvedRaw: '' })] });
    expect(fleetViewFrom(snapshot, 0).approvedAt).toEqual(new Map());
  });

  it('carries the idea plans, versions, unmerged sets and questions', () => {
    const view = fleetViewFrom(snapshotOf(), 0);
    expect(view.ideaPlans).toEqual(new Map([['idea/y', '2026-01-03-y.md']]));
    expect(view.versions).toEqual(new Map([['changeset-release/main', '2.0.0']]));
    expect(view.unmerged).toEqual(new Set(['feature/x', 'feature/claim']));
    expect(view.claimOnly).toEqual(new Set(['feature/claim']));
    expect(view.questions).toEqual(new Map([['feature/x', { firstLine: 'which?', askedAt: '2026-01-04T00:00:00Z' }]]));
  });

  it('builds the three PR maps from the PR rows', () => {
    const view = fleetViewFrom(snapshotOf(), 0);
    expect([...(view.prs?.keys() ?? [])]).toEqual(['feature/x']);
    expect([...(view.prsByNumber?.keys() ?? [])]).toEqual([7, 6]);
    expect(view.prsByHead?.get('feature/x')?.number).toBe(7);
  });

  it('answers unknown, or null for the PR maps, for every reading that is not read', () => {
    const snapshot = snapshotOf();
    for (const key of ['walk', 'branchDates', 'ideaPlans', 'releaseVersions', 'unmerged', 'questions', 'prs'] as const) {
      snapshot.readings[key] = { state: 'failed', readAt: 1, reason: 'down' };
    }
    expect(fleetViewFrom(snapshot, 0)).toEqual({
      pulse: 'unknown',
      at: null,
      fetchedAt: null,
      ages: 'unknown',
      tipAt: 'unknown',
      branchUrlBase: 'unknown',
      approvedAt: 'unknown',
      ideaPlans: 'unknown',
      versions: 'unknown',
      unmerged: 'unknown',
      claimOnly: 'unknown',
      questions: 'unknown',
      prs: null,
      prsByNumber: null,
      prsByHead: null,
    });
  });

  it.each(['plans', 'deskFiles', 'workers'] as const)('answers an unknown pulse where %s is not read', (key) => {
    const snapshot = snapshotOf();
    snapshot.readings[key] = { state: 'unread' };
    expect(fleetViewFrom(snapshot, 0).pulse).toBe('unknown');
  });

  it('answers an unknown pulse where the plans reading holds another number of records than the walk read', () => {
    const snapshot = snapshotOf();
    snapshot.readings.plans = read({ ref: 'origin/main', records: [] });
    expect(fleetViewFrom(snapshot, 0).pulse).toBe('unknown');
  });

  it.each(['deskFiles', 'workers'] as const)('answers an unknown pulse where %s holds no entry for a desk the walk read', (key) => {
    const snapshot = snapshotOf();
    snapshot.readings[key] = read({});
    expect(fleetViewFrom(snapshot, 0).pulse).toBe('unknown');
  });

  it('answers an unknown pulse where a plan branch has no branch reading', () => {
    const walk = walkValueOf(estate, { ...branchStage, branches: [] }, deskStage, conflicts, header);
    expect(fleetViewFrom(snapshotOf(walk), 0).pulse).toBe('unknown');
  });

});

describe('walkValueOf', () => {
  it('records the estate source as ref where the estate names none', () => {
    const { source: _source, ...rest } = estate;
    expect(walkValueOf(rest, branchStage, deskStage, conflicts, header).estate.source).toBe('ref');
  });

  it('records no listing where the branch stage held none', () => {
    const { listing: _listing, ...rest } = branchStage;
    expect('listing' in walkValueOf(estate, rest, deskStage, conflicts, header).branches).toBe(false);
  });

  it('leaves each desk file and worker reading to their own keys', () => {
    expect(walkValueOf(estate, branchStage, deskStage, conflicts, header).desks.desks[0]).toEqual({
      branch: 'feature/x',
      worktree: WORKTREE,
      locked: false,
      unpushed: [],
      quietSeconds: 30,
      dirty: ['src/a.ts'],
    });
  });
});

describe('branchAgesOf', () => {
  it('never answers a negative age for a tip in the future', () => {
    expect(branchAgesOf([{ branch: 'b', committedAt: 2_000 }], 1_000_000).ages.get('b')).toBe(0);
  });
});

describe('approvalDateOf', () => {
  it('reads the leading date as midnight UTC', () => {
    expect(approvalDateOf(' 2026-11-08, Jan Wloka ')).toBe(Date.parse('2026-11-08T00:00:00Z'));
  });

  it('answers null for a record with no leading date', () => {
    expect(approvalDateOf('approved yesterday')).toBeNull();
  });

  it('answers null for a date that does not exist', () => {
    expect(approvalDateOf('2026-13-45')).toBeNull();
  });
});
