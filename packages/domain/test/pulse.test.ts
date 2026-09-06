import { describe, expect, it } from 'vitest';

import { FleetReadingSchema, type FleetReading } from '../src/entities/fleet.js';
import {
  doubleClaimedBranches,
  planSlugOf,
  pulseDelta,
  readingLoss,
  sliceReadings,
} from '../src/rules/pulse.js';

/**
 * The pulse derivations, moved from the board's view layer.
 *
 * Built through the schema rather than as literals: the pulse has defaults, and
 * a fixture that stated only the fields a test reads would drift from what the
 * scan actually emits.
 */
const branch = (name: string, over: Record<string, unknown> = {}) => ({
  branch: name, state: 'open', deferred: false, claimed: '', ...over,
});

const pulse = (plans: unknown[]): FleetReading =>
  // `main` and `head` are required and irrelevant here: every rule under test
  // reads `plans` alone. Stated once rather than per test, so a fixture change
  // is a fixture change and not thirteen of them.
  FleetReadingSchema.parse({
    main: 'main',
    head: 'abc1234',
    summary: { plans: plans.length, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    plans,
  });

const plan = (file: string, slices: unknown[]) => ({ file, phase: 'approved', slices });
const slice = (name: string, branches: unknown[], verdict = 'eligible') =>
  ({ name, verdict, branches });

describe('planSlugOf — one definition of a plan identity', () => {
  it('strips the date prefix and the extension', () => {
    expect(planSlugOf('2026-08-30-the-board-decides-nothing.md')).toBe('the-board-decides-nothing');
  });

  it('leaves a file that carries neither alone', () => {
    // A plan written without the dated convention still has an identity, and
    // inventing one would make it unmatchable to its own waves.
    expect(planSlugOf('notes')).toBe('notes');
  });
});

describe('sliceReadings — what each slice is', () => {
  it('flattens every slice of every plan, in the pulse order', () => {
    const readings = sliceReadings(pulse([
      plan('2026-01-01-alpha.md', [slice('One', [branch('feature/a')])]),
      plan('2026-01-02-beta.md', [slice('Two', [branch('feature/b')])]),
    ]));
    expect(readings.map((r) => `${r.plan}/${r.name}`)).toEqual(['alpha/One', 'beta/Two']);
  });

  it('calls a slice complete when every branch merged', () => {
    const [reading] = sliceReadings(pulse([
      plan('2026-01-01-a.md', [slice('S', [
        branch('feature/a', { state: 'merged' }),
        branch('feature/b', { state: 'merged' }),
      ])]),
    ]));
    expect(reading!.complete).toBe(true);
  });

  it('counts a DEFERRED branch as no longer outstanding', () => {
    // A branch given up is not work in progress. Without this a slice waiting
    // on one nobody will build would never complete.
    const [reading] = sliceReadings(pulse([
      plan('2026-01-01-a.md', [slice('S', [
        branch('feature/a', { state: 'merged' }),
        branch('feature/b', { state: 'open', deferred: true }),
      ])]),
    ]));
    expect(reading!.complete).toBe(true);
  });

  it('is not complete while one branch is still open', () => {
    const [reading] = sliceReadings(pulse([
      plan('2026-01-01-a.md', [slice('S', [
        branch('feature/a', { state: 'merged' }),
        branch('feature/b'),
      ])]),
    ]));
    expect(reading!.complete).toBe(false);
  });

  it('names an unnamed slice rather than carrying an empty string', () => {
    const [reading] = sliceReadings(pulse([
      plan('2026-01-01-a.md', [slice('', [branch('feature/a')])]),
    ]));
    expect(reading!.name).toBe('(unnamed)');
  });

  it('tells a sole slice from one of many', () => {
    const readings = sliceReadings(pulse([
      plan('2026-01-01-a.md', [slice('One', [branch('feature/a')]), slice('Two', [branch('feature/b')])]),
    ]));
    expect(readings.map((r) => r.planSliceCount)).toEqual([2, 2]);
  });

  it('carries the verdict unparsed, leaving the enum to the caller', () => {
    const [reading] = sliceReadings(pulse([
      plan('2026-01-01-a.md', [slice('S', [branch('feature/a')], 'blocked')]),
    ]));
    expect(reading!.verdict).toBe('blocked');
  });

  it('reads an empty estate as no slices rather than failing', () => {
    expect(sliceReadings(pulse([]))).toEqual([]);
  });
});

describe('doubleClaimedBranches — a branch belongs to one plan', () => {
  it('names both plans when two claim one branch', () => {
    // NAMED rather than counted: resolving this means editing one of the two
    // plan files, so the reader has to be told which two.
    const collisions = doubleClaimedBranches(pulse([
      plan('2026-01-01-alpha.md', [slice('S', [branch('feature/shared')])]),
      plan('2026-01-02-beta.md', [slice('S', [branch('feature/shared')])]),
    ]));
    expect(collisions.get('feature/shared')).toEqual(['alpha', 'beta']);
  });

  it('reports nothing when every branch is claimed once', () => {
    const collisions = doubleClaimedBranches(pulse([
      plan('2026-01-01-alpha.md', [slice('S', [branch('feature/a')])]),
      plan('2026-01-02-beta.md', [slice('S', [branch('feature/b')])]),
    ]));
    expect(collisions.size).toBe(0);
  });

  it('does not report a branch one plan names twice', () => {
    // Two slices of ONE plan naming a branch is that plan's business; only two
    // PLANS is a collision anybody has to resolve.
    const collisions = doubleClaimedBranches(pulse([
      plan('2026-01-01-alpha.md', [
        slice('One', [branch('feature/a')]),
        slice('Two', [branch('feature/a')]),
      ]),
    ]));
    expect(collisions.size).toBe(0);
  });
});

describe('readingLoss — what the fleet stopped seeing', () => {
  const withPlans = (...files: string[]) =>
    pulse(files.map((f) => plan(f, [slice('S', [branch(`feature/${f[0]}`)])])));

  it('loses nothing on a first reading, however full the pulse', () => {
    // With no previous pulse every plan looks new, and reporting that as a
    // shrink would announce a loss on every start.
    expect(readingLoss(null, withPlans('2026-01-01-a.md'), 100)).toBeNull();
    expect(readingLoss(withPlans('2026-01-01-a.md'), withPlans('2026-01-01-a.md'), null)).toBeNull();
  });

  it('reports nothing when the estate did not shrink', () => {
    const same = withPlans('2026-01-01-a.md');
    expect(readingLoss(same, same, 100)).toBeNull();
  });

  it('names the plan that vanished, and when it was last seen', () => {
    const loss = readingLoss(
      withPlans('2026-01-01-a.md', '2026-01-02-b.md'),
      withPlans('2026-01-01-a.md'),
      1700,
    );
    expect(loss?.plans).toEqual(['2026-01-02-b.md']);
    expect(loss?.previousAt).toBe(1700);
  });

  it('names a branch that vanished from a plan that did not', () => {
    const before = pulse([plan('2026-01-01-a.md', [slice('S', [branch('feature/a'), branch('feature/b')])])]);
    const after = pulse([plan('2026-01-01-a.md', [slice('S', [branch('feature/a')])])]);
    const loss = readingLoss(before, after, 1700);
    expect(loss?.branches).toEqual(['feature/b']);
    expect(loss?.plans).toEqual([]);
  });

  it('reports nothing when the estate GREW', () => {
    // Growth is not loss, and a rule that fired on any difference would report
    // every new plan as a vanished one.
    expect(readingLoss(withPlans('2026-01-01-a.md'), withPlans('2026-01-01-a.md', '2026-01-02-b.md'), 100))
      .toBeNull();
  });

  it('sorts what it lost, so two readings of one loss agree', () => {
    const loss = readingLoss(
      withPlans('2026-01-03-c.md', '2026-01-01-a.md', '2026-01-02-b.md'),
      withPlans('2026-01-01-a.md'),
      1700,
    );
    expect(loss?.plans).toEqual(['2026-01-02-b.md', '2026-01-03-c.md']);
  });
});

describe('pulseDelta — what moved since the last pulse', () => {
  const one = (over: Record<string, unknown> = {}, verdict = 'eligible') =>
    pulse([plan('2026-01-01-a.md', [slice('S', [branch('feature/a', over)], verdict)])]);

  describe('the four outcomes, which must never collapse to two', () => {
    it('says `first` when nobody has pulsed here yet', () => {
      // The state every new adopter starts in. A normal state, not a failure,
      // and the reason `historyExists` defaults false.
      const got = pulseDelta(null, one(), null);
      expect(got.outcome).toBe('first');
      expect(got.previousAt).toBeNull();
    });

    it('says `unusable` when history WAS found and could not be read', () => {
      // Expired past BRIDGE_MAX_AGE_MS, or written by a build whose
      // BRIDGE_VERSION this one does not know. Both leave the caller holding
      // no previous reading — and the caller is what knows which case it is,
      // because the rule reads nothing.
      const got = pulseDelta(null, one(), null, true);
      expect(got.outcome).toBe('unusable');
    });

    it('tells `unusable` from `unchanged`, which mean opposite things', () => {
      // The whole reason this is four outcomes. A quiet estate and an
      // unreadable history look identical to a reader: one says nothing needs
      // your attention, the other says nothing could be compared.
      const quiet = pulseDelta(one(), one(), 1700);
      expect(quiet.outcome).toBe('unchanged');
      expect(pulseDelta(null, one(), null, true).outcome).toBe('unusable');
    });

    it('says `changed` only when one of the three moved', () => {
      const before = one({ state: 'wip' });
      expect(pulseDelta(before, one({ state: 'wip' }), 1700).outcome).toBe('unchanged');
      expect(pulseDelta(before, one({ state: 'merged' }), 1700).outcome).toBe('changed');
    });
  });

  describe('the three the story names, and nothing else', () => {
    it('names the branch whose PR merged, and its plan', () => {
      const got = pulseDelta(one({ state: 'wip' }), one({ state: 'merged' }), 1700);
      expect(got.merged).toEqual([{ branch: 'feature/a', plan: 'a' }]);
    });

    it('names the worker that died, and what it became', () => {
      const got = pulseDelta(
        one({ worker: 'running' }),
        one({ worker: 'failed' }),
        1700,
      );
      expect(got.workersDied).toEqual([{ branch: 'feature/a', plan: 'a', state: 'failed' }]);
    });

    it('does NOT call `elsewhere` a death', () => {
      // `elsewhere` means no worktree on this machine, so the question could
      // not be asked. A reading that stops being able to SEE a worker has not
      // watched one die, and reporting it as one would fire on every scan run
      // from a second checkout.
      const got = pulseDelta(one({ worker: 'running' }), one({ worker: 'elsewhere' }), 1700);
      expect(got.workersDied).toEqual([]);
      expect(got.outcome).toBe('unchanged');
    });

    it('names the plan that became deliverable', () => {
      const before = one({ state: 'wip' }, 'eligible');
      const after = one({ state: 'merged' }, 'complete');
      expect(pulseDelta(before, after, 1700).deliverable).toEqual(['a']);
    });

    it('does not re-announce a plan that was ALREADY deliverable', () => {
      const done = one({ state: 'merged' }, 'complete');
      const got = pulseDelta(done, done, 1700);
      expect(got.deliverable).toEqual([]);
      expect(got.outcome).toBe('unchanged');
    });

    it('a plan nobody built has not become deliverable', () => {
      // Every slice complete over no branches at all. `allSlicesMerged` refuses
      // this for the same reason, and two answers to one question would drift.
      const empty = pulse([plan('2026-01-01-a.md', [slice('S', [], 'complete')])]);
      expect(pulseDelta(empty, empty, 1700).deliverable).toEqual([]);
    });

    it('ignores a branch this reading names for the FIRST time', () => {
      // New, not moved. All three answers are about movement, and a branch that
      // arrives already merged transitioned from nothing rather than from wip.
      const before = pulse([plan('2026-01-01-a.md', [slice('S', [branch('feature/a')])])]);
      const after = pulse([plan('2026-01-01-a.md', [
        slice('S', [branch('feature/a'), branch('feature/b', { state: 'merged' })]),
      ])]);
      expect(pulseDelta(before, after, 1700).merged).toEqual([]);
    });
  });

  describe('what it carries from readingLoss', () => {
    it('consumes the loss rather than re-deriving it', () => {
      // One implementation of *what did the estate stop seeing*. A second here
      // is the drift the brief names: two functions over two readings that
      // disagree about a first read.
      const before = pulse([
        plan('2026-01-01-a.md', [slice('S', [branch('feature/a')])]),
        plan('2026-01-02-b.md', [slice('S', [branch('feature/b')])]),
      ]);
      const after = pulse([plan('2026-01-01-a.md', [slice('S', [branch('feature/a')])])]);
      const got = pulseDelta(before, after, 1700);
      expect(got.loss).toEqual(readingLoss(before, after, 1700));
      expect(got.loss?.plans).toEqual(['2026-01-02-b.md']);
      // A loss is news, so the estate changed.
      expect(got.outcome).toBe('changed');
    });

    it('carries no loss on a first run, as readingLoss does not', () => {
      expect(pulseDelta(null, one(), null).loss).toBeNull();
    });
  });

  it('sorts what it names, so two readings of one delta agree', () => {
    const before = pulse([plan('2026-01-01-a.md', [slice('S', [
      branch('feature/c', { state: 'wip' }),
      branch('feature/a', { state: 'wip' }),
      branch('feature/b', { state: 'wip' }),
    ])])]);
    const after = pulse([plan('2026-01-01-a.md', [slice('S', [
      branch('feature/c', { state: 'merged' }),
      branch('feature/a', { state: 'merged' }),
      branch('feature/b', { state: 'merged' }),
    ])])]);
    expect(pulseDelta(before, after, 1700).merged.map((m) => m.branch))
      .toEqual(['feature/a', 'feature/b', 'feature/c']);
  });

  it('performs no I/O — the caller reads, the rule compares', () => {
    // Readings as values, the shape every rule here takes: two readings in, a
    // value out, nothing awaited and no port passed. A rule that reached for a
    // file could not return before it had one.
    const got = pulseDelta(one(), one(), 1700);
    expect(got).not.toBeInstanceOf(Promise);
    expect(got.outcome).toBe('unchanged');
    // And it is a pure function of its arguments: the same two readings answer
    // the same thing however often they are asked.
    expect(pulseDelta(one(), one(), 1700)).toEqual(got);
  });
});
