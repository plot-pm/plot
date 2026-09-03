import { describe, expect, it } from 'vitest';
import {
  carriesDraftPlan,
  carriesSlice,
  isReleaseBranch,
  rowKind,
} from '../../src/server/fleet.js';
import { RowKindSchema, UNNAMED_SLICE, isSpikeSlice } from '../../src/contract/schema.js';
import { stuckState } from '../../src/server/stuck.js';
import { prState } from '../../src/server/fleet.js';

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

    it('is TRUE for an idea branch with no PR — a plan need not be in review', () => {
      // Reversed 2026-08-21. It read false, because *nothing has asked for the
      // review yet*. But an `idea/` branch holds markdown and nothing else: it
      // IS a plan, whether or not a draft PR has been opened on it. Review is a
      // phase, and the phase is the row's status, not its kind.
      expect(carriesDraftPlan({ branch: 'idea/a-wave-is-a-kind' })).toBe(true);
    });

    it('is false for any other prefix, PR or not', () => {
      expect(carriesDraftPlan({ branch: 'feature/x' })).toBe(false);
      // Not a match INSIDE the name — the prefix has to lead.
      expect(carriesDraftPlan({ branch: 'feature/an-idea/x' })).toBe(false);
    });
  });

  describe('carriesSlice', () => {
    it('is true for any branch a PLAN names, named wave or not', () => {
      // The test is the plan, not the wave's name — a plan with no `### `
      // heading has one unnamed wave, and its branch is that wave's work.
      expect(carriesSlice({ plan: 'a-wave-is-a-kind' })).toBe(true);
      expect(carriesSlice({ plan: 'the-no-ref-arm-asks-once-too' })).toBe(true);
    });

    it('is false where no plan names the branch', () => {
      // *"Ein branch der zu keinem Plan gehört ist keine WAVE."*
      expect(carriesSlice({ plan: '' })).toBe(false);
    });

    it('is false for `(unnamed)`, which cannot head a row', () => {
      // Six of this estate's 71 waves have no name, all in plans written before
      // the naming convention. A wave row named `(unnamed)` labels nothing, so a
      // branch in one is just a branch — the same rule `sliceGroupsFor` applies.
      expect(carriesSlice({ wave: UNNAMED_SLICE })).toBe(false);
    });
  });
});

