import { describe, it, expect } from 'vitest';
import {
  refsFixture,
  planStoreFixture,
  planRecord,
  hostFixture,
  buildFixture,
  buildNone,
} from '../src/adapters/index.js';
import {
  actualLimit,
  isAnswered,
  predictedLimit,
  type BuildRun,
  type LimitReading,
  type MergedAnswer,
  type PortResult,
  type Pr,
  type PrCreateRequest,
  type PrLookup,
  type ShaRun,
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

/**
 * A CONNECTOR THE DOMAIN HAS NEVER HEARD OF, DRIVEN END TO END.
 *
 * This is the proof the whole slice exists for. `HostBackend` was
 * `'github' | 'bitbucket'` until 2026-09-01 — a closed vendor list, in the
 * domain, one line long — so a third connector was not an adapter change no
 * matter what the port's own documentation said about it. Widening the type
 * removed the refusal; this asserts nothing else was refusing underneath.
 *
 * `quokka-forge` IS NOT A HOST, AND THAT IS THE POINT. `gitlab` would prove
 * less: a plausible name is one somebody eventually teaches the adapter, and
 * the test would then be passing because the vendor arrived rather than because
 * the domain stopped caring. A name with no roadmap can only pass for the
 * reason claimed.
 *
 * IT DRIVES THE WHOLE PORT, not just `backend()`. A type that admits any string
 * and a port that quietly branches on the value somewhere else would still
 * refuse a third connector, and asserting the name alone would miss it — which
 * is exactly the failure `fleet.ts` held until wave 1 removed its
 * `backend === ` expressions.
 */
describe('hostFixture: a connector the domain has never heard of', () => {
  const backend = 'quokka-forge';

  /** An estate belonging to a host Plot ships no adapter for. */
  const forge = () =>
    hostFixture({
      backend,
      merged: ['feature/landed'],
      prs: [
        {
          number: 7,
          repo: 'quokka/plot',
          head: 'feature/open',
          state: 'OPEN',
          mergedAt: null,
          mergeCommit: '',
          draft: false,
          mergeable: 'mergeable',
          review: '',
          checks: 'green',
          failingChecks: [],
          url: 'https://quokka.invalid/pr/7',
        },
      ],
      limits: [predictedLimit(backend, 'api', 100)],
    });

  it('names itself, and the port passes the word through unnarrowed', async () => {
    // The assertion the old union made impossible: this string was not a
    // `HostBackend` at all, so the fixture could not have been written.
    expect(answer<string>(await forge().backend())).toBe(backend);
  });

  it('answers every read the port defines', async () => {
    const host = forge();
    expect(answer<PrLookup>(await host.prState('feature/open'))?.number).toBe(7);
    expect(answer<PrLookup>(await host.prState(7))?.head).toBe('feature/open');
    expect(answer<MergedAnswer>(await host.prMerged('feature/landed'))).toBe('merged');
    expect(answer<MergedAnswer>(await host.prMerged('feature/open'))).toBe('not-merged');
    expect(answer<readonly Pr[]>(await host.prList('open')).map((pr) => pr.number)).toEqual([7]);
  });

  it('opens a PR, which is the one write the port allows', async () => {
    // A connector nothing was written for still gets the acting path, and the
    // URL comes back as the host stated it.
    const opened: PrCreateRequest[] = [];
    const host = hostFixture({ backend, opened });
    const url = answer<string>(
      await host.prCreate({ head: 'feature/new', title: 'A finding', body: 'What it found.' }),
    );
    expect(url).not.toBe('');
    expect(opened.map((request) => request.head)).toEqual(['feature/new']);
  });

  it('reports and corrects a limit in its own name', async () => {
    // The connector contract — a budget, and a prediction that learns — holds
    // for a host Plot has no adapter for. Nothing keys off the vendor.
    const host = forge();
    expect(answer<readonly LimitReading[]>(await host.limit())[0]?.connector).toBe(backend);
    host.observe('throttled');
    expect(answer<readonly LimitReading[]>(await host.limit())[0]?.limit).toBe(50);
  });
});

/**
 * The build fixture, and the connector it stands in for.
 *
 * The same substitution the host fixture provides, on the port that used to be
 * three of the host's operations. Two things every case checks: the value, and
 * the `PortResult` it arrives in.
 */
describe('the build fixture answers as a CI connector', () => {
  /** A run history for one branch, and two sha-pinned runs for the same one. */
  const forge = () =>
    buildFixture({
      system: 'forge-ci',
      runs: {
        'feature/open': [
          {
            workflow: 'forge',
            conclusion: 'success',
            startedAt: '2026-09-01T00:00:00Z',
            url: 'https://quokka.invalid/run/1',
          },
        ],
      },
      shaRuns: {
        'feature/open': [
          { sha: 'newest', status: 'in_progress', conclusion: null, url: '', startedAt: '' },
          { sha: 'older', status: 'completed', conclusion: 'success', url: '', startedAt: '' },
        ],
      },
      limits: [predictedLimit('forge-ci', '', 60)],
    });

  it('names the system it answers as', () => {
    expect(forge().system()).toBe('forge-ci');
  });

  it('answers every read the port defines', async () => {
    const build = forge();
    expect(answer<readonly BuildRun[]>(await build.runs('feature/open'))).toHaveLength(1);
    expect(answer<ShaRun | null>(await build.runForSha('feature/open', 'older'))?.conclusion).toBe(
      'success',
    );
    expect(answer<readonly LimitReading[]>(await build.limit())[0]?.limit).toBe(60);
    expect(build.lastRefusal()).toBeNull();
  });

  it('falls back to the newest run and SAYS which sha it found', async () => {
    // The case a caller must be able to test: a run in flight for a commit the
    // branch has moved past reads identically to no run at all unless the
    // answer names its own sha.
    const found = answer<ShaRun | null>(await forge().runForSha('feature/open', 'absent'));
    expect(found?.sha).toBe('newest');
  });

  it('answers null where the branch has no runs at all', async () => {
    // An ANSWER, and the one a caller polling a fresh push sees on every pass
    // until CI wakes up. It is not a refusal.
    const found = await forge().runForSha('feature/untouched', 'anything');
    expect(found).toEqual({ ok: true, value: null });
  });

  it('answers an empty history for a branch it holds none for', async () => {
    // Asked, and holds nothing — which `buildNone` answers differently, and
    // that difference is the whole reason both exist.
    expect(answer<readonly BuildRun[]>(await forge().runs('feature/untouched'))).toEqual([]);
  });

  it('reports the refusal that broke a read, rather than a silence', async () => {
    const build = buildFixture({ fails: true });
    expect(await build.runs('feature/open')).toEqual({ ok: false, why: 'failed' });
    expect(build.lastRefusal()).not.toBeNull();
  });
});

/**
 * A repository that declared no CI.
 *
 * NOT A FIXTURE, and asserted here beside one so the difference is legible: an
 * empty run list and an unaskable CI are different facts, and the board renders
 * them differently.
 */
describe('a repository with no CI answers unaskable everywhere', () => {
  it('refuses every operation, and names no vendor', async () => {
    const build = buildNone();
    expect(build.system()).toBe('');
    expect(await build.runs('feature/open')).toEqual({ ok: false, why: 'unaskable' });
    expect(await build.runForSha('feature/open', 'sha')).toEqual({ ok: false, why: 'unaskable' });
    expect(await build.limit()).toEqual({ ok: false, why: 'unaskable' });
  });

  it('is not refusing — there is nothing to ask', async () => {
    // A refusal counsels a wait. A CI system nobody declared will not be there
    // after one, so reporting a sentence here would send a caller into a
    // backoff over a standing configuration fact.
    const build = buildNone();
    await build.runs('feature/open');
    expect(build.lastRefusal()).toBeNull();
  });

  it('is a DIFFERENT answer from a CI holding no run for the branch', async () => {
    // THE DISCRIMINATING ASSERTION, and the reason `buildNone` is part of this
    // slice rather than a follow-up.
    const asked = await buildFixture().runs('feature/open');
    const cannot = await buildNone().runs('feature/open');
    expect(asked).toEqual({ ok: true, value: [] });
    expect(asked).not.toEqual(cannot);
  });
});
