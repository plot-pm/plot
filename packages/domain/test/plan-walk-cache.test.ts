import { describe, expect, it } from 'vitest';

import { planRecord } from '../src/adapters/plan-store/plan-store-fixture.js';
import { answered, failed } from '../src/port-result.js';
import type { PlanStore } from '../src/ports/plan-store.js';
import type { Refs } from '../src/ports/refs.js';
import {
  cachedPlans,
  cachedRefs,
  freshWalkCache,
  readRefSnapshot,
  snapshotOf,
} from '../src/workflows/plan-walk-cache.js';

const oid = (n: number): string => n.toString(16).padStart(40, '0');
const MAIN = oid(1);
const TIP_A = oid(2);
const TIP_B = oid(3);
const MOVED = oid(9);

const entries = () => [
  { ref: 'refs/heads/main', sha: MAIN },
  { ref: 'refs/remotes/origin/HEAD', sha: MAIN },
  { ref: 'refs/remotes/origin/feature/a', sha: TIP_A },
  { ref: 'refs/remotes/origin/feature/b', sha: TIP_B },
  { ref: 'refs/remotes/origin/main', sha: MAIN },
];

/** A ref reader that records the arguments of every git read it is asked for. */
const recorder = (overrides: Partial<Refs> = {}) => {
  const calls: Array<[string, ...unknown[]]> = [];
  const note = <T>(name: string, value: T) => (...args: unknown[]) => {
    calls.push([name, ...args]);
    return Promise.resolve(answered(value));
  };
  const refs = {
    resolve: note('resolve', MAIN),
    branchTips: note('branchTips', []),
    listBlobs: note('listBlobs', [{ mode: '100644', sha: oid(20), path: 'docs/plans/x.md' }]),
    readBlobs: (shas: readonly string[]) => {
      calls.push(['readBlobs', shas]);
      return Promise.resolve(answered(new Map(shas.filter((s) => s !== oid(77)).map((s) => [s, `text ${s}`] as const))));
    },
    mergeSubjects: note('mergeSubjects', [{ sha: oid(30), subject: 'Merge pull request #1 from o/feature/a' }]),
    planAdditions: note('planAdditions', new Map([['docs/plans/x.md', oid(31)]])),
    commitSubjects: note('commitSubjects', [{ at: 1, subject: 's', tree: 't', parentTree: null }]),
    changedFiles: note('changedFiles', ['src/a.ts']),
    conflictPaths: note('conflictPaths', ['src/a.ts']),
    containsMany: (pairs: ReadonlyArray<{ ancestor: string; descendant: string }>) => {
      calls.push(['containsMany', pairs]);
      return Promise.resolve(answered(pairs.map((p) => (p.ancestor === oid(66) ? 'unknown' : p.ancestor === p.descendant ? 'yes' : p.ancestor < p.descendant ? 'yes' : 'no'))));
    },
    ...overrides,
  } as unknown as Refs;
  return { refs, calls, only: (name: string) => calls.filter((c) => c[0] === name) };
};

const wrap = (inner: Refs, cache = freshWalkCache(), list = entries()) => cachedRefs(inner, snapshotOf(list), cache);

describe('the snapshot', () => {
  it('names an oid for each kind of ref name and none for a name it does not cover', () => {
    const snap = snapshotOf(entries());
    expect(snap.oidOf('origin/feature/a')).toBe(TIP_A);
    expect(snap.oidOf('refs/remotes/origin/main')).toBe(MAIN);
    expect(snap.oidOf('main')).toBe(MAIN);
    expect(snap.oidOf(oid(5))).toBe(oid(5));
    expect(snap.oidOf('HEAD')).toBeUndefined();
    expect(snap.oidOf('origin/feature/gone')).toBeUndefined();
  });

  it('changes its digest when a ref is created, deleted or moved', () => {
    const base = snapshotOf(entries()).digest;
    expect(snapshotOf([...entries(), { ref: 'refs/remotes/origin/feature/c', sha: oid(4) }]).digest).not.toBe(base);
    expect(snapshotOf(entries().slice(0, -1)).digest).not.toBe(base);
    expect(snapshotOf(entries().map((e) => (e.ref.endsWith('/a') ? { ...e, sha: MOVED } : e))).digest).not.toBe(base);
  });

  it('reads through refState once and passes a failure or a reader without one through', async () => {
    const good = await readRefSnapshot({ refState: async () => answered(entries()) } as unknown as Refs);
    expect(good.ok && good.value.oidOf('origin/main')).toBe(MAIN);
    const bad = await readRefSnapshot({ refState: async () => failed() } as unknown as Refs);
    expect(bad.ok).toBe(false);
    const none = await readRefSnapshot({} as unknown as Refs);
    expect(none.ok).toBe(false);
  });
});

