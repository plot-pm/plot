import { describe, it, expect } from 'vitest';
import { refsFixture, planStoreFixture, planRecord, hostFixture } from '../src/adapters/index.js';
import {
  actualLimit,
  isAnswered,
  predictedLimit,
  type LimitReading,
  type PortResult,
} from '../src/index.js';

/**
 * The fixture adapters, asserted as adapters.
 *
 * These stand in for `Refs` and `PlanStore` on the DRIVEN side — the same port,
 * a different world behind it — so a mock board can serve a real controller
 * with no controller code knowing a mock exists. That substitution only holds
 * if they answer the way the real adapters do, which is what these assert.
 *
 * TWO THINGS EVERY CASE CHECKS: the value, and the `PortResult` wrapper it
 * arrives in. An adapter that returned a bare value would typecheck at some
 * call sites and fail at the ones that ask `isAnswered` first — and the
 * distinction between *answered*, *failed* and *unaskable* is the whole reason
 * the port is shaped this way.
 */

/**
 * Asserts a port answered, and hands back the value it carried.
 *
 * Typed through `PortResult` and narrowed by `isAnswered` rather than cast: a
 * cast would compile against a refusal, which is the one thing every test here
 * is trying to tell apart from an answer.
 */
const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

describe('refsFixture: an empty fixture still answers every method', () => {
  it('reports `main` when it was told no default branch', async () => {
    const refs = refsFixture();
    expect(answer<string>(await refs.defaultBranch())).toBe('main');
  });

  it('honours a configured default branch', async () => {
    const refs = refsFixture({ defaultBranch: 'trunk' });
    expect(answer<string>(await refs.defaultBranch())).toBe('trunk');
  });

  it('serves remote branches from the local list unless told otherwise', async () => {
    // The default is deliberate: a fixture that had to declare both lists to
    // answer either would make every caller state a fact it does not care about.
    const shared = refsFixture({ branches: ['a', 'b'] });
    expect(answer<readonly string[]>(await shared.listBranches(false))).toEqual(['a', 'b']);
    expect(answer<readonly string[]>(await shared.listBranches(true))).toEqual(['a', 'b']);

    const split = refsFixture({ branches: ['a'], remoteBranches: ['a', 'b'] });
    expect(answer<readonly string[]>(await split.listBranches(true))).toEqual(['a', 'b']);
  });
});

describe('refsFixture: merge status keeps its three answers apart', () => {
  it('answers merged, not-merged and unknown as three different things', async () => {
    // `unknown` is not `not-merged`. An unreachable host answers *not merged*
    // and silence is never permission — the fixture has to be able to express
    // the state that says nobody could be asked.
    const refs = refsFixture({ merged: ['feature/done'], unknownMerge: ['feature/dark'] });
    expect(answer<string>(await refs.isMergedByAncestry('feature/done'))).toBe('merged');
    expect(answer<string>(await refs.isMergedByAncestry('feature/other'))).toBe('not-merged');
    expect(answer<string>(await refs.isMergedByAncestry('feature/dark'))).toBe('unknown');
  });
});

describe('refsFixture: an absent reading FAILS rather than answering empty', () => {
  it('fails to resolve a ref it was not given', async () => {
    // The distinction this file exists to keep: a ref that does not resolve is
    // a failure, not an empty string. Returning '' would let a caller treat
    // "no such ref" as a valid sha.
    const refs = refsFixture({ shas: { 'origin/main': 'abc123' } });
    expect(answer<string>(await refs.resolve('origin/main'))).toBe('abc123');
    expect(isAnswered(await refs.resolve('origin/nope'))).toBe(false);
  });

  it('reports an unset pulse as UNASKABLE, not as an empty pulse', async () => {
    // `unaskable` means the question was never put. A fixture with no pulse has
    // not measured an empty estate — it has nothing to say.
    const refs = refsFixture();
    const out = await refs.pulse();
    expect(isAnswered(out)).toBe(false);
    if (!out.ok) expect(out.why).toBe('unaskable');
  });

  it('answers a configured pulse', async () => {
    const pulse = { main: 'main', head: 'abc', plans: [], summary: {} } as never;
    const refs = refsFixture({ pulse });
    expect(isAnswered(await refs.pulse())).toBe(true);
  });

  it('returns no changed files for a branch it was never told about', async () => {
    const refs = refsFixture({ changedFiles: { 'feature/x': ['a.ts'] } });
    expect(answer<readonly string[]>(await refs.changedFiles('feature/x'))).toEqual(['a.ts']);
    expect(answer<readonly string[]>(await refs.changedFiles('feature/y'))).toEqual([]);
  });
});

