import { afterEach, describe, expect, it, vi } from 'vitest';

import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { planRecord } from '../src/adapters/plan-store/plan-store-fixture.js';
import { refsFixture } from '../src/adapters/refs/refs-fixture.js';
import { answered, failed, isAnswered } from '../src/port-result.js';
import type { Host } from '../src/ports/host.js';
import type { Refs } from '../src/ports/refs.js';
import type { PlanRecordBranch } from '../src/ports/plan-store.js';
import { branchState } from '../src/rules/branch-state.js';
import { allSlicesConfirmed, deliveryLanding } from '../src/rules/deliverable.js';
import { FleetReadingSchema } from '../src/entities/fleet.js';
import { readCarriedPrStates } from '../src/rules/scan-listing.js';
import { mergeWalkLimit, readBranchConflicts, readBranchReadings, stageMergeDetect, type BranchStageInput, type BranchStageReadings } from '../src/workflows/plan-walk-branches.js';
import { assemblePlanWalk, fleetReading } from '../src/workflows/plan-walk-assembly.js';
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
        'm1..t1': [
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

  it('reads no changed paths, and does not fail, where git cannot diff a branch with commits ahead', async () => {
    // `git diff main...branch` fails for a branch with no merge base; the shell's
    // `changed_paths_of` read that as no paths and kept the beat.
    const base = refsFixture({
      shas: { 'origin/main': 'm1' },
      tips: { 'feature/here': 't1' },
      commitSubjects: { 'm1..t1': [{ at: 1, subject: 'work', tree: 'b', parentTree: 'a' }] },
      additions: { [PLAN]: 'add1' },
    });
    const refs: Refs = { ...base, changedFiles: async () => failed() };
    const answer = await readBranchReadings(refs, host, estateOf(line('feature/here')), INPUT);
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    expect(answer.value.branches[0]).toMatchObject({ changedPaths: [], readings: { commitsAhead: 1 } });
  });

  it('does not fail when the host list cannot be read: the silence is spelled in hostReach and pr', async () => {
    const silent: Host = { ...host, prList: async () => failed() };
    const out = await read(world(), silent, line('feature/here'));
    expect(out.branches[0]!.readings).toMatchObject({ hostReach: 'failed', pr: 'unreadable', prListComplete: false });
  });
});

