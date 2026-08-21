import { describe, expect, it } from 'vitest';
import {
  carriesDraftPlan,
  carriesWave,
  isReleaseBranch,
  rowKind,
} from '../../src/server/fleet.js';
import { RowKindSchema, UNNAMED_WAVE, isSpikeWave } from '../../src/contract/schema.js';
import { stuckState } from '../../src/server/stuck.js';

/**
 * THE BRANCH ABSTRACTION — a branch row is the fallback, and it takes four
 * distinct negatives.
 *
 * The operator's rule, 2026-08-21: *"we should only see a branch row if the
 * branch does not carry a wave, and the branch does not carry a draft plan, and
 * the branch does not have a PR, and the branch is not a release branch. These
 * are distinct tests … all others should yield a branch row."*
 *
 * Each test is asserted ALONE first, then in the combination that decides
 * precedence. Testing only `rowKind` would leave the four indistinguishable: a
 * single condition that happened to cover all of them would pass every
 * end-to-end assertion and be impossible to reason about the day one changes.
 */
describe('the four tests a branch answers', () => {
  describe('isReleaseBranch', () => {
    it('is true for the branch changesets cuts', () => {
      expect(isReleaseBranch({ branch: 'changeset-release/main' })).toBe(true);
    });

    it('is false for a branch that merely mentions releases', () => {
      // The prefix must LEAD. A feature branch about releases is not one.
      expect(isReleaseBranch({ branch: 'feature/changeset-release-notes' })).toBe(false);
      expect(isReleaseBranch({ branch: 'feature/a-release-is-its-version' })).toBe(false);
    });
  });

  describe('carriesDraftPlan', () => {
    it('is true for an idea branch WITH a PR', () => {
      // `/plot-idea` names the branch after the plan's slug, and the PR is the
      // review — which is what makes the plan a draft under review rather than
      // just a plan.
      expect(carriesDraftPlan({ branch: 'idea/a-wave-is-a-kind', hasPr: true })).toBe(true);
    });

    it('is false for an idea branch with NO PR', () => {
      // Nothing has asked for the review yet, so nothing is under review.
      expect(carriesDraftPlan({ branch: 'idea/a-wave-is-a-kind', hasPr: false })).toBe(false);
    });

    it('is false for any other prefix, PR or not', () => {
      expect(carriesDraftPlan({ branch: 'feature/x', hasPr: true })).toBe(false);
      // Not a match INSIDE the name — the prefix has to lead.
      expect(carriesDraftPlan({ branch: 'feature/an-idea/x', hasPr: true })).toBe(false);
    });
  });

  describe('carriesWave', () => {
    it('is true for a named wave', () => {
      expect(carriesWave({ wave: 'Modelled' })).toBe(true);
    });

    it('is false for no wave', () => {
      expect(carriesWave({ wave: '' })).toBe(false);
    });

    it('is false for `(unnamed)`, which cannot head a row', () => {
      // Six of this estate's 71 waves have no name, all in plans written before
      // the naming convention. A wave row named `(unnamed)` labels nothing, so a
      // branch in one is just a branch — the same rule `waveGroupsFor` applies.
      expect(carriesWave({ wave: UNNAMED_WAVE })).toBe(false);
    });
  });
});

describe('rowKind — a branch row is what is left when all four say no', () => {
  /** The arguments in the order `rowKind` takes them. */
  const kind = (o: {
    branch?: string; hasPr?: boolean; conflicts?: boolean;
    ciRunning?: boolean; wave?: string;
  } = {}) => rowKind(
    o.branch ?? 'feature/x',
    o.hasPr ?? false,
    o.conflicts ?? false,
    o.ciRunning ?? false,
    o.wave ?? '',
  );

  it('yields BRANCH when every test says no', () => {
    // THE FALLBACK, and the rule's own words: *all others should yield a branch
    // row*. A name somebody pushed, and nothing else true of it yet.
    expect(kind()).toBe('branch');
  });

  it('yields each kind from its own test, one at a time', () => {
    expect(kind({ branch: 'changeset-release/main' })).toBe('release');
    expect(kind({ branch: 'idea/a-plan', hasPr: true })).toBe('plan');
    expect(kind({ hasPr: true, ciRunning: true })).toBe('build');
    expect(kind({ hasPr: true })).toBe('pr');
    expect(kind({ wave: 'Modelled' })).toBe('wave');
  });

  it('lets a RELEASE outrank everything', () => {
    // The one row nobody should merge by reflex — the mark exists to stop that,
    // so it cannot be outranked by a later test that would also match.
    expect(kind({
      branch: 'changeset-release/main', hasPr: true, ciRunning: true, wave: 'Cut',
    })).toBe('release');
  });

  it('lets a DRAFT PLAN outrank its own CI and its own wave', () => {
    // What it wants is APPROVAL, whatever its checks say — `plot-approve.sh`
    // takes a plan and no branch.
    expect(kind({ branch: 'idea/a-plan', hasPr: true, ciRunning: true })).toBe('plan');
    expect(kind({ branch: 'idea/a-plan', hasPr: true, wave: 'Shaped' })).toBe('plan');
  });

  it('lets a CONFLICT make it a branch, even with a PR and a wave', () => {
    // The one arm that answers *yes* to a later test and still returns `branch`:
    // no PR resolves a conflict, so the reader has to go to the branch and
    // rebase. `the-row-leads-with-its-subject` settled it.
    expect(kind({ hasPr: true, conflicts: true, wave: 'Modelled' })).toBe('branch');
  });

  it('lets a PR outrank a WAVE, because the wave is the weakest claim', () => {
    // A wave says which SLICE of a plan a branch belongs to; a PR says something
    // has happened to it. The stronger claim wins.
    expect(kind({ hasPr: true, wave: 'Modelled' })).toBe('pr');
  });

  it('never returns a kind the contract does not declare', () => {
    // Across every combination of the five inputs — 2^4 x 3 branch shapes — the
    // answer is always one of the eight. A gate rather than a sample: an arm
    // added without a contract entry fails here rather than rendering blank.
    const kinds = new Set(RowKindSchema.options);
    for (const branch of ['feature/x', 'idea/p', 'changeset-release/main']) {
      for (const hasPr of [false, true]) {
        for (const conflicts of [false, true]) {
          for (const ciRunning of [false, true]) {
            for (const wave of ['', 'Modelled', UNNAMED_WAVE]) {
              const k = kind({ branch, hasPr, conflicts, ciRunning, wave });
              expect(kinds.has(k), `${branch} ${hasPr} ${conflicts} ${ciRunning} ${wave} -> ${k}`)
                .toBe(true);
            }
          }
        }
      }
    }
  });

  it('yields BRANCH for an unnamed wave with nothing else true', () => {
    // The composition that matters: `(unnamed)` is not a wave for this decision,
    // so a branch in one falls all the way through.
    expect(kind({ wave: UNNAMED_WAVE })).toBe('branch');
  });
});

