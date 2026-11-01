import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pr } from '../src/entities/pr.js';
import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { planStoreRef } from '../src/adapters/plan-store/plan-store-ref.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';
import { failed, isAnswered } from '../src/port-result.js';
import type { Refs } from '../src/ports/refs.js';
import { readBranchConflicts, readBranchReadings } from '../src/workflows/plan-walk-branches.js';
import { readEstate } from '../src/workflows/plan-walk-estate.js';
import {
  cachedPlans,
  cachedRefs,
  freshWalkCache,
  readRefSnapshot,
  type WalkCache,
} from '../src/workflows/plan-walk-cache.js';
import { git, sandboxWith, type Sandbox } from './sandbox.js';

/**
 * THE CACHED WALK AGAINST THE COLD WALK, over successive states of one
 * temporary repository.
 *
 * Each step changes the repository one way, then reads the estate and the
 * branch stage twice: cold, through the plain ports, and incrementally, through
 * ports wrapped around ONE cache carried from step to step. The two results
 * must be byte-identical. A cache that serves a stale answer shows as a
 * disagreement naming the step.
 *
 * ON A DISAGREEMENT THE BRANCH STOPS. Weakening the comparison to make a step
 * pass is the one move forbidden.
 */

const PARSER = join('skills', 'plot', 'scripts', 'plot-plan-meta.sh');
const FULL = (n: number): string => n.toString(16).padStart(40, '0');

const planFile = (slug: string, body: string): string =>
  `# ${slug}\n\n## Status\n\n- **State:** Approved\n- **Type:** feature\n- **Impl:** own branches\n\n## Branches\n\n### Heading\n\n${body}\n`;

interface Walk {
  /** The JSON of the estate and the branch readings, or the failure word. */
  said: string;
  hits: number;
  misses: number;
}

interface Options {
  prefixes?: string[];
  prs?: Pr[];
  /** Fails `commitSubjects` for any range naming one of these: a branch and its tip, as a cold and a cached read each spell it. */
  failCommitsFor?: string[];
}

const config = (root: string, key: string, fallback: string): string =>
  execFileSync('bash', [join(root, 'skills', 'plot', 'scripts', 'plot-config.sh'), 'get', key, fallback], {
    cwd: root,
    encoding: 'utf8',
  }).trim();

const row = (head: string, over: Partial<Pr> = {}): Pr => ({
  number: 1, repo: '', head, base: 'main', state: 'OPEN', mergedAt: null, mergeCommit: '', draft: false,
  mergeable: 'mergeable' as Pr['mergeable'], review: 'none' as Pr['review'], checks: 'passing' as Pr['checks'],
  failingChecks: [], url: '', author: '', ...over,
});

/** Reads the whole walk through `wrap`, which decides whether a cache sits in front. */
const walk = async (box: Sandbox, cache: WalkCache | null, options: Options = {}): Promise<Walk> => {
  const context = shellContext(box.root);
  let refs: Refs = refsGit(context);
  if (options.failCommitsFor !== undefined) {
    const inner = refs;
    const bad = options.failCommitsFor;
    refs = { ...inner, commitSubjects: async (range, ...rest) => (bad.some((n) => range.includes(n)) ? failed() : inner.commitSubjects(range, ...rest)) } as Refs;
  }
  const plain = refs;
  let store = planStoreRef(plain, context, 'origin/main');
  if (cache !== null) {
    const snap = await readRefSnapshot(plain);
    if (!isAnswered(snap)) throw new Error('no snapshot');
    cache.begin();
    refs = cachedRefs(plain, snap.value, cache);
    const hashed = plain.hashFilesSync([join(box.root, PARSER)]);
    if (!isAnswered(hashed)) throw new Error('no parser hash');
    const prefixes = options.prefixes ?? ['feature'];
    store = cachedPlans(planStoreRef(refs, context, 'origin/main'), cache, `${hashed.value.get(join(box.root, PARSER))}\0${prefixes.join('|')}`);
  }
  const prefixes = options.prefixes ?? ['feature'];
  const planDir = config(box.root, 'Plan directory', 'docs/plans/');
  const estate = await readEstate(refs, store, {
    mainBranch: 'main',
    planDir,
    activeDir: config(box.root, 'Active index', 'docs/plans/active/'),
    deliveredDir: config(box.root, 'Delivered index', 'docs/plans/delivered/'),
    prefixes,
  });
  if (!isAnswered(estate)) return { said: `estate failed: ${estate.why}`, hits: 0, misses: 0 };
  const host = hostFixture({ backend: 'github', prs: options.prs ?? [] });
  const branches = await readBranchReadings(refs, host, estate.value, { mainBranch: 'main', planDir });
  if (!isAnswered(branches)) return { said: `branches failed: ${branches.why}`, hits: 0, misses: 0 };
  const conflicts = await readBranchConflicts(refs, 'main', branches.value.branches.map((b) => ({
    branch: b.branch, state: 'wip', refHeld: b.readings.refTip !== null, changedPaths: b.changedPaths,
  })));
  const said = JSON.stringify({ estate: estate.value, branches: branches.value, conflicts }, (_k, v) => (v instanceof Map ? [...v.entries()] : v));
  if (cache !== null) cache.sweep();
  return { said, hits: cache?.stats.hits ?? 0, misses: cache?.stats.misses ?? 0 };
};