describe('readBranchReadings — how a host list is read', () => {
  const pr = (head: string, state: string, mergedAt: string | null, number = 1) =>
    ({ number, repo: '', head, base: 'main', state, mergedAt, mergeCommit: '', draft: false, mergeable: 'unknown', review: 'none', checks: 'none', failingChecks: [], url: '', author: '' }) as never;
  const base = hostFixture({ backend: 'github' });
  const refusing = (kind: 'throttled' | 'secondary' | 'auth' | 'failed' | null, said: string): Host => ({
    ...base,
    prList: async () => failed(),
    lastRefusal: () => (kind === null && said === '' ? null : ({ kind, said } as never)),
  });
  const reach = async (host: Host) => (await read(world(), host, line('feature/here'))).branches[0]!.readings.hostReach;

  it('passes a throttle and a secondary limit through, and reads a missing identity as unasked', async () => {
    expect(await reach(refusing('throttled', 'rate'))).toBe('throttled');
    expect(await reach(refusing('secondary', 'abuse'))).toBe('secondary');
    expect(await reach(refusing('failed', 'gh: not logged in'))).toBe('unasked');
    expect(await reach(refusing('failed', 'boom'))).toBe('failed');
    expect(await reach(refusing('auth', 'HTTP 401: Bad credentials'))).toBe('unasked');
    expect(await reach(refusing(null, ''))).toBe('failed');
  });

  it('reads a closed PR, a PR of another state, and a complete list with no PR', async () => {
    const host = hostFixture({
      backend: 'github',
      prs: [pr('feature/c', 'CLOSED', null, 1), pr('feature/m', 'MERGED', null, 2), pr('feature/x', 'WEIRD', null, 3), pr('feature/y', 'WEIRD', null, 4)],
    });
    const out = await read(world(), host, line('feature/c'), line('feature/m'), line('feature/x'), line('feature/none'));
    expect(out.branches.map((b) => b.readings.pr)).toEqual(['CLOSED', 'MERGED', 'CLOSED', 'none']);
    expect(out.branches[0]!.readings.prListComplete).toBe(true);
  });

  it('ranks a closed PR below a merged one for the same head', async () => {
    const host = hostFixture({ backend: 'github', prs: [pr('feature/h', 'CLOSED', null, 1), pr('feature/h', 'MERGED', '2026-10-01T00:00:00Z', 2)] });
    expect((await read(world(), host, line('feature/h'))).branches[0]!.readings.pr).toBe('MERGED');
  });

  it('keeps the first PR of a head when a later one does not outrank it', async () => {
    const host = hostFixture({ backend: 'github', prs: [pr('feature/h', 'MERGED', '2026-10-01T00:00:00Z', 1), pr('feature/h', 'CLOSED', null, 2)] });
    expect((await read(world(), host, line('feature/h'))).branches[0]!.readings.pr).toBe('MERGED');
  });

  it('proves nothing by subject for a plan with no recorded addition', async () => {
    const out = await read(world({ additions: {} }), base, line('feature/gone'));
    expect(out.branches[0]!.readings.mergeSubjectFound).toBe(false);
    expect(out.added.size).toBe(0);
  });

  it('falls back to empty backend and origin when the host and remote cannot be read', async () => {
    const host: Host = { ...base, backend: async () => failed() };
    const refs: Refs = { ...world(), remoteUrl: async () => failed() };
    const out = await read(refs, host, line('feature/here'));
    expect(out.backend).toBe('');
    expect(out.origin).toBe('');
  });

  it('reads no changed paths for a branch with a ref and no commit ahead', async () => {
    const refs = world({ commitSubjects: { 'm1..t1': [] } });
    const out = await read(refs, base, line('feature/here'));
    expect(out.branches[0]).toMatchObject({ changedPaths: [] });
    expect(out.branches[0]!.readings.commitsAhead).toBe(0);
  });

  it('skips the branches of a released plan', async () => {
    const released = estateOf(line('feature/here'));
    released.plans[0]!.record = { ...released.plans[0]!.record, phase: 'released' };
    const answer = await readBranchReadings(world(), base, released, INPUT);
    expect(isAnswered(answer) && answer.value.branches).toEqual([]);
  });

  it('reads a list row whose state word is MERGED as merged, with or without mergedAt', async () => {
    // `pr-list` rows carry the state word and no `mergedAt`; the word is the list's own answer.
    const host = hostFixture({ backend: 'github', prs: [pr('feature/z', 'MERGED', null)] });
    expect((await read(world(), host, line('feature/z'))).branches[0]!.readings.pr).toBe('MERGED');
  });

  it('neither joins nor counts a row that names no head branch', async () => {
    const host = hostFixture({ backend: 'github', prs: [pr('', 'OPEN', null)] });
    const out = await read(world(), host, line('feature/here'));
    expect(out.branches[0]!.readings).toMatchObject({ pr: 'unreadable', prListComplete: false });
    expect(out.listing).toEqual({ rows: [], complete: false, tracked: 1 });
  });

  it('asks each list call for the limit it is given, and a page at that limit is not whole', async () => {
    const limits: Array<number | undefined> = [];
    const host: Host = {
      ...hostFixture({ backend: 'github', prs: [pr('feature/a', 'OPEN', null, 1), pr('feature/b', 'OPEN', null, 2)] }),
      prList: async (_state, limit) => {
        limits.push(limit);
        return hostFixture({ backend: 'github', prs: [pr('feature/a', 'OPEN', null, 1)] }).prList('open', limit);
      },
    };
    const answer = await readBranchReadings(world(), host, estateOf(line('feature/here')), { ...INPUT, listLimit: 1 });
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    expect(limits).toEqual([1, 1]);
    expect(answer.value.branches[0]!.readings.prListComplete).toBe(false);
  });
});