describe('rowKind — a branch row is what is left when all four say no', () => {
  /** The arguments in the order `rowKind` takes them. */
  const kind = (o: {
    branch?: string; hasPr?: boolean; conflicts?: boolean; plan?: string; wave?: string;
  } = {}) => rowKind(
    o.branch ?? 'feature/x',
    o.hasPr ?? false,
    o.conflicts ?? false,
    o.plan ?? (o.wave ? 'some-plan' : ''),
  );

  it('yields BRANCH when every test says no', () => {
    // THE FALLBACK, and the rule's own words: *all others should yield a branch
    // row*. A name somebody pushed, and nothing else true of it yet.
    expect(kind()).toBe('branch');
  });

  it('yields each kind from its own test, one at a time', () => {
    expect(kind({ branch: 'changeset-release/main' })).toBe('release');
    expect(kind({ branch: 'idea/a-plan', hasPr: true })).toBe('plan');
    expect(kind({ wave: 'Modelled' })).toBe('wave');
    expect(kind({ hasPr: true })).toBe('pr');
  });

  it('calls an idea/ branch a plan WITH or WITHOUT a PR', () => {
    // *"Ein plan Branch (idea/) mit oder ohne PR ist ein PLAN"* — the operator's
    // rule, 2026-08-21. `carriesDraftPlan` required the PR until then, on the
    // reasoning that a plan is not under review until something asks for the
    // review. That reads the KIND as a PHASE: where a plan has got to is its
    // status, what it IS is the kind. A plan written and not yet opened is still
    // a plan, and `BRANCH` tells the reader *a name somebody pushed* about the
    // one row that is a document waiting for them.
    expect(kind({ branch: 'idea/a-plan' })).toBe('plan');
    expect(kind({ branch: 'idea/a-plan', hasPr: true })).toBe('plan');
  });

  it('calls a release branch a release WITH or WITHOUT a PR', () => {
    // *"Ein release-branch mit oder ohne PR ist ein RELEASE"* — the operator's
    // rule, 2026-08-21. `isReleaseBranch` reads the ref name and nothing else,
    // which is what makes both halves true, and this pins it: a release cut but
    // not yet opened is still the row nobody should merge by reflex.
    expect(kind({ branch: 'changeset-release/main' })).toBe('release');
    expect(kind({ branch: 'changeset-release/main', hasPr: true })).toBe('release');
  });

  it('lets a RELEASE outrank everything', () => {
    // The one row nobody should merge by reflex — the mark exists to stop that,
    // so it cannot be outranked by a later test that would also match.
    expect(kind({
      branch: 'changeset-release/main', hasPr: true, wave: 'Cut',
    })).toBe('release');
  });

  it('lets a DRAFT PLAN outrank its own CI and its own wave', () => {
    // What it wants is APPROVAL, whatever else is true of it — `plot-approve.sh`
    // takes a plan and no branch.
    expect(kind({ branch: 'idea/a-plan', hasPr: true })).toBe('plan');
    expect(kind({ branch: 'idea/a-plan', hasPr: true, wave: 'Shaped' })).toBe('plan');
  });

  it('lets a CONFLICT make it a branch, even with a PR and a wave', () => {
    // The one arm that answers *yes* to a later test and still returns `branch`:
    // no PR resolves a conflict, so the reader has to go to the branch and
    // rebase. `the-row-leads-with-its-subject` settled it.
    expect(kind({ hasPr: true, conflicts: true, wave: 'Modelled' })).toBe('branch');
  });

  it('lets a WAVE outrank a PR, because the wave is what the row is about', () => {
    // THIS TEST WAS THE OTHER WAY ROUND until 2026-08-21, and its old name said
    // why: *"because the wave is the weakest claim"*. The published method says
    // the opposite, and says it about this exact row:
    //
    //   *"Pull Request und Branch stehen in dieser Liste an der falschen Stelle:
    //   Sie sind nicht der Gegenstand, sie sind das Vehikel."*
    //   — Ein Team, ein Plan, viele Agenten (Quatico, 2026)
    //
    // A wave is the SUBJECT and it *"fährt auf einem Branch mit Pull Request und
    // eigenem Worktree auf"*. `plan → wave → branch`: a wave is what a plan is
    // cut into, what `plot-dispatch` claims, what a worktree exists for, and what
    // must finish before the next one opens. A PR is an EVENT at the branch while
    // that wave is carried out — it can appear, close and reopen without the wave
    // changing, and the wave cannot change without the plan's progress changing.
    //
    // The PR is not lost: it is a link in slot 4 and a status in slot 5. What
    // changed is which of the two facts the row is ABOUT.
    expect(kind({ hasPr: true, wave: 'Modelled' })).toBe('wave');
  });

  it('still calls a PR a pr where NO PLAN claims the branch', () => {
    // *"Ein PR der einen Branch hat der zu keinem Plan gehört ist ein PR"* — the
    // operator's rule, 2026-08-21. The arm survives one rank lower and this is
    // the case it answers.
    expect(kind({ hasPr: true })).toBe('pr');
  });

  it('calls a plan\'s branch a WAVE even where the wave has no name', () => {
    // *"Ein branch der zu keinem Plan gehört ist keine WAVE"* — so the test is
    // the PLAN, and the wave's name is not the test.
    //
    // Caught on the live board: a merged branch under plan
    // `the-no-ref-arm-asks-once-too` with PR #255, rendering `BRANCH`. Its plan
    // carries no `### ` heading, so the wave parsed as `(unnamed)` and the arm
    // refused it — while `MANIFESTO.md` says *"a plan with no subheadings is one
    // wave"*. 23 of this repo's 83 plans with a `## Branches` section are in that
    // shape, so it is the common case rather than an edge.
    expect(kind({ plan: 'the-no-ref-arm-asks-once-too', hasPr: true })).toBe('wave');
    expect(kind({ plan: 'some-plan' })).toBe('wave');
  });

  it('calls a branch NO PLAN names a branch, whatever its wave field says', () => {
    // The other half of the same rule, and the reason the field cannot be the
    // test: a stray wave name on a branch no plan claims must not promote it.
    expect(kind({ wave: '', plan: '' })).toBe('branch');
  });

  it('never returns a kind the contract does not declare', () => {
    // Across every combination of the five inputs — 2^4 x 3 branch shapes — the
    // answer is always one of the eight. A gate rather than a sample: an arm
    // added without a contract entry fails here rather than rendering blank.
    const kinds = new Set(RowKindSchema.options);
    for (const branch of ['feature/x', 'idea/p', 'changeset-release/main']) {
      for (const hasPr of [false, true]) {
        for (const conflicts of [false, true]) {
          {
            for (const wave of ['', 'Modelled', UNNAMED_SLICE]) {
              const k = kind({ branch, hasPr, conflicts, wave });
              expect(kinds.has(k), `${branch} ${hasPr} ${conflicts} ${wave} -> ${k}`)
                .toBe(true);
            }
          }
        }
      }
    }
  });

  it('yields WAVE for an unnamed wave, because a plan still names it', () => {
    // Reversed 2026-08-21. It asserted `branch`, on the rule that `(unnamed)` is
    // not a wave — which sent a plan's own merged work to the fallback kind. A
    // plan with no `### ` heading has one wave and it has no name; the branch
    // under it is that wave's work either way.
    expect(kind({ plan: 'a-plan-nobody-sliced' })).toBe('wave');
  });
});