let box: Sandbox;
let cache: WalkCache;
let branchSha = 1;

const push = (branch: string, file: string, text: string): void => {
  const w = box.root;
  git(w, 'checkout', '-q', '-B', branch, 'origin/main');
  mkdirSync(join(w, 'docs', 'plans'), { recursive: true });
  writeFileSync(join(w, file), text);
  git(w, 'add', '-A');
  git(w, 'commit', '-qm', `work on ${branch} ${branchSha++}`);
  git(w, 'push', '-q', '-f', 'origin', branch);
  git(w, 'checkout', '-q', 'main');
};

const onMain = (message: string, change: () => void): void => {
  git(box.root, 'checkout', '-q', 'main');
  change();
  git(box.root, 'add', '-A');
  git(box.root, 'commit', '-qm', message);
  git(box.root, 'push', '-q', 'origin', 'main');
  git(box.root, 'fetch', '-q', '--prune', 'origin');
};

/** Reads both ways and asserts they agree; returns the incremental read. */
const both = async (step: string, options: Options = {}): Promise<Walk> => {
  git(box.root, 'fetch', '-q', '--prune', 'origin');
  const cold = await walk(box, null, options);
  const warm = await walk(box, cache, options);
  expect(warm.said, `step "${step}": the incremental read disagrees with the cold read`).toBe(cold.said);
  return warm;
};

beforeAll(async () => {
  box = sandboxWith([], 'plot-walk-cache-');
  cache = freshWalkCache();
  const w = box.root;
  mkdirSync(join(w, 'docs', 'plans'), { recursive: true });
  writeFileSync(join(w, 'docs', 'plans', '2026-09-01-one.md'), planFile('one', '- `feature/a` — first'));
  writeFileSync(join(w, 'docs', 'plans', '2026-09-01-two.md'), planFile('two', '- `feature/b` <!-- waits: feature/a --> — second'));
  git(w, 'add', '-A');
  git(w, 'commit', '-qm', 'two plans');
  git(w, 'push', '-q', 'origin', 'main');
  push('feature/a', 'src-a.txt', 'a\n');
  push('feature/b', 'src-b.txt', 'b\n');
}, 120_000);

afterAll(() => {
  rmSync(box.dir, { recursive: true, force: true });
});