describe('readBranchReadings — a listing the caller holds replaces the host list', () => {
  const counting = () => {
    const calls = { prList: 0 };
    const host: Host = {
      ...hostFixture({ backend: 'github' }),
      prList: async () => {
        calls.prList += 1;
        return failed();
      },
    };
    return { host, calls };
  };
  const LISTING = [
    'feature_open\tOPEN\tpassing\tfalse',
    'feature_gone\tMERGED\t-\t-',
    'feature_shut\tCLOSED\t-\t-',
    'feature_odd\tWEIRD\t-\t-',
    'feature_snake__case\tMERGED\t-\t-',
    '.branches\t5\t-\t-',
  ].join('\n');
  const lines = ['feature/open', 'feature/gone', 'feature/shut', 'feature/odd', 'feature/snake_case', 'feature/absent'].map((b) => line(b));

  const readWith = async (host: Host, prs: BranchStageInput['prs']) => {
    const answer = await readBranchReadings(world(), host, estateOf(...lines), { ...INPUT, prs });
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    return answer.value.branches.map((b) => b.readings);
  };

  it('answers every branch from a complete listing and never asks the host', async () => {
    const { host, calls } = counting();
    const listing = readCarriedPrStates(`${LISTING}\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n`)!;
    const readings = await readWith(host, { kind: 'listed', listing });
    expect(calls.prList).toBe(0);
    expect(readings.map((r) => r.pr)).toEqual(['OPEN', 'MERGED', 'CLOSED', 'unreadable', 'MERGED', 'none']);
    expect(readings.every((r) => r.hostReach === 'ok' && r.prListComplete)).toBe(true);
  });

  it('reads a branch with an empty name as none, since no listing key can name it', async () => {
    const { host } = counting();
    const listing = readCarriedPrStates(`${LISTING}\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n`)!;
    const answer = await readBranchReadings(world(), host, estateOf(line('')), { ...INPUT, prs: { kind: 'listed', listing } });
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    expect(answer.value.branches.map((b) => b.readings.pr)).toEqual(['none']);
  });

  it('reads a repository with no git host as unasked, without asking the host', async () => {
    const { host, calls } = counting();
    const none: Host = { ...host, ...hostFixture({ backend: 'none' }), prList: host.prList };
    const answer = await readBranchReadings(world(), none, estateOf(line('feature/x')), INPUT);
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    expect(calls.prList).toBe(0);
    expect(answer.value.hostReach).toBe('unasked');
    expect(answer.value.branches[0]?.readings.hostReach).toBe('unasked');
  });

  it('reads an unread listing as unasked where the host said it has no identity, failed otherwise', async () => {
    const { host } = counting();
    const reach = async (said: string) => {
      const answer = await readBranchReadings(world(), host, estateOf(line('feature/x')), { ...INPUT, prs: { kind: 'unread', said } });
      if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
      return answer.value.hostReach;
    };
    expect(await reach('gh: To use GitHub CLI, run: gh auth login')).toBe('unasked');
    expect(await reach('HTTP 503')).toBe('failed');
    expect(await reach('')).toBe('failed');
  });

  it('reads a branch absent from an incomplete listing as unreadable, not none', async () => {
    const { host, calls } = counting();
    const listing = readCarriedPrStates(`${LISTING}\n.list-arrived\t1\t-\t-\n`)!;
    const readings = await readWith(host, { kind: 'listed', listing });
    expect(calls.prList).toBe(0);
    expect(readings.at(-1)).toMatchObject({ pr: 'unreadable', prListComplete: false, hostReach: 'ok' });
  });

  it('reads every PR as unreadable with a failed reach where no listing is held, and never asks the host', async () => {
    const { host, calls } = counting();
    const readings = await readWith(host, { kind: 'unread' });
    expect(calls.prList).toBe(0);
    expect(readings.every((r) => r.pr === 'unreadable' && r.hostReach === 'failed')).toBe(true);
  });

  it('asks the host where no listing is handed in', async () => {
    const { host, calls } = counting();
    await readWith(host, undefined);
    expect(calls.prList).toBe(1);
  });
});

describe('readBranchReadings — a name the list does not answer is asked once', () => {
  const merged = { number: 42, repo: '', head: 'feature/gone', base: 'main', state: 'MERGED', mergedAt: null, mergeCommit: '', draft: false, mergeable: 'unknown', review: 'none', checks: 'none', failingChecks: [], url: '', author: '' } as never;
  const counting = (over: Partial<Host> = {}) => {
    const calls = { prList: 0, prState: [] as string[], backend: 0 };
    const inner = hostFixture({ backend: 'github', prs: [merged] });
    const host: Host = {
      ...inner,
      backend: async () => {
        calls.backend += 1;
        return inner.backend();
      },
      prList: async () => {
        calls.prList += 1;
        return failed();
      },
      prState: async (ref) => {
        calls.prState.push(String(ref));
        return inner.prState(ref);
      },
      ...over,
    };
    return { host, calls };
  };
  // No merge commit, so only the host can say that `feature/gone` merged.
  const quiet = (over: Partial<Parameters<typeof refsFixture>[0]> = {}) => world({ merges: [], ...over });
  const stage = async (refs: Refs, host: Host, input: Partial<BranchStageInput>, ...lines: PlanRecordBranch[]) => {
    const answer = await readBranchReadings(refs, host, estateOf(...lines), { ...INPUT, ...input });
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    return answer.value;
  };

  it('asks a refless branch and each prerequisite once, and never a branch with a ref', async () => {
    const { host, calls } = counting();
    const out = await stage(
      quiet(),
      host,
      { askAbsent: true },
      line('feature/gone'),
      line('feature/here', { waitsOn: ['feature/gone', 'feature/other'] }),
      line('feature/next', { waitsOn: ['feature/other'] }),
    );
    // `feature/next` has no ref either; `feature/other` is asked once for both waits.
    expect(calls.prState).toEqual(['feature/gone', 'feature/other', 'feature/next']);
    expect(out.branches[0]!.readings.pr).toBe('MERGED');
    expect(out.branches[1]!.readings.waits.map((w) => w.pr)).toEqual(['MERGED', 'none']);
    expect(out.branches[1]!.readings.pr).toBe('unreadable');
  });

  it('reads an ask the host refuses as unreadable', async () => {
    const { host } = counting({ prState: async () => failed() });
    const out = await stage(quiet(), host, { askAbsent: true }, line('feature/gone'));
    expect(out.branches[0]!.readings.pr).toBe('unreadable');
  });

  it('asks nothing for a refless branch a merge subject already proves', async () => {
    const { host, calls } = counting();
    await stage(world(), host, { askAbsent: true }, line('feature/gone'));
    expect(calls.prState).toEqual([]);
  });

  it('lets a complete list answer none, unless every name is to be asked', async () => {
    const listing = readCarriedPrStates('feature_here\tOPEN\t-\t-\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n')!;
    const whole = counting();
    const out = await stage(quiet(), whole.host, { askAbsent: true, prs: { kind: 'listed', listing } }, line('feature/gone'));
    expect(whole.calls.prState).toEqual([]);
    expect(out.branches[0]!.readings.pr).toBe('none');
    const always = counting();
    const asked = await stage(quiet(), always.host, { askAbsent: true, askAlways: true, prs: { kind: 'listed', listing } }, line('feature/gone'));
    expect(always.calls.prState).toEqual(['feature/gone']);
    expect(asked.branches[0]!.readings.pr).toBe('MERGED');
  });

  it('asks nothing where the stage is not told to, or the repository has no git host', async () => {
    const plain = counting();
    await stage(quiet(), plain.host, {}, line('feature/gone'));
    expect(plain.calls.prState).toEqual([]);
    const none = counting({ backend: async () => hostFixture({ backend: 'none' }).backend() });
    await stage(quiet(), none.host, { askAbsent: true }, line('feature/gone'));
    expect(none.calls.prState).toEqual([]);
  });

  it('asks the host nothing offline, and its backend only for a merge subject', async () => {
    const bare = counting();
    const out = await stage(quiet(), bare.host, { askAbsent: true, offline: true }, line('feature/gone'));
    expect(bare.calls).toEqual({ prList: 0, prState: [], backend: 0 });
    expect(out.hostReach).toBe('unasked');
    expect(out.backend).toBe('');
    const subject = counting();
    const proven = await stage(world(), subject.host, { askAbsent: true, offline: true }, line('feature/gone'));
    expect(subject.calls).toEqual({ prList: 0, prState: [], backend: 1 });
    expect(proven.branches[0]!.readings.mergeSubjectFound).toBe(true);
  });
});

