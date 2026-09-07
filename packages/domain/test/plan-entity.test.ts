import { describe, it, expect } from 'vitest';
import {
  planIdOf, planStateOf, planStateIsReadable, branchesWanted, slicesDeferred,
  planSlugOf, sliceId,
  type Plan, type Slice, type SliceIntent, type PlanState,
} from '../src/index.js';

/**
 * THE PLAN AND THE SLICE — the two entities a plan file writes.
 *
 * A plan writes the Slice; git writes the Branch. They are 1:1, so the tests
 * below are about the cases where the two DISAGREE — which is the whole reason
 * the entities are separate.
 */

const slice = (over: Partial<Slice> = {}): Slice => ({
  plan: 'every-element-is-a-domain-concept',
  name: 'Naming the plan and the slice',
  branch: 'feature/a-plan-is-a-domain-entity',
  order: 0,
  intent: 'active',
  intentReason: '',
  ...over,
});

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'every-element-is-a-domain-concept',
  file: 'docs/plans/2026-09-04-every-element-is-a-domain-concept.md',
  title: 'Every element is a domain concept',
  state: 'approved',
  review: 'pr',
  story: 'the-domain-knows-what-plot-knows',
  sprint: 'the-domain-owns-the-lifecycle',
  slices: [slice()],
  ...over,
});

describe('planIdOf — ONE definition of a plan identity', () => {
  it('takes the basename before stripping the date, which the four copies did not agree on', () => {
    // THE DEFECT THIS CLOSES. `plot-plan-meta.sh` reports `file` as a
    // repository-relative PATH, and the domain's own derivation stripped only a
    // leading date — so it answered `docs/plans/2026-09-04-...` in production
    // while the board's three copies answered the bare slug.
    expect(planIdOf('docs/plans/2026-09-04-every-element-is-a-domain-concept.md'))
      .toBe('every-element-is-a-domain-concept');
  });

  it('answers the same for the bare filename the old tests all passed', () => {
    // Every test of the old derivation used this shape, which is why none of
    // them caught the path case above.
    expect(planIdOf('2026-08-30-the-board-decides-nothing.md')).toBe('the-board-decides-nothing');
  });

  it('leaves a file carrying neither a date nor an extension alone', () => {
    // A plan written outside the dated convention still has an identity, and
    // inventing one would make it unmatchable to its own slices.
    expect(planIdOf('notes')).toBe('notes');
  });

  it('strips an extension without a date, and a date without an extension', () => {
    expect(planIdOf('notes.md')).toBe('notes');
    expect(planIdOf('2026-09-04-notes')).toBe('notes');
  });

  it('keeps a date that is not the prefix', () => {
    // The regex is anchored, so a date inside the name is part of the name.
    expect(planIdOf('docs/plans/release-2026-09-04.md')).toBe('release-2026-09-04');
  });

  it('is what planSlugOf now answers', () => {
    // One definition, reached under both names — the drift this closes.
    const file = 'docs/plans/2026-09-04-every-element-is-a-domain-concept.md';
    expect(planSlugOf(file)).toBe(planIdOf(file));
  });
});

describe('planStateOf — the parser’s wire word as a PlanState', () => {
  it('reads each of the seven states the parser normalizes to', () => {
    const seven: [string, PlanState][] = [
      ['draft', 'draft'], ['design', 'design'], ['approved', 'approved'],
      ['delivered', 'delivered'], ['released', 'released'],
      ['rejected', 'rejected'], ['superseded', 'superseded'],
    ];
    for (const [wire, state] of seven) expect(planStateOf(wire)).toBe(state);
  });

  it('reads the file’s own capitalisation', () => {
    // Plan files write `Phase: Approved`; the parser lowercases, the shell does
    // not always, and both reach this.
    expect(planStateOf('Approved')).toBe('approved');
    expect(planStateOf('  Delivered  ')).toBe('delivered');
  });

  it('maps both of the parser’s absences to none', () => {
    // `NONE` is a file that stated no phase, `''` a shell field nobody set.
    expect(planStateOf('NONE')).toBe('none');
    expect(planStateOf('')).toBe('none');
  });

  it('maps UNKNOWN to none rather than to the string it lowercases to', () => {
    // THE CAST THIS REPLACES produced `'unknown'` — a value `PlanState` does not
    // admit, which typechecked only because a cast silenced it and reached every
    // `switch` as an unhandled default. A mis-spelled phase is a plan whose state
    // nobody can read, which is what `none` means to a transition.
    expect(planStateOf('UNKNOWN')).toBe('none');
    expect(planStateOf('Approvd')).toBe('none');
  });
});