describe('the cached walk reads what the cold walk reads', () => {
  it('starts from a cold cache with the same answer, and holds every read afterwards', async () => {
    const first = await both('baseline');
    expect(first.misses).toBeGreaterThan(0);
    const second = await both('nothing changed');
    expect(second.misses).toBe(0);
    expect(second.hits).toBeGreaterThan(0);
  }, 120_000);

  it('MOVE 1: main moves while a branch stays', async () => {
    onMain('main moves', () => writeFileSync(join(box.root, 'unrelated.txt'), 'x\n'));
    const read = await both('main moves');
    expect(read.said).toContain('feature/a');
  }, 120_000);

  it('MOVE 1b: main changes a path the branch also changes, and then takes the branch whole', async () => {
    const clean = await both('before the conflict');
    expect(clean.said).toContain('["feature/b",[]]');
    onMain('main edits the branch\'s file', () => writeFileSync(join(box.root, 'src-b.txt'), 'main wrote this\n'));
    const conflicting = await both('main conflicts with the branch');
    expect(conflicting.said).toContain('["feature/b",["src-b.txt"]]');
    git(box.root, 'reset', '-q', '--hard', 'origin/main~1');
    git(box.root, 'push', '-q', '-f', 'origin', 'main');
    await both('main rewound');
  }, 120_000);

  it('MOVE 2: a ref is pruned', async () => {
    git(box.root, 'push', '-q', 'origin', '--delete', 'feature/b');
    const read = await both('ref pruned');
    expect(read.said).toContain('feature/b');
    push('feature/b', 'src-b.txt', 'b\n');
    await both('ref recreated');
  }, 120_000);

  it('MOVE 3: an active/ link is retargeted', async () => {
    onMain('link to one', () => {
      mkdirSync(join(box.root, 'docs', 'plans', 'active'), { recursive: true });
      symlinkSync('../2026-09-01-one.md', join(box.root, 'docs', 'plans', 'active', 'current.md'));
    });
    await both('link made');
    onMain('link to two', () => {
      unlinkSync(join(box.root, 'docs', 'plans', 'active', 'current.md'));
      symlinkSync('../2026-09-01-two.md', join(box.root, 'docs', 'plans', 'active', 'current.md'));
    });
    await both('link retargeted');
  }, 120_000);

  it('MOVE 4: a waits: prerequisite merges', async () => {
    const w = box.root;
    git(w, 'checkout', '-q', 'main');
    git(w, 'merge', '-q', '--no-ff', 'origin/feature/a', '-m', 'Merge pull request #7 from o/feature/a');
    git(w, 'push', '-q', 'origin', 'main');
    git(w, 'fetch', '-q', '--prune', 'origin');
    const read = await both('prerequisite merged', { prs: [row('feature/a', { number: 7, state: 'MERGED', mergedAt: '2026-10-01T00:00:00Z' })] });
    expect(read.said).toContain('feature/b');
  }, 120_000);

  it('MOVE 5: a listing row changes only its CI or draft word', async () => {
    const base = row('feature/b', { number: 9 });
    const first = await both('listing row', { prs: [base] });
    const draft = await both('listing row, draft', { prs: [{ ...base, draft: true }] });
    const red = await both('listing row, failing', { prs: [{ ...base, checks: 'failing' as Pr['checks'], failingChecks: ['CI'] }] });
    // The word changes no reading the stage takes, and the cache holds every read.
    expect(draft.said).toBe(first.said);
    expect(red.said).toBe(first.said);
    expect(red.misses).toBe(0);
  }, 120_000);

  it('MOVE 6: an unreadable commit becomes readable', async () => {
    push('feature/b', 'src-b.txt', 'b, again\n');
    const tip = git(box.root, 'rev-parse', 'origin/feature/b').trim();
    git(box.root, 'fetch', '-q', '--prune', 'origin');
    const newTip = git(box.root, 'rev-parse', 'origin/feature/b').trim();
    expect(newTip).not.toBe('');
    const unreadable = await both('commit unreadable', { failCommitsFor: ['origin/feature/b', newTip] });
    expect(unreadable.said).toMatch(/failed/);
    const readable = await both('commit readable again');
    expect(readable.said).not.toMatch(/failed/);
    expect(tip).not.toBe('');
  }, 120_000);

  it('MOVE 7: the branch prefixes change', async () => {
    push('bug/c', 'src-c.txt', 'c\n');
    await both('prefixes widened', { prefixes: ['feature', 'bug'] });
    await both('prefixes narrowed', { prefixes: ['feature'] });
  }, 120_000);

  it('MOVE 8: the parser file changes, and every plan parses again', async () => {
    await both('before parser change');
    const settled = await walk(box, cache);
    expect(settled.misses).toBe(0);
    appendFileSync(join(box.root, PARSER), '\n# parser changed\n');
    const changed = await both('parser changed');
    expect(changed.misses).toBeGreaterThan(0);
  }, 120_000);

  it('MOVE 9: main takes the first half of a branch, so the branch changes fewer paths', async () => {
    const w = box.root;
    git(w, 'checkout', '-q', '-B', 'feature/b', 'origin/feature/b');
    writeFileSync(join(w, 'src-b2.txt'), 'second half\n');
    git(w, 'add', '-A');
    git(w, 'commit', '-qm', 'second half');
    git(w, 'push', '-q', 'origin', 'feature/b');
    git(w, 'checkout', '-q', 'main');
    const whole = await both('branch has two commits');
    expect(whole.said).toContain('"src-b.txt","src-b2.txt"]');
    git(w, 'merge', '-q', '--no-ff', 'origin/feature/b~1', '-m', 'Merge pull request #8 from o/feature/b-first-half');
    git(w, 'push', '-q', 'origin', 'main');
    const half = await both('main took the first half');
    expect(half.said).toContain('"src-b2.txt"]');
    expect(half.said).not.toContain('"src-b.txt","src-b2.txt"]');
  }, 120_000);

  it('PRUNE: the entry count returns to the live estate once a plan is removed', async () => {
    await both('before removal');
    const live = cache.size();
    onMain('add a plan', () =>
      writeFileSync(join(box.root, 'docs', 'plans', '2026-09-01-three.md'), planFile('three', '- `feature/c` — third')),
    );
    await both('plan added');
    const grown = cache.size();
    expect(grown).toBeGreaterThan(live);
    onMain('remove the plan', () => unlinkSync(join(box.root, 'docs', 'plans', '2026-09-01-three.md')));
    await both('plan removed');
    expect(cache.size()).toBe(live);
  }, 120_000);
});