describe('readBranchReadings — a subject refused for age, and a delivery candidate', () => {
  const merged = { number: 7, repo: '', head: 'feature/gone', base: 'main', state: 'MERGED', mergedAt: null, mergeCommit: '', draft: false, mergeable: 'unknown', review: 'none', checks: 'none', failingChecks: [], url: '', author: '' } as never;
  const listing = (complete: boolean) =>
    readCarriedPrStates(`feature_here\tOPEN\t-\t-\n${complete ? '.list-complete\t1\t-\t-\n' : ''}.list-arrived\t1\t-\t-\n`)!;
  const asking = () => {
    const asked: string[] = [];
    const inner = hostFixture({ backend: 'github', prs: [merged] });
    const host: Host = { ...inner, prState: async (ref) => (asked.push(String(ref)), inner.prState(ref)) };
    return { host, asked };
  };
  const stage = async (host: Host, phase: string, input: Partial<BranchStageInput>, ...lines: PlanRecordBranch[]) => {
    const estate = estateOf(...lines);
    estate.plans[0]!.record = { ...estate.plans[0]!.record, phase };
    const answer = await readBranchReadings(world(), host, estate, { ...INPUT, ...input });
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    return answer.value;
  };

  it('marks a refless branch whose every subject predates the plan, and no other', async () => {
    const old = await read(world({ ancestry: { 'mg1 add1': 'yes' } }), hostFixture({ backend: 'github' }), line('feature/gone'));
    expect(old.branches[0]!.subjectPredatesPlan).toBe(true);
    const fresh = await read(world(), hostFixture({ backend: 'github' }), line('feature/gone'));
    expect(fresh.branches[0]!.subjectPredatesPlan).toBe(false);
  });

  it('asks the host about a subject-proven branch of an approved plan whose every branch merged', async () => {
    const { host, asked } = asking();
    const out = await stage(host, 'approved', { askAbsent: true, prs: { kind: 'listed', listing: listing(false) } }, line('feature/gone'), line('feature/off', { deferred: true }));
    // `feature/off` has no ref and is asked as it is read; `feature/gone` once the plan reads as a candidate.
    expect(asked).toEqual(['feature/off', 'feature/gone']);
    expect(out.branches[0]!.readings.pr).toBe('MERGED');
  });

  it('asks nothing for a plan with an unmerged branch, an unapproved plan, or no arrived list', async () => {
    const open = asking();
    await stage(open.host, 'approved', { askAbsent: true, prs: { kind: 'listed', listing: listing(true) } }, line('feature/gone'), line('feature/here'));
    expect(open.asked).toEqual([]);
    const draft = asking();
    await stage(draft.host, 'draft', { askAbsent: true, prs: { kind: 'listed', listing: listing(true) } }, line('feature/gone'));
    expect(draft.asked).toEqual([]);
    const unread = asking();
    await stage(unread.host, 'approved', { askAbsent: true, prs: { kind: 'unread', said: 'x', reach: 'throttled' } }, line('feature/gone'));
    expect(unread.asked).toEqual([]);
  });

  it('asks nothing again for a branch the list already names merged', async () => {
    const { host, asked } = asking();
    const named = readCarriedPrStates('feature_gone\tMERGED\t-\t-\n.list-arrived\t1\t-\t-\n')!;
    await stage(host, 'approved', { askAbsent: true, prs: { kind: 'listed', listing: named } }, line('feature/gone'));
    expect(asked).toEqual([]);
  });

  it('carries a refusal reach the caller names, and reads the listing rows for --loose', async () => {
    const { host } = asking();
    const unread = await stage(host, 'approved', { prs: { kind: 'unread', said: 'x', reach: 'secondary' } }, line('feature/here'));
    expect(unread.hostReach).toBe('secondary');
    const rows = readCarriedPrStates('feature_here\tOPEN\tgreen\ttrue\nfeature_x\tWEIRD\t-\t-\nfeature_m\tMERGED\t-\t-\n.list-arrived\t1\t-\t-\n')!;
    const loose = await stage(host, 'approved', { loose: true, prs: { kind: 'listed', listing: rows } }, line('feature/here'), line('feature/x'), line('feature/m'), line('feature/none'), line(''));
    expect(loose.branches.map((b) => b.prDetail)).toEqual([
      { state: 'OPEN', checks: 'green', draft: true },
      { state: 'CLOSED', checks: 'unknown', draft: false },
      { state: 'MERGED', checks: 'unknown', draft: false },
      'no-cache',
      'no-cache',
    ]);
  });
});