describe('a ref name is read once, through the snapshot', () => {
  it('resolves a covered name from the snapshot and asks git for any other', async () => {
    const { refs, only } = recorder();
    const wrapped = wrap(refs);
    expect(await wrapped.resolve('origin/main')).toEqual(answered(MAIN));
    expect(only('resolve')).toHaveLength(0);
    await wrapped.resolve('HEAD');
    expect(only('resolve')).toHaveLength(1);
  });

  it('answers branchTips from the snapshot, as for-each-ref selects and names them', async () => {
    const { refs, only } = recorder();
    const wrapped = wrap(refs);
    const prefixed = await wrapped.branchTips(['refs/remotes/origin/']);
    expect(prefixed).toEqual(answered([
      { branch: 'origin', sha: MAIN },
      { branch: 'feature/a', sha: TIP_A },
      { branch: 'feature/b', sha: TIP_B },
      { branch: 'main', sha: MAIN },
    ]));
    const globbed = await wrapped.branchTips(['refs/remotes/origin/feature/*']);
    expect(globbed).toEqual(answered([{ branch: 'feature/a', sha: TIP_A }, { branch: 'feature/b', sha: TIP_B }]));
    const exact = await wrapped.branchTips(['refs/remotes/origin/main']);
    expect(exact).toEqual(answered([{ branch: 'main', sha: MAIN }]));
    const below = await wrapped.branchTips(['refs/remotes/origin/feature']);
    expect(below.ok && below.value).toHaveLength(2);
    expect(await wrapped.branchTips([])).toEqual(answered([]));
    expect(only('branchTips')).toHaveLength(0);
    await wrapped.branchTips(['refs/heads/']);
    expect(only('branchTips')).toHaveLength(1);
  });

  it('RACE: a ref that moves after the snapshot changes neither the key nor the object read', async () => {
    const { refs, calls } = recorder();
    const cache = freshWalkCache();
    const wrapped = wrap(refs, cache);
    // The snapshot above held feature/a at TIP_A. The ref now sits at MOVED in
    // git; nothing below may ask git about the name.
    await wrapped.commitSubjects('origin/main..origin/feature/a');
    await wrapped.changedFiles('origin/feature/a', 'main');
    await wrapped.conflictPaths('origin/main', 'origin/feature/a');
    await wrapped.mergeSubjects('origin/main', 100);
    await wrapped.planAdditions('origin/main', 'docs/plans/');
    await wrapped.listBlobs('origin/feature/a', 'docs/plans/');
    const named = calls.flatMap(([, ...args]) => args).filter((a) => typeof a === 'string' && /origin|main/.test(a));
    expect(named).toEqual([]);
    expect(calls.find((c) => c[0] === 'commitSubjects')![1]).toBe(`${MAIN}..${TIP_A}`);
    expect(calls.find((c) => c[0] === 'changedFiles')!.slice(1)).toEqual([TIP_A, MAIN]);
    expect(calls.find((c) => c[0] === 'conflictPaths')!.slice(1)).toEqual([MAIN, TIP_A]);
    // Every key the cache holds names the snapshot's oids and no other.
    const keys = [cache.ranges, cache.changed, cache.conflicts, cache.merges, cache.additions, cache.trees].flatMap((c) => c.size());
    expect(keys.reduce((a, b) => a + b, 0)).toBe(6);
    const moved = wrap(recorder().refs, cache);
    expect(await moved.commitSubjects('origin/main..origin/feature/a')).toEqual(answered([{ at: 1, subject: 's', tree: 't', parentTree: null }]));
  });
});