describe('isSpikeWave — a tracer is a different KIND of wave', () => {
  it('recognises the documented convention', () => {
    // `### Tracer` is what `plot-approve` Step 2b recommends by name, and
    // `plot-plan-meta.sh` carries the heading through as the wave's name — so the
    // signal is free and needs no contract field. Three plans use it today.
    expect(isSpikeWave('Tracer')).toBe(true);
    expect(isSpikeWave('tracer')).toBe(true);
    expect(isSpikeWave('Spike')).toBe(true);
    expect(isSpikeWave('Tracer bullet')).toBe(true);
    expect(isSpikeWave('  Tracer  ')).toBe(true);
  });

  it('is false for an implementation wave', () => {
    // The distinction that matters: an implementation wave carries out a slice a
    // tracer has already de-risked, so its failure means a rebase. A tracer's
    // failure means *refine the plan* — `tracer-bullets` Step 4.
    expect(isSpikeWave('Implementation')).toBe(false);
    expect(isSpikeWave('Shaped')).toBe(false);
    expect(isSpikeWave('')).toBe(false);
  });

  it('matches the WHOLE name, never a substring', () => {
    // A wave whose name merely mentions a tracer is not one — the same rule
    // `isReleaseBranch` follows about a prefix having to lead.
    expect(isSpikeWave('Tracer-adjacent refactor')).toBe(false);
    expect(isSpikeWave('post-spike cleanup')).toBe(false);
  });
});

describe('stuckState — an unsliced wave is invalid', () => {
  it('reports a wave holding several branches', () => {
    // The model, settled 2026-08-21: a spike produces a refined plan, the plan is
    // sliced into waves, and **each wave is carried out in one branch and one
    // worktree**. So several branches in one wave means the plan was never
    // sliced.
    const s = stuckState({
      state: 'wip', conflicts: [], conflictsKnown: true, localAhead: 0,
      waveSiblings: ['feature/b', 'feature/a', 'feature/c'],
    });
    expect(s?.state).toBe('unsliced-wave');
    // SORTED, so the row reads the same on every pulse.
    expect(s?.waveSiblings).toEqual(['feature/a', 'feature/b', 'feature/c']);
  });

  it('says nothing about a wave holding ONE branch', () => {
    // 49 of this estate's 57 waves are exactly this, and it is the shape the
    // model describes. A watcher that flags everything flags nothing.
    expect(stuckState({
      state: 'wip', conflicts: [], conflictsKnown: true, localAhead: 0,
      waveSiblings: ['feature/only'],
    })).toBeNull();
  });

  it('lets a DOUBLE CLAIM outrank it', () => {
    // Which plan owns this branch at all outranks how that plan is shaped: until
    // the first is settled, the second describes a plan that may not be the one
    // governing this branch.
    const s = stuckState({
      state: 'wip', conflicts: [], conflictsKnown: true, localAhead: 0,
      claimedBy: ['plan-a', 'plan-b'],
      waveSiblings: ['feature/a', 'feature/b'],
    });
    expect(s?.state).toBe('double-claimed');
  });

  it('outranks a CONFLICT, because the defect is in the plan', () => {
    // A conflict inside an unsliced wave is a symptom of the missing slice rather
    // than a separate thing to fix — the branches cannot be dispatched
    // one-per-wave as the model expects until somebody slices it.
    const s = stuckState({
      state: 'wip', conflicts: ['a.ts'], conflictsKnown: true, localAhead: 0,
      waveSiblings: ['feature/a', 'feature/b'],
    });
    expect(s?.state).toBe('unsliced-wave');
  });
});