describe('readBranchReadings — a subject-proven branch reads the host merge (#3055)', () => {
  const merged = { number: 7, repo: '', head: 'feature/gone', base: 'main', state: 'MERGED', mergedAt: '2026-11-03T11:17:27Z', mergeCommit: '', draft: false, mergeable: 'unknown', review: 'none', checks: 'none', failingChecks: [], url: '', author: '' } as never;
  // A complete listing that lacks the merged branch's row, as a reused listing does.
  const lacking = () => readCarriedPrStates('feature_other\tMERGED\t-\t-\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n')!;
  const asking = (prs: never[] = []) => {
    const asked: string[] = [];
    const inner = hostFixture({ backend: 'github', prs });
    const host: Host = { ...inner, prState: async (ref) => (asked.push(String(ref)), inner.prState(ref)) };
    return { host, asked };
  };
  const stage = async (host: Host, input: Partial<BranchStageInput>) => {
    const estate = estateOf(line('feature/gone'));
    const answer = await readBranchReadings(world(), host, estate, { ...INPUT, prs: { kind: 'listed', listing: lacking() }, ...input });
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    return { estate, stage: answer.value };
  };
  const pulseOf = (estate: Estate, stage: BranchStageReadings) => {
    const assembled = assemblePlanWalk(
      { estate: answered(estate), branches: answered(stage), desks: answered({ mainSha: 'm1', desks: [] }) },
      { slug: '', offer: false },
    );
    if (!assembled.ok) throw new Error('assemblePlanWalk should answer');
    const header = { main: 'main', readRef: 'm1', localHead: 'm1', fetchFailed: false, fetchError: '', planDir: 'docs/plans/', host: 'ok', mergeDetect: 'unaskable', nowSeconds: 1000 };
    return FleetReadingSchema.parse(fleetReading(assembled.value, header as never));
  };

  it('reads MERGED from the PR index where the listing lacks the row, and the plan reads deliverable', async () => {
    const { host, asked } = asking();
    const { estate, stage: out } = await stage(host, { indexMerged: new Set(['feature/gone']) });
    expect(asked).toEqual([]);
    expect(out.branches[0]!.readings).toMatchObject({ mergeSubjectFound: true, pr: 'MERGED' });
    const pulse = pulseOf(estate, out);
    expect(pulse.plans[0]!.slices[0]!.branches[0]!.evidence).toBeUndefined();
    expect(allSlicesConfirmed({ file: PLAN }, pulse, true)).toBe('merged');
  });

  it('asks the host for a candidate\'s subject-proven branch even where the listing is complete', async () => {
    const { host, asked } = asking([merged]);
    const { estate, stage: out } = await stage(host, { askAbsent: true });
    expect(asked).toEqual(['feature/gone']);
    expect(out.branches[0]!.readings.pr).toBe('MERGED');
    expect(allSlicesConfirmed({ file: PLAN }, pulseOf(estate, out), true)).toBe('merged');
  });

  it('keeps the subject evidence where neither the index nor the host confirms the merge', async () => {
    const { host, asked } = asking();
    const { estate, stage: out } = await stage(host, { indexMerged: new Set(['feature/other']) });
    expect(asked).toEqual([]);
    expect(out.branches[0]!.readings.pr).toBe('none');
    const pulse = pulseOf(estate, out);
    expect(pulse.plans[0]!.slices[0]!.branches[0]!.evidence).toBe('subject');
    expect(allSlicesConfirmed({ file: PLAN }, pulse, true)).toBe('unknown');
    const silent = asking();
    const unasked = await stage(silent.host, { askAbsent: true });
    expect(silent.asked).toEqual(['feature/gone']);
    expect(unasked.stage.branches[0]!.readings.pr).toBe('none');
    expect(pulseOf(unasked.estate, unasked.stage).plans[0]!.slices[0]!.branches[0]!.evidence).toBe('subject');
  });

  it('never reads the index for a branch with a ref, one no subject proves, or one with an open row', async () => {
    const { host } = asking();
    const index = new Set(['feature/here', 'feature/gone', 'feature/quiet']);
    const withRef = await readBranchReadings(world(), host, estateOf(line('feature/here'), line('feature/quiet')), { ...INPUT, prs: { kind: 'listed', listing: lacking() }, indexMerged: index });
    if (!isAnswered(withRef)) throw new Error('readBranchReadings should answer');
    expect(withRef.value.branches.map((b) => b.readings.pr)).toEqual(['none', 'none']);
    const open = readCarriedPrStates('feature_gone\tOPEN\t-\t-\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n')!;
    const reopened = await stage(host, { indexMerged: index, prs: { kind: 'listed', listing: open } });
    expect(reopened.stage.branches[0]!.readings.pr).toBe('OPEN');
  });

  // A REUSED LISTING CAN STILL CARRY THE OPEN ROW of a PR that merged since it
  // was read. Measured 2026-11-06: PR #3105 merged and its index row read
  // MERGED, while fleetd's carried listing kept the OPEN row, so its plan read
  // `evidence: subject` and auto-deliver never picked it up.
  it('reads MERGED from the index over a stale OPEN listing row where the index holds no OPEN row', async () => {
    const { host, asked } = asking();
    const open = readCarriedPrStates('feature_gone\tOPEN\t-\t-\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n')!;
    const { estate, stage: out } = await stage(host, { indexMerged: new Set(['feature/gone']), indexOpen: new Set(), prs: { kind: 'listed', listing: open } });
    expect(asked).toEqual([]);
    expect(out.branches[0]!.readings.pr).toBe('MERGED');
    const pulse = pulseOf(estate, out);
    expect(pulse.plans[0]!.slices[0]!.branches[0]!.evidence).toBeUndefined();
    expect(deliveryLanding({ file: PLAN }, pulse, true)).toBe('merged');
  });

  it('keeps the subject evidence where the index holds an OPEN row for the head beside its merged row', async () => {
    const { host } = asking();
    const { estate, stage: out } = await stage(host, { indexMerged: new Set(['feature/gone']), indexOpen: new Set(['feature/gone']) });
    expect(out.branches[0]!.readings.pr).toBe('none');
    const pulse = pulseOf(estate, out);
    expect(pulse.plans[0]!.slices[0]!.branches[0]!.evidence).toBe('subject');
    expect(deliveryLanding({ file: PLAN }, pulse, true)).toBe('merge-unconfirmed');
  });

  it('refuses as merge-unconfirmed where neither the index nor the host confirms the merge', async () => {
    const { host } = asking();
    const { estate, stage: out } = await stage(host, { indexMerged: new Set(), indexOpen: new Set() });
    const pulse = pulseOf(estate, out);
    expect(deliveryLanding({ file: PLAN }, pulse, true)).toBe('merge-unconfirmed');
    expect(deliveryLanding({ file: PLAN }, null, true)).toBe('scan-incomplete');
  });
});