describe('a held answer is served without asking git', () => {
  it('reads each keyed answer once and then from the cache', async () => {
    const { refs, calls } = recorder();
    const cache = freshWalkCache();
    const wrapped = wrap(refs, cache);
    const asks = async () => {
      await wrapped.listBlobs('origin/main', 'docs/plans/');
      await wrapped.mergeSubjects('origin/main', 5);
      await wrapped.planAdditions('origin/main', 'docs/plans/');
      await wrapped.commitSubjects('origin/main..origin/feature/b');
      await wrapped.changedFiles('origin/feature/b', 'main');
      await wrapped.conflictPaths('origin/main', 'origin/feature/b');
      await wrapped.readBlobs([oid(40)]);
    };
    await asks();
    const cold = calls.length;
    cache.begin();
    await asks();
    expect(calls.length).toBe(cold);
    expect(cache.stats.misses).toBe(0);
    expect(cache.stats.hits).toBe(7);
  });

  it('asks git for a name or a range the snapshot does not cover, and caches nothing for it', async () => {
    const { refs, calls } = recorder();
    const cache = freshWalkCache();
    const wrapped = wrap(refs, cache);
    await wrapped.listBlobs('origin/feature/gone', 'docs/plans/');
    await wrapped.mergeSubjects('HEAD', 1);
    await wrapped.planAdditions('HEAD', 'd');
    await wrapped.commitSubjects('origin/main...origin/feature/a');
    await wrapped.commitSubjects('origin/main..origin/feature/gone');
    await wrapped.commitSubjects('..origin/feature/a');
    await wrapped.commitSubjects('origin/main');
    await wrapped.changedFiles('origin/feature/a');
    await wrapped.changedFiles('origin/feature/gone', 'main');
    await wrapped.conflictPaths('HEAD', 'origin/feature/a');
    expect(calls).toHaveLength(10);
    expect(cache.size()).toBe(0);
  });

  it('stores no failed read', async () => {
    const down = () => Promise.resolve(failed<never>());
    const { refs } = recorder({
      listBlobs: down, mergeSubjects: down, planAdditions: down, commitSubjects: down,
      changedFiles: down, conflictPaths: down, readBlobs: down,
    } as unknown as Partial<Refs>);
    const cache = freshWalkCache();
    const wrapped = wrap(refs, cache);
    const results = [
      await wrapped.listBlobs('origin/main', 'd'),
      await wrapped.mergeSubjects('origin/main', 1),
      await wrapped.planAdditions('origin/main', 'd'),
      await wrapped.commitSubjects('origin/main..origin/feature/a'),
      await wrapped.changedFiles('origin/feature/a', 'main'),
      await wrapped.conflictPaths('origin/main', 'origin/feature/a'),
      await wrapped.readBlobs([oid(40)]),
    ];
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(cache.size()).toBe(0);
  });

  it('keeps a blob text by oid, asks only for the oids it lacks, and never stores a short name', async () => {
    const { refs, only } = recorder();
    const cache = freshWalkCache();
    const wrapped = wrap(refs, cache);
    await wrapped.readBlobs([oid(40)]);
    const both = await wrapped.readBlobs([oid(40), oid(41), oid(77), 'abc123']);
    expect(only('readBlobs').at(-1)![1]).toEqual([oid(41), oid(77), 'abc123']);
    expect(both.ok && [...both.value.keys()]).toEqual([oid(40), oid(41), 'abc123']);
    expect(cache.blobs.size()).toBe(2);
    expect(await wrapped.readBlobs([])).toEqual(answered(new Map()));
  });
});

