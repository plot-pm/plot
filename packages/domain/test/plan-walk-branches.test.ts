import { describe, expect, it } from 'vitest';

import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { planRecord } from '../src/adapters/plan-store/plan-store-fixture.js';
import { refsFixture } from '../src/adapters/refs/refs-fixture.js';
import { failed, isAnswered } from '../src/port-result.js';
import type { Host } from '../src/ports/host.js';
import type { Refs } from '../src/ports/refs.js';
import type { PlanRecordBranch } from '../src/ports/plan-store.js';
import { branchState } from '../src/rules/branch-state.js';
import { readBranchReadings, type BranchStageInput } from '../src/workflows/plan-walk-branches.js';
import type { Estate } from '../src/workflows/plan-walk-estate.js';

const INPUT: BranchStageInput = { mainBranch: 'main', planDir: 'docs/plans/' };
const PLAN = 'docs/plans/2026-10-01-a-plan.md';

const line = (branch: string, over: Partial<PlanRecordBranch> = {}): PlanRecordBranch => ({
  branch,
  deferred: false,
  deferredReason: '',
  claimed: '',
  waitsOn: [],
  ...over,
});

const estateOf = (...lines: PlanRecordBranch[]): Estate => ({
  mainSha: 'm1',
  plans: [
    {
      blob: { source: 'main', path: PLAN, sha: 'p1' } as Estate['plans'][number]['blob'],
      record: planRecord({ file: PLAN, phase: 'approved', slices: [{ name: 'only', branches: lines }] }),
    },
  ],
  indexes: [],
  dangling: [],
});

const GITHUB_MERGE = { sha: 'mg1', subject: 'Merge pull request #7 from acme/feature/gone' };
const BITBUCKET_MERGE = { sha: 'mg1', subject: 'Merged in feature/gone (pull request #7)' };

const world = (over: Partial<Parameters<typeof refsFixture>[0]> = {}): Refs =>
  refsFixture({
    shas: { 'origin/main': 'm1' },
    tips: { 'feature/here': 't1' },
    remotes: { origin: 'git@github.com:acme/repo.git' },
    additions: { [PLAN]: 'add1' },
    merges: [GITHUB_MERGE],
    ancestry: { 'mg1 add1': 'no' },
    ...over,
  });

const read = async (refs: Refs, host: Host, ...lines: PlanRecordBranch[]) => {
  const answer = await readBranchReadings(refs, host, estateOf(...lines), INPUT);
  if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
  return answer.value;
};