describe('mergeWalkLimit', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads a positive PLOT_MERGE_SCAN_LIMIT, and the default for anything else', () => {
    vi.stubEnv('PLOT_MERGE_SCAN_LIMIT', '7');
    expect(mergeWalkLimit()).toBe(7);
    vi.stubEnv('PLOT_MERGE_SCAN_LIMIT', '0');
    expect(mergeWalkLimit()).toBe(20000);
    vi.stubEnv('PLOT_MERGE_SCAN_LIMIT', 'many');
    expect(mergeWalkLimit()).toBe(20000);
  });
});

describe('readBranchReadings — the local branch ahead of its remote', () => {
  const host = hostFixture({ backend: 'github' });
  const withLocal = (local: Record<string, string> | null, over: Partial<Parameters<typeof refsFixture>[0]> = {}): Refs => {
    const base = world(over);
    return {
      ...base,
      branchTips: async (patterns) =>
        patterns.includes('refs/heads/')
          ? local === null ? failed() : ({ ok: true, value: Object.entries(local).map(([branch, sha]) => ({ branch, sha })) } as never)
          : base.branchTips(patterns),
    };
  };
  const ahead = async (refs: Refs) => (await read(refs, host, line('feature/here'))).branches[0]!.localAhead;

  it('counts the local commits the remote ref does not hold, by oid', async () => {
    const refs = withLocal({ 'feature/here': 'l1' }, { commitSubjects: { 't1..l1': [{ at: 1, subject: 'unpushed', tree: 'b', parentTree: 'a' }] } });
    expect(await ahead(refs)).toBe(1);
  });

  it('reads 0 where the local head is the remote tip, absent, unreadable, or not countable', async () => {
    expect(await ahead(withLocal({ 'feature/here': 't1' }))).toBe(0);
    expect(await ahead(withLocal({}))).toBe(0);
    expect(await ahead(withLocal(null))).toBe(0);
    const refs = withLocal({ 'feature/here': 'l1' });
    expect(await ahead({ ...refs, commitSubjects: async (range) => (range === 't1..l1' ? failed() : refs.commitSubjects(range)) })).toBe(0);
  });
});