describe('main moves while a branch stays', () => {
  it('asks again for every reading that names main, and not for one that does not', async () => {
    const { refs, calls } = recorder();
    const cache = freshWalkCache();
    const asks = (list: ReturnType<typeof entries>) => async () => {
      const w = wrap(refs, cache, list);
      await w.mergeSubjects('origin/main', 5);
      await w.planAdditions('origin/main', 'docs/plans/');
      await w.commitSubjects('origin/main..origin/feature/a');
      await w.changedFiles('origin/feature/a', 'main');
      await w.conflictPaths('origin/main', 'origin/feature/a');
      await w.listBlobs('origin/feature/a', 'docs/plans/');
    };
    await asks(entries())();
    const before = calls.length;
    const moved = entries().map((e) => (e.sha === MAIN ? { ...e, sha: MOVED } : e));
    await asks(moved)();
    // Five readings name main and are read again; the branch's own tree is held.
    expect(calls.length - before).toBe(5);
    const names = (n: string) => calls.filter((c) => c[0] === n).length;
    expect(names('listBlobs')).toBe(1);
    for (const n of ['mergeSubjects', 'planAdditions', 'commitSubjects', 'changedFiles', 'conflictPaths']) expect(names(n)).toBe(2);
  });
});

describe('ancestry', () => {
  const pairs = (...p: Array<[number, number]>) => p.map(([a, d]) => ({ ancestor: oid(a), descendant: oid(d) }));

  it('holds a yes and a no by the pair of oids, and holds no unknown', async () => {
    const { refs, only } = recorder();
    const cache = freshWalkCache();
    const wrapped = wrap(refs, cache);
    const first = await wrapped.containsMany(pairs([1, 2], [3, 2], [66, 2]));
    expect(first).toEqual(answered(['yes', 'no', 'unknown']));
    expect(cache.contains.size()).toBe(2);
    // The unknown pair is asked again, the other two come from the cache.
    const second = await wrapped.containsMany(pairs([1, 2], [3, 2], [66, 2]));
    expect(second).toEqual(answered(['yes', 'no', 'unknown']));
    const asked = only('containsMany').filter((c) => (c[1] as Array<{ ancestor: string }>).some((x) => x.ancestor === oid(66)));
    expect(asked).toHaveLength(2);
    expect(cache.contains.get(`${oid(66)}\0${oid(2)}`)).toBeUndefined();
  });

  it('answers wholly from the cache once every pair is held', async () => {
    const { refs, only } = recorder();
    const wrapped = wrap(refs);
    await wrapped.containsMany(pairs([1, 2]));
    const before = only('containsMany').length;
    await wrapped.containsMany(pairs([1, 2]));
    // One probe asked whether git can see all history; no pair went out.
    expect(only('containsMany').length).toBe(before + 1);
    expect((only('containsMany').at(-1)![1] as unknown[]).length).toBe(1);
  });

  it('REFUSES a held answer where git cannot see all history', async () => {
    let shallow = false;
    const { refs } = recorder({
      containsMany: async (p: ReadonlyArray<{ ancestor: string; descendant: string }>) =>
        answered(p.map((x): 'yes' | 'unknown' => (shallow ? 'unknown' : x.ancestor === x.descendant ? 'yes' : 'yes'))),
    } as unknown as Partial<Refs>);
    const cache = freshWalkCache();
    const wrapped = wrap(refs, cache);
    await wrapped.containsMany(pairs([1, 2]));
    shallow = true;
    expect(await wrapped.containsMany(pairs([1, 2]))).toEqual(answered(['unknown']));
  });

  it('passes an abbreviated name through uncached and treats a failed batch or a short reply as failed', async () => {
    const { refs } = recorder();
    const cache = freshWalkCache();
    const wrapped = wrap(refs, cache);
    await wrapped.containsMany([{ ancestor: 'abc1234', descendant: oid(2) }]);
    expect(cache.contains.size()).toBe(0);
    expect(await wrapped.containsMany([])).toEqual(answered([]));

    const down = wrap(recorder({ containsMany: async () => failed() } as unknown as Partial<Refs>).refs);
    expect((await down.containsMany(pairs([1, 2]))).ok).toBe(false);
    const short = wrap(recorder({ containsMany: async () => answered([]) } as unknown as Partial<Refs>).refs);
    expect((await short.containsMany(pairs([1, 2]))).ok).toBe(false);
  });
});