describe('isSpikeSlice — a tracer is a different KIND of wave', () => {
  it('recognises the documented convention', () => {
    // `### Tracer` is what `plot-approve` Step 2b recommends by name, and
    // `plot-plan-meta.sh` carries the heading through as the wave's name — so the
    // signal is free and needs no contract field. Three plans use it today.
    expect(isSpikeSlice('Tracer')).toBe(true);
    expect(isSpikeSlice('tracer')).toBe(true);
    expect(isSpikeSlice('Spike')).toBe(true);
    expect(isSpikeSlice('Tracer bullet')).toBe(true);
    expect(isSpikeSlice('  Tracer  ')).toBe(true);
  });

  it('is false for an implementation wave', () => {
    // The distinction that matters: an implementation wave carries out a slice a
    // tracer has already de-risked, so its failure means a rebase. A tracer's
    // failure means *refine the plan* — `tracer-bullets` Step 4.
    expect(isSpikeSlice('Implementation')).toBe(false);
    expect(isSpikeSlice('Shaped')).toBe(false);
    expect(isSpikeSlice('')).toBe(false);
  });

  it('matches the WHOLE name, never a substring', () => {
    // A wave whose name merely mentions a tracer is not one — the same rule
    // `isReleaseBranch` follows about a prefix having to lead.
    expect(isSpikeSlice('Tracer-adjacent refactor')).toBe(false);
    expect(isSpikeSlice('post-spike cleanup')).toBe(false);
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
      sliceSiblings: ['feature/b', 'feature/a', 'feature/c'],
    });
    expect(s?.state).toBe('unsliced-wave');
    // SORTED, so the row reads the same on every pulse.
    expect(s?.sliceSiblings).toEqual(['feature/a', 'feature/b', 'feature/c']);
  });

  it('says nothing about a wave holding ONE branch', () => {
    // 49 of this estate's 57 waves are exactly this, and it is the shape the
    // model describes. A watcher that flags everything flags nothing.
    expect(stuckState({
      state: 'wip', conflicts: [], conflictsKnown: true, localAhead: 0,
      sliceSiblings: ['feature/only'],
    })).toBeNull();
  });

  it('lets a DOUBLE CLAIM outrank it', () => {
    // Which plan owns this branch at all outranks how that plan is shaped: until
    // the first is settled, the second describes a plan that may not be the one
    // governing this branch.
    const s = stuckState({
      state: 'wip', conflicts: [], conflictsKnown: true, localAhead: 0,
      claimedBy: ['plan-a', 'plan-b'],
      sliceSiblings: ['feature/a', 'feature/b'],
    });
    expect(s?.state).toBe('double-claimed');
  });

  it('outranks a CONFLICT, because the defect is in the plan', () => {
    // A conflict inside an unsliced wave is a symptom of the missing slice rather
    // than a separate thing to fix — the branches cannot be dispatched
    // one-per-wave as the model expects until somebody slices it.
    const s = stuckState({
      state: 'wip', conflicts: ['a.ts'], conflictsKnown: true, localAhead: 0,
      sliceSiblings: ['feature/a', 'feature/b'],
    });
    expect(s?.state).toBe('unsliced-wave');
  });
});

describe('a CLOSED pr is abandoned work, not work awaiting review', () => {
  it('reports `closed`, outranking every check', () => {
    // Measured 2026-08-21: PRs #51-#55 were closed as drafts 26 days earlier and
    // all five rendered `green` + `draft` — the board reading *five reviews are
    // waiting on you* about a wave somebody deliberately dropped.
    //
    // They reach a row at all because `prsByHead` keeps finished PRs on purpose:
    // `prOutranks` says *"MERGED IS NOT RANKED ABOVE CLOSED … both are finished,
    // both are worth linking"*. Right about the LINK; it was silently deciding
    // the STATUS too.
    expect(prState({
      number: 53, state: 'CLOSED', draft: true,
      mergeable: 'mergeable', checks: 'green',
    } as never)).toBe('closed');
  });

  it('still reports an OPEN pr by its checks', () => {
    // The arm is narrow: only the PR's own standing short-circuits, and an open
    // PR reads exactly as before.
    expect(prState({
      number: 304, state: 'OPEN', draft: false,
      mergeable: 'mergeable', checks: 'green',
    } as never)).toBe('green');
  });

  it('gives an abandoned branch NO stuck cue', () => {
    // `stuckState`'s first arm already excludes `merged` and `deferred` as
    // *"finished work and work nobody wants"* — a closed PR is the third case in
    // that same sentence.
    //
    // Measured: three of the five branches reported `conflict` with real
    // conflicting paths, on PRs closed 26 days earlier. The paths are true and
    // the cue is not — nobody rebases abandoned work.
    expect(stuckState({
      state: 'wip', conflicts: ['a.ts', 'b.ts'], conflictsKnown: true,
      localAhead: 0, prState: 'closed',
    })).toBeNull();
  });

  it('still cues an OPEN pr that conflicts', () => {
    // The negative that keeps the arm honest: the same inputs with an open PR
    // still report, because somebody IS going to rebase that one.
    expect(stuckState({
      state: 'wip', conflicts: ['a.ts'], conflictsKnown: true,
      localAhead: 0, prState: 'conflicts',
    })?.state).toBe('conflict');
  });
});