describe('readBranchReadings — the stage carries its host reach', () => {
  it('names ok for a listing, failed for no listing, and the refusal for a refused host', async () => {
    const stage = async (host: Host, prs: BranchStageInput['prs']) => {
      const answer = await readBranchReadings(world(), host, estateOf(line('feature/here')), { ...INPUT, prs });
      if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
      return answer.value.hostReach;
    };
    const base = hostFixture({ backend: 'github' });
    expect(await stage(base, { kind: 'listed', listing: { states: new Map(), complete: true, rows: [] } })).toBe('ok');
    expect(await stage(base, { kind: 'unread' })).toBe('failed');
    expect(await stage({ ...base, prList: async () => failed(), lastRefusal: () => ({ kind: 'throttled', said: '' }) as never }, undefined)).toBe('throttled');
  });
});

describe('readBranchConflicts — which branches are asked', () => {
  const candidate = (branch: string, state: string, refHeld = true, changedPaths: string[] = ['src/x.ts']) =>
    ({ branch, state, refHeld, changedPaths });

  it('asks each wip or claimed branch with a ref and changed paths once, and leaves an unanswered one unknown', async () => {
    const asked: string[] = [];
    const refs: Refs = {
      ...world(),
      conflictPaths: async (base: string, branch: string) => {
        asked.push(`${base} ${branch}`);
        if (branch === 'origin/feature/broken') return failed();
        return { ok: true as const, value: branch === 'origin/feature/clash' ? ['src/x.ts'] : [] };
      },
    };
    const known = await readBranchConflicts(refs, 'main', [
      candidate('feature/clash', 'wip'),
      candidate('feature/clash', 'wip'),
      candidate('feature/clean', 'claimed'),
      candidate('feature/broken', 'wip'),
      candidate('feature/open', 'open'),
      candidate('feature/merged', 'merged'),
      candidate('feature/gone', 'wip', false),
      candidate('feature/claim', 'claimed', true, []),
    ]);
    expect(asked).toEqual(['origin/main origin/feature/clash', 'origin/main origin/feature/clean', 'origin/main origin/feature/broken']);
    expect([...known]).toEqual([['feature/clash', ['src/x.ts']], ['feature/clean', []]]);
  });
});

describe('readBranchReadings — a worktree estate has no default-branch ref', () => {
  it('asks no merge walk, additions, ancestry or commit range, and reads mainTip null', async () => {
    const asked: string[] = [];
    const tracked = (name: string) => async () => {
      asked.push(name);
      return failed<never>();
    };
    const refs: Refs = {
      ...world(),
      mergeSubjects: tracked('mergeSubjects'),
      planAdditions: tracked('planAdditions'),
      commitSubjects: tracked('commitSubjects'),
      changedFiles: tracked('changedFiles'),
    };
    const estate: Estate = { ...estateOf(line('feature/here'), line('feature/gone', { commits: ['abc1234'] }), line('feature/bare')), mainSha: '', source: 'worktree' };
    const answer = await readBranchReadings(refs, hostFixture({ backend: 'none' }), estate, INPUT);
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    expect(asked).toEqual([]);
    const [here, gone, bare] = answer.value.branches;
    expect(bare!.landed).toEqual([]);
    expect(here!.readings).toMatchObject({ refTip: 't1', mainTip: null, commitsAhead: 0, mergeSubjectFound: false });
    expect(gone!.landed).toEqual([{ commit: 'abc1234', contained: 'unknown' }]);
    expect(branchState(here!.readings)).toBe('unknown');
    expect(branchState(gone!.readings)).toBe('open');
  });
});