describe('the parse key', () => {
  const plans = () => {
    let reads = 0;
    const store = {
      readPlansAt: async (blobs: ReadonlyArray<{ sha: string; path: string }>) => {
        reads += blobs.length;
        return answered(blobs.map((b) => planRecord({ file: b.path })));
      },
      config: async () => answered('x'),
    } as unknown as PlanStore;
    return { store, reads: () => reads };
  };
  const blobs = [{ sha: oid(50), path: 'docs/plans/a.md' }, { sha: oid(51), path: 'docs/plans/b.md' }];

  it('parses a blob once per blob, path, prefixes, parser hash and config digest', async () => {
    const { store, reads } = plans();
    const cache = freshWalkCache();
    const a = cachedPlans(store, cache, 'parser1\0cfg1');
    await a.readPlansAt(blobs, ['feature']);
    await a.readPlansAt(blobs, ['feature']);
    expect(reads()).toBe(2);
    await a.readPlansAt(blobs, ['feature', 'bug']);
    expect(reads()).toBe(4);
    await cachedPlans(store, cache, 'parser2\0cfg1').readPlansAt(blobs, ['feature']);
    expect(reads()).toBe(6);
    await cachedPlans(store, cache, 'parser1\0cfg2').readPlansAt(blobs, ['feature']);
    expect(reads()).toBe(8);
    expect(await a.config('k', 'f')).toEqual(answered('x'));
  });

  it('asks only for the blobs it lacks and keeps the answers in order', async () => {
    const { store, reads } = plans();
    const a = cachedPlans(store, freshWalkCache(), 'p');
    await a.readPlansAt([blobs[1]!], []);
    const both = await a.readPlansAt(blobs, []);
    expect(reads()).toBe(2);
    expect(both.ok && both.value.map((r) => r.file)).toEqual(['docs/plans/a.md', 'docs/plans/b.md']);
  });

  it('stores no failed parse, no short reply and no short name', async () => {
    const cache = freshWalkCache();
    const down = cachedPlans({ readPlansAt: async () => failed() } as unknown as PlanStore, cache, 'p');
    expect((await down.readPlansAt(blobs, [])).ok).toBe(false);
    const short = cachedPlans({ readPlansAt: async () => answered([]) } as unknown as PlanStore, cache, 'p');
    expect((await short.readPlansAt(blobs, [])).ok).toBe(false);
    const { store, reads } = plans();
    const named = cachedPlans(store, cache, 'p');
    await named.readPlansAt([{ sha: 'abc1234', path: 'x.md' }], []);
    await named.readPlansAt([{ sha: 'abc1234', path: 'x.md' }], []);
    expect(reads()).toBe(2);
    expect(cache.parses.size()).toBe(0);
  });
});

describe('mark and sweep', () => {
  it('returns the entry count to the live estate once a plan is gone', async () => {
    const { refs } = recorder();
    const cache = freshWalkCache();
    const beat = async (branches: string[]) => {
      cache.begin();
      const wrapped = wrap(refs, cache);
      for (const b of branches) await wrapped.commitSubjects(`origin/main..origin/${b}`);
    };
    await beat(['feature/a', 'feature/b']);
    cache.sweep();
    expect(cache.size()).toBe(2);
    await beat(['feature/a']);
    expect(cache.size()).toBe(2);
    expect(cache.sweep()).toBe(1);
    expect(cache.size()).toBe(1);
  });

  it('keeps what a beat read until a beat completes, so a timed-out beat warms the next', async () => {
    const { refs } = recorder();
    const cache = freshWalkCache();
    cache.begin();
    await wrap(refs, cache).commitSubjects('origin/main..origin/feature/a');
    // The beat times out: no sweep runs, and the next beat finds the entry.
    cache.begin();
    await wrap(refs, cache).commitSubjects('origin/main..origin/feature/a');
    expect(cache.stats.hits).toBe(1);
    expect(cache.stats.misses).toBe(0);
  });
});

