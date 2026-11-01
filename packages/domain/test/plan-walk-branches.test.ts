import { describe, expect, it } from 'vitest';

import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { planRecord } from '../src/adapters/plan-store/plan-store-fixture.js';
import { refsFixture } from '../src/adapters/refs/refs-fixture.js';
import { failed, isAnswered } from '../src/port-result.js';
import type { Host } from '../src/ports/host.js';
import type { Refs } from '../src/ports/refs.js';
import type { PlanRecordBranch } from '../src/ports/plan-store.js';
import { branchState } from '../src/rules/branch-state.js';
import { readCarriedPrStates } from '../src/rules/scan-listing.js';
import { readBranchConflicts, readBranchReadings, type BranchStageInput } from '../src/workflows/plan-walk-branches.js';
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

describe('readBranchReadings — how a host list is read', () => {
  const pr = (head: string, state: string, mergedAt: string | null, number = 1) =>
    ({ number, repo: '', head, base: 'main', state, mergedAt, mergeCommit: '', draft: false, mergeable: 'unknown', review: 'none', checks: 'none', failingChecks: [], url: '', author: '' }) as never;
  const base = hostFixture({ backend: 'github' });
  const refusing = (kind: 'throttled' | 'secondary' | 'failed' | null, said: string): Host => ({
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
    expect(await reach(refusing(null, ''))).toBe('failed');
  });

  it('reads a closed PR, a PR of another state, and a complete list with no PR', async () => {
    const host = hostFixture({
      backend: 'github',
      prs: [pr('feature/c', 'CLOSED', null, 1), pr('feature/m', 'MERGED', null, 2), pr('feature/x', 'WEIRD', null, 3), pr('feature/y', 'WEIRD', null, 4)],
    });
    const out = await read(world(), host, line('feature/c'), line('feature/m'), line('feature/x'), line('feature/none'));
    expect(out.branches.map((b) => b.readings.pr)).toEqual(['CLOSED', 'CLOSED', 'unreadable', 'none']);
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
    const refs = world({ commitSubjects: { 'origin/main..origin/feature/here': [] } });
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

  it('reads a merged-state PR with no mergedAt as closed', async () => {
    const host = hostFixture({ backend: 'github', prs: [pr('feature/z', 'MERGED', null)] });
    expect((await read(world(), host, line('feature/z'))).branches[0]!.readings.pr).toBe('CLOSED');
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

describe('readBranchReadings — the stage carries its host reach', () => {
  it('names ok for a listing, failed for no listing, and the refusal for a refused host', async () => {
    const stage = async (host: Host, prs: BranchStageInput['prs']) => {
      const answer = await readBranchReadings(world(), host, estateOf(line('feature/here')), { ...INPUT, prs });
      if (!isAnswered(answer)) throw new Error('readBranchReadings should answer');
      return answer.value.hostReach;
    };
    const base = hostFixture({ backend: 'github' });
    expect(await stage(base, { kind: 'listed', listing: { states: new Map(), complete: true } })).toBe('ok');
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