describe('stageMergeDetect', () => {
  const stageOf = (refTip: string | null, merges: BranchStageReadings['merges']): BranchStageReadings =>
    ({ backend: 'github', merges, branches: [{ plan: PLAN, branch: 'feature/x', readings: { refTip } }] }) as unknown as BranchStageReadings;

  it('asks about a reported plan\'s refless branch and reads the walk', () => {
    expect(stageMergeDetect(stageOf(null, [GITHUB_MERGE]), new Set([PLAN]))).toBe('pr-merge');
    expect(stageMergeDetect(stageOf(null, Array.from({ length: 20000 }, () => GITHUB_MERGE)), new Set([PLAN]))).toBe('truncated');
  });

  it('answers unaskable where the refless branch belongs to no reported plan, or every branch has a ref', () => {
    expect(stageMergeDetect(stageOf(null, [GITHUB_MERGE]), new Set())).toBe('unaskable');
    expect(stageMergeDetect(stageOf('t1', [GITHUB_MERGE]), new Set([PLAN]))).toBe('unaskable');
  });
});

describe('readBranchReadings — --loose reads each branch\'s PR detail', () => {
  const pr = (head: string) =>
    ({ number: 1, repo: '', head, base: 'main', state: 'OPEN', mergedAt: null, mergeCommit: '', draft: true, mergeable: 'unknown', review: 'none', checks: 'green', failingChecks: [], url: '', author: '' }) as never;
  const detail = async (host: Host, prs?: BranchStageInput['prs']) => {
    const answer = await readBranchReadings(world(), host, estateOf(line('feature/here'), line('feature/none')), { ...INPUT, loose: true, ...(prs === undefined ? {} : { prs }) });
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    return answer.value.branches.map((b) => b.prDetail);
  };

  it('reads a listed PR\'s state, checks and draft flag, and none for a branch with no PR', async () => {
    expect(await detail(hostFixture({ backend: 'github', prs: [pr('feature/here')] }))).toEqual([{ state: 'OPEN', checks: 'green', draft: true }, 'none']);
  });

  it('reads no-host where the list failed, and no-cache where the caller carried the listing', async () => {
    expect(await detail({ ...hostFixture({ backend: 'github' }), prList: async () => failed() })).toEqual(['no-host', 'no-host']);
    expect(await detail(hostFixture({ backend: 'github' }), { kind: 'listed', listing: { states: new Map(), complete: true, rows: [] } })).toEqual(['no-cache', 'no-cache']);
    expect(await detail(hostFixture({ backend: 'github' }), { kind: 'unread' })).toEqual(['no-host', 'no-host']);
  });

  it('reads no-cache for a branch absent from a list cut at its limit', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => pr(`feature/other-${i}`));
    expect((await detail(hostFixture({ backend: 'github', prs: full })))[1]).toBe('no-cache');
  });
});

describe('readBranchReadings — onPlan', () => {
  it('hands each plan its own branches once they are read', async () => {
    const seen: string[] = [];
    const answer = await readBranchReadings(world(), hostFixture({ backend: 'github' }), estateOf(line('feature/here'), line('feature/gone')), {
      ...INPUT,
      onPlan: (plan, branches) => {
        seen.push(`${plan} ${branches.map((b) => b.branch).join(',')}`);
      },
    });
    expect(isAnswered(answer)).toBe(true);
    expect(seen).toEqual([`${PLAN} feature/here,feature/gone`]);
  });
});

describe('readBranchReadings — the stage reports its PR listing', () => {
  const pr = (head: string, checks: string, draft: boolean) =>
    ({ number: 1, repo: '', head, base: 'main', state: 'OPEN', mergedAt: null, mergeCommit: '', draft, mergeable: 'unknown', review: 'none', checks, failingChecks: [], url: '', author: '' }) as never;
  const listingOf = async (host: Host, prs?: BranchStageInput['prs']) => {
    const answer = await readBranchReadings(world(), host, estateOf(line('feature/here')), { ...INPUT, ...(prs === undefined ? {} : { prs }) });
    if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
    return answer.value.listing;
  };

  it('reports the host list with encoded keys, and a dash where the row carried no rollup', async () => {
    const listing = await listingOf(hostFixture({ backend: 'github', prs: [pr('feature/a_b', 'green', false), pr('bug/c', 'unknown', false)] }));
    expect(listing?.rows).toEqual([
      { key: 'feature_a__b', state: 'OPEN', checks: 'green', draft: 'false' },
      { key: 'bug_c', state: 'OPEN', checks: '-', draft: '-' },
    ]);
    expect(listing?.complete).toBe(true);
  });

  it('reports a carried listing as it arrived', async () => {
    const carried = readCarriedPrStates('feature_one\tOPEN\tgreen\tfalse\n.list-arrived\t1\t-\t-\n')!;
    const listing = await listingOf(hostFixture({ backend: 'github' }), { kind: 'listed', listing: carried });
    expect(listing).toMatchObject({ complete: false, rows: [{ key: 'feature_one', state: 'OPEN', checks: 'green', draft: 'false' }] });
  });

  it('reports nothing where no listing arrived', async () => {
    expect(await listingOf({ ...hostFixture({ backend: 'github' }), prList: async () => failed() })).toBeUndefined();
    expect(await listingOf(hostFixture({ backend: 'github' }), { kind: 'unread' })).toBeUndefined();
  });
});