describe('planStoreFixture: plans are addressed by file, and a miss is a failure', () => {
  const a = planRecord({ file: 'docs/plans/a.md', phase: 'approved', title: 'A' });
  const b = planRecord({ file: 'docs/plans/b.md', phase: 'delivered', title: 'B' });

  it('lists exactly the files it holds', async () => {
    const store = planStoreFixture({ plans: [a, b] });
    expect(answer<readonly string[]>(await store.listPlans())).toEqual([
      'docs/plans/a.md',
      'docs/plans/b.md',
    ]);
  });

  it('reads one plan by file, and FAILS on a file it does not hold', async () => {
    const store = planStoreFixture({ plans: [a] });
    expect(answer<{ title: string }>(await store.readPlan('docs/plans/a.md')).title).toBe('A');
    expect(isAnswered(await store.readPlan('docs/plans/missing.md'))).toBe(false);
  });

  it('drops unknown files from a batch read rather than failing the whole batch', async () => {
    // A batch is how the board reads the estate in ONE pass. One missing file
    // must not lose the other nineteen — the caller asked for what exists.
    const store = planStoreFixture({ plans: [a, b] });
    const got = answer<readonly { file: string }[]>(
      await store.readPlans(['docs/plans/a.md', 'docs/plans/gone.md', 'docs/plans/b.md']),
    );
    expect(got.map((p) => p.file)).toEqual(['docs/plans/a.md', 'docs/plans/b.md']);
  });

  it('answers config from the fixture, and falls back where it was not set', async () => {
    const store = planStoreFixture({ config: { 'Plan directory': 'docs/plans/' } });
    expect(answer<string>(await store.config('Plan directory', 'x/'))).toBe('docs/plans/');
    expect(answer<string>(await store.config('Worktree root', '.worktrees'))).toBe('.worktrees');
  });

  it('planRecord fills every required field, so a test states only what it means', async () => {
    // The helper exists so a fixture plan does not have to declare eighteen
    // fields it does not care about — the same reason `refsFixture` defaults.
    const bare = planRecord();
    expect(bare.format).toBe('canonical');
    expect(bare.branches).toEqual([]);
    expect(bare.startedRaw).toEqual([]);
  });
});

/**
 * `hostFixture` answering the connector's limit question.
 *
 * THE FIXTURE HAS TO LEARN, or it is not a stand-in. The correction rule is
 * BEHAVIOUR rather than a value: an adapter that always answered the literal
 * input would substitute for `hostShell` on every op but this one, and a mock
 * board built on it would show a prediction that never moves.
 */
describe('hostFixture: a connector answers for its limit', () => {
  it('answers an empty list where it was told nothing — an answer, not free', async () => {
    // A fixture with no limits stands for a connector that meters nothing. It
    // is not a full budget, and a caller gets no reading rather than 5000.
    expect(answer<readonly LimitReading[]>(await hostFixture().limit())).toEqual([]);
  });

  it('serves the readings it was given, basis and all', async () => {
    const host = hostFixture({
      limits: [
        actualLimit({
          connector: 'github',
          bucket: 'graphql',
          limit: 5000,
          remaining: 1236,
          resetAt: 1_788_269_670_000,
        }),
        predictedLimit('jenkins', '', 60),
      ],
    });
    const readings = answer<readonly LimitReading[]>(await host.limit());
    expect(readings.map((r) => [r.connector, r.basis])).toEqual([
      ['github', 'actual'],
      ['jenkins', 'predicted'],
    ]);
  });

  it('LOWERS a prediction on a throttled observation', async () => {
    // The discriminating assertion, the same one `hostShell` gets: the number
    // must move. Checking that the basis is still `predicted` would pass
    // against a fixture that learns nothing.
    const host = hostFixture({ limits: [predictedLimit('jenkins', '', 60)] });
    host.observe('throttled');
    const [reading] = answer<readonly LimitReading[]>(await host.limit());
    expect(reading?.limit).toBe(30);
  });

  it('leaves an actual reading and a successful call alone', async () => {
    const measured = actualLimit({
      connector: 'github',
      bucket: 'graphql',
      limit: 5000,
      remaining: 0,
      resetAt: null,
    });
    const host = hostFixture({ limits: [measured, predictedLimit('jenkins', '', 60)] });
    host.observe('ok');
    expect(answer<readonly LimitReading[]>(await host.limit()).map((r) => r.limit)).toEqual([
      5000, 60,
    ]);
    host.observe('throttled');
    expect(answer<readonly LimitReading[]>(await host.limit()).map((r) => r.limit)).toEqual([
      5000, 30,
    ]);
  });
});