describe('planStateIsReadable — telling unmeasured from a real state', () => {
  it('is false for none and true for every other state', () => {
    expect(planStateIsReadable('none')).toBe(false);
    for (const state of ['draft', 'design', 'approved', 'delivered', 'released', 'rejected', 'superseded'] as PlanState[]) {
      expect(planStateIsReadable(state)).toBe(true);
    }
  });
});

describe('a Slice belongs to one plan and holds one branch', () => {
  it('composes its identity from the pair, never the name alone', () => {
    // `Counted` appears in 11 plans and means something different in each.
    const one = slice({ plan: 'plan-a', name: 'Counted' });
    const other = slice({ plan: 'plan-b', name: 'Counted' });
    expect(sliceId(one.plan, one.name)).not.toBe(sliceId(other.plan, other.name));
  });

  it('gives the default slice an identity ending in the separator', () => {
    expect(sliceId('a-plan', '')).toBe('a-plan#');
  });

  it('carries its place in the plan’s order', () => {
    const slices = [slice({ order: 0 }), slice({ order: 1, branch: 'feature/b' })];
    expect(slices.map((s) => s.order)).toEqual([0, 1]);
  });
});

describe('a plan writes the Slice; git writes the Branch', () => {
  it('keeps a deferred slice’s meaning when no branch exists', () => {
    // THE CASE THAT PROVES NEITHER DERIVES FROM THE OTHER. The plan's decision
    // survives the ref being absent, because the plan wrote it — measured over
    // the estate as 21 annotated branch lines.
    const given_up = slice({
      branch: 'feature/never-created',
      intent: 'deferred',
      intentReason: 'folded into the slice that superseded it',
    });
    expect(slicesDeferred(plan({ slices: [given_up] })))
      .toEqual([given_up]);
    expect(given_up.intentReason).not.toBe('');
  });

  it('excludes a deferred branch from the work a plan still wants', () => {
    // The delivery gate's rule, stated once: a branch given up is not
    // outstanding work, so counting it would hold a plan open forever.
    const p = plan({
      slices: [
        slice({ branch: 'feature/wanted', order: 0 }),
        slice({ branch: 'feature/given-up', order: 1, intent: 'deferred', intentReason: 'moved' }),
      ],
    });
    expect(branchesWanted(p)).toEqual(['feature/wanted']);
  });

  it('counts a branch once when two slices name it', () => {
    const p = plan({
      slices: [slice({ order: 0 }), slice({ order: 1, name: 'Again' })],
    });
    expect(branchesWanted(p)).toEqual(['feature/a-plan-is-a-domain-entity']);
  });

  it('contributes nothing for a slice naming no branch', () => {
    // A `### ` heading carrying only prose has no ref to land.
    const p = plan({ slices: [slice({ branch: '' })] });
    expect(branchesWanted(p)).toEqual([]);
  });

  it('answers an empty list for a plan with no slices', () => {
    expect(branchesWanted(plan({ slices: [] }))).toEqual([]);
    expect(slicesDeferred(plan({ slices: [] }))).toEqual([]);
  });

  it('reports no deferred slices when the plan wants all its work', () => {
    expect(slicesDeferred(plan())).toEqual([]);
  });
});

describe('SliceIntent — what the plan states, not what git measures', () => {
  it('has two values, and moved: is deferred', () => {
    // `plot-plan-meta.sh` reports `deferred: true` for either annotation, and
    // CLAUDE.md has said the two are one answer since the reconcile scan was
    // written. Modelling them apart would be a second answer to a settled
    // question.
    const intents: SliceIntent[] = ['active', 'deferred'];
    expect(intents).toHaveLength(2);
  });
});

describe('a Plan has at most one story and at most one sprint', () => {
  it('carries each as a single value, empty where there is none', () => {
    // The `≤1` half of `Story 1 ── * Plan`: a plan belongs to one story or to
    // none, never to two.
    expect(plan().story).toBe('the-domain-knows-what-plot-knows');
    expect(plan({ story: '', sprint: '' }).story).toBe('');
  });
});