describe('the Delivered record, authors, behind count and default branch', () => {
  const extras = () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const note = <T>(name: string, value: T) => (...args: unknown[]) => {
      calls.push([name, ...args]);
      return Promise.resolve(answered(value));
    };
    const overrides = {
      recordCommit: note('recordCommit', oid(50)),
      planAuthors: note('planAuthors', new Map([['docs/plans/x.md', 'Ada']])),
      countBehind: note('countBehind', 3),
      defaultBranch: note('defaultBranch', 'main'),
    } as unknown as Partial<Refs>;
    return { calls, refs: recorder(overrides).refs, count: (n: string) => calls.filter((c) => c[0] === n).length };
  };
  const withHead = (head: string, sha: string) =>
    entries().map((e) => {
      const next = e.ref === 'refs/heads/main' ? { ...e, sha } : e;
      return e.ref === head ? { ...next, head: true as const } : next;
    });

  it('reads the Delivered record once per oid and asks git again once the ref moves', async () => {
    const { refs, count } = extras();
    const cache = freshWalkCache();
    await wrap(refs, cache).recordCommit('docs/plans/x.md', 'Delivered', 'origin/main');
    await wrap(refs, cache).recordCommit('docs/plans/x.md', 'Delivered', 'origin/main');
    expect(count('recordCommit')).toBe(1);
    await wrap(refs, cache).recordCommit('docs/plans/x.md', 'Started', 'origin/main');
    expect(count('recordCommit')).toBe(2);
    const moved = entries().map((e) => (e.sha === MAIN ? { ...e, sha: MOVED } : e));
    await wrap(refs, cache, moved).recordCommit('docs/plans/x.md', 'Delivered', 'origin/main');
    expect(count('recordCommit')).toBe(3);
  });

  it('holds the plan authors by the oid of the ref', async () => {
    const { refs, count } = extras();
    const cache = freshWalkCache();
    await wrap(refs, cache).planAuthors('origin/main', 'docs/plans/');
    await wrap(refs, cache).planAuthors('origin/main', 'docs/plans/');
    expect(count('planAuthors')).toBe(1);
  });

  it('follows HEAD for the behind count, and asks git where HEAD is detached', async () => {
    const { refs, count } = extras();
    const cache = freshWalkCache();
    const attached = withHead('refs/heads/main', MAIN);
    await wrap(refs, cache, attached).countBehind('origin/feature/a');
    await wrap(refs, cache, attached).countBehind('origin/feature/a');
    expect(count('countBehind')).toBe(1);
    // A reset moves the checked-out branch; the held count must not survive it.
    await wrap(refs, cache, withHead('refs/heads/main', MOVED)).countBehind('origin/feature/a');
    expect(count('countBehind')).toBe(2);
    // No entry carries the HEAD marker: nothing is keyed, nothing is stored.
    await wrap(refs, cache).countBehind('origin/feature/a');
    await wrap(refs, cache).countBehind('origin/feature/a');
    expect(count('countBehind')).toBe(4);
  });

  it('asks again for the default branch when the refs or the checked-out branch change', async () => {
    const { refs, count } = extras();
    const cache = freshWalkCache();
    await wrap(refs, cache).defaultBranch();
    await wrap(refs, cache).defaultBranch();
    expect(count('defaultBranch')).toBe(1);
    await wrap(refs, cache, withHead('refs/heads/main', MAIN)).defaultBranch();
    expect(count('defaultBranch')).toBe(2);
  });

  it('stores no failed read of the four', async () => {
    const down = () => Promise.resolve(failed<never>());
    const { refs } = recorder({ recordCommit: down, planAuthors: down, countBehind: down, defaultBranch: down } as unknown as Partial<Refs>);
    const cache = freshWalkCache();
    const w = wrap(refs, cache, withHead('refs/heads/main', MAIN));
    const results = [
      await w.recordCommit('f', 'Delivered', 'origin/main'),
      await w.planAuthors('origin/main', 'd'),
      await w.countBehind('origin/feature/a'),
      await w.defaultBranch(),
    ];
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(cache.size()).toBe(0);
  });
});