describe('readBranchReadings — what each branch line reads', () => {
  it('reads a branch with a ref: ahead counts, changed paths, and no merge subject', async () => {
    const refs = refsFixture({
      shas: { 'origin/main': 'm1' },
      tips: { 'feature/here': 't1' },
      commitSubjects: {
        'origin/main..origin/feature/here': [
          { at: 1, subject: 'plot: claim feature/here', tree: 'a', parentTree: 'a' },
          { at: 2, subject: 'real work', tree: 'b', parentTree: 'a' },
        ],
      },
      changedFiles: { 'origin/feature/here': ['a.ts', 'b.ts'] },
      additions: { [PLAN]: 'add1' },
    });
    const out = await read(refs, hostFixture({ backend: 'github' }), line('feature/here'));
    const [only] = out.branches;
    expect(only!.readings).toMatchObject({
      refTip: 't1',
      mainTip: 'm1',
      mergeSubjectFound: false,
      commitsAhead: 2,
      realCommitsAhead: 1,
      hostReach: 'ok',
    });
    expect(only!.changedPaths).toEqual(['a.ts', 'b.ts']);
  });

  it('finds a GitHub merge subject for a branch with no ref', async () => {
    const out = await read(world(), hostFixture({ backend: 'github' }), line('feature/gone'));
    expect(out.branches[0]!.readings).toMatchObject({ refTip: null, mergeSubjectFound: true, commitsAhead: 0 });
  });

  it('finds a Bitbucket merge subject for a branch with no ref', async () => {
    const refs = world({ merges: [BITBUCKET_MERGE], remotes: { origin: 'git@bitbucket.org:acme/repo.git' } });
    const out = await read(refs, hostFixture({ backend: 'bitbucket' }), line('feature/gone'));
    expect(out.branches[0]!.readings.mergeSubjectFound).toBe(true);
  });

  it('does not read a GitHub subject on a Bitbucket backend', async () => {
    const out = await read(world(), hostFixture({ backend: 'bitbucket' }), line('feature/gone'));
    expect(out.branches[0]!.readings.mergeSubjectFound).toBe(false);
  });

  it('keeps the ref check in front: a branch with a ref never reads a merge subject', async () => {
    const refs = world({ tips: { 'feature/gone': 't9' } });
    const out = await read(refs, hostFixture({ backend: 'github' }), line('feature/gone'));
    expect(out.branches[0]!.readings).toMatchObject({ refTip: 't9', mergeSubjectFound: false });
  });

  it('refuses a merge that predates the plan, and an ancestry that cannot be read', async () => {
    const old = await read(world({ ancestry: { 'mg1 add1': 'yes' } }), hostFixture({ backend: 'github' }), line('feature/gone'));
    expect(old.branches[0]!.readings.mergeSubjectFound).toBe(false);
    const unknown = await read(world({ ancestry: {} }), hostFixture({ backend: 'github' }), line('feature/gone'));
    expect(unknown.branches[0]!.readings.mergeSubjectFound).toBe(false);
  });

  it('counts a named commit contained in main as landed, and one that is not as unlanded', async () => {
    const refs = world({ merges: [], ancestry: { 'c1 m1': 'yes', 'c2 m1': 'no' } });
    const both = await read(refs, hostFixture({ backend: 'github' }), line('feature/gone', { commits: ['c1', 'c2'] }));
    expect(both.branches[0]!.readings.mergeSubjectFound).toBe(false);
    const one = await read(refs, hostFixture({ backend: 'github' }), line('feature/gone', { commits: ['c1'] }));
    expect(one.branches[0]!.readings.mergeSubjectFound).toBe(true);
    expect(one.branches[0]!.landed).toEqual([{ commit: 'c1', contained: 'yes' }]);
  });

  it('reads a batch refusal as unknown for every entry, so nothing counts as found', async () => {
    const refs = world({ ancestry: {} });
    const out = await read(refs, hostFixture({ backend: 'github' }), line('feature/gone', { commits: ['c1'] }));
    expect(out.branches[0]!.readings.mergeSubjectFound).toBe(false);
    expect(out.branches[0]!.landed).toEqual([{ commit: 'c1', contained: 'unknown' }]);
  });

  it('reads the plan deferral and the waits with their named-slice flag', async () => {
    const refs = world();
    const out = await read(
      refs,
      hostFixture({ backend: 'github' }),
      line('feature/a', { deferred: true }),
      line('feature/b', { waitsOn: ['feature/a', 'feature/typo'] }),
    );
    expect(out.branches[0]!.readings.deferredByPlan).toBe(true);
    expect(out.branches[1]!.readings.waits).toEqual([
      { branch: 'feature/a', pr: 'unreadable', namedSlice: false },
      { branch: 'feature/typo', pr: 'unreadable', namedSlice: false },
    ]);
  });

  it('prefers an open PR over a merged one for the same head', async () => {
    const pr = (state: string, mergedAt: string | null, number: number) =>
      ({ number, repo: '', head: 'feature/here', base: 'main', state, mergedAt, mergeCommit: '', draft: false, mergeable: 'unknown', review: 'none', checks: 'none', failingChecks: [], url: '', author: '' }) as never;
    const host = hostFixture({ backend: 'github', prs: [pr('MERGED', '2026-10-01T00:00:00Z', 1), pr('OPEN', null, 2)] });
    const out = await read(world(), host, line('feature/here'));
    expect(out.branches[0]!.readings.pr).toBe('OPEN');
  });

  it('hands the readings to branchState unchanged: a refless branch with a subject is merged', async () => {
    const out = await read(world(), hostFixture({ backend: 'github' }), line('feature/gone'));
    expect(branchState(out.branches[0]!.readings)).toBe('merged');
  });
});

describe('readBranchReadings — an unreadable snapshot fails the beat', () => {
  const host = hostFixture({ backend: 'github' });
  const cases: Array<[string, Refs]> = [
    ['branch tips', { ...world(), branchTips: async () => failed() }],
    ['the merge walk', world({ failing: ['mergeSubjects'] })],
    ['the plan additions', world({ failing: ['planAdditions'] })],
    ['the ancestry batch', world({ failing: ['containsMany'] })],
    ['a commit range', world({ failing: ['commitSubjects'] })],
  ];
  for (const [name, refs] of cases) {
    it(`fails when ${name} cannot be read`, async () => {
      const lines = name === 'a commit range' ? [line('feature/here')] : [line('feature/gone')];
      expect((await readBranchReadings(refs, host, estateOf(...lines), INPUT)).ok).toBe(false);
    });
  }

  it('fails when the changed paths of a branch with commits ahead cannot be read', async () => {
    const base = refsFixture({
      shas: { 'origin/main': 'm1' },
      tips: { 'feature/here': 't1' },
      commitSubjects: { 'origin/main..origin/feature/here': [{ at: 1, subject: 'work', tree: 'b', parentTree: 'a' }] },
      additions: { [PLAN]: 'add1' },
    });
    const refs: Refs = { ...base, changedFiles: async () => failed() };
    expect((await readBranchReadings(refs, host, estateOf(line('feature/here')), INPUT)).ok).toBe(false);
  });

  it('does not fail when the host list cannot be read: the silence is spelled in hostReach and pr', async () => {
    const silent: Host = { ...host, prList: async () => failed() };
    const out = await read(world(), silent, line('feature/here'));
    expect(out.branches[0]!.readings).toMatchObject({ hostReach: 'failed', pr: 'unreadable', prListComplete: false });
  });
});
