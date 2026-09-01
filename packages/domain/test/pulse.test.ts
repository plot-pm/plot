import { describe, expect, it } from 'vitest';

import { FleetPulseSchema, type FleetPulse } from '../src/entities/fleet.js';
import {
  doubleClaimedBranches,
  planSlugOf,
  pulseLoss,
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

const pulse = (plans: unknown[]): FleetPulse =>
  // `main` and `head` are required and irrelevant here: every rule under test
  // reads `plans` alone. Stated once rather than per test, so a fixture change
  // is a fixture change and not thirteen of them.
  FleetPulseSchema.parse({
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

describe('pulseLoss — what the fleet stopped seeing', () => {
  const withPlans = (...files: string[]) =>
    pulse(files.map((f) => plan(f, [slice('S', [branch(`feature/${f[0]}`)])])));

  it('loses nothing on a first reading, however full the pulse', () => {
    // With no previous pulse every plan looks new, and reporting that as a
    // shrink would announce a loss on every start.
    expect(pulseLoss(null, withPlans('2026-01-01-a.md'), 100)).toBeNull();
    expect(pulseLoss(withPlans('2026-01-01-a.md'), withPlans('2026-01-01-a.md'), null)).toBeNull();
  });

  it('reports nothing when the estate did not shrink', () => {
    const same = withPlans('2026-01-01-a.md');
    expect(pulseLoss(same, same, 100)).toBeNull();
  });

  it('names the plan that vanished, and when it was last seen', () => {
    const loss = pulseLoss(
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
    const loss = pulseLoss(before, after, 1700);
    expect(loss?.branches).toEqual(['feature/b']);
    expect(loss?.plans).toEqual([]);
  });

  it('reports nothing when the estate GREW', () => {
    // Growth is not loss, and a rule that fired on any difference would report
    // every new plan as a vanished one.
    expect(pulseLoss(withPlans('2026-01-01-a.md'), withPlans('2026-01-01-a.md', '2026-01-02-b.md'), 100))
      .toBeNull();
  });

  it('sorts what it lost, so two readings of one loss agree', () => {
    const loss = pulseLoss(
      withPlans('2026-01-03-c.md', '2026-01-01-a.md', '2026-01-02-b.md'),
      withPlans('2026-01-01-a.md'),
      1700,
    );
    expect(loss?.plans).toEqual(['2026-01-02-b.md', '2026-01-03-c.md']);
  });
});
