import { describe, expect, it } from 'vitest';
import {
  carriesDraftPlan,
  carriesWave,
  isReleaseBranch,
  rowKind,
} from '../../src/server/fleet.js';
import { RowKindSchema, UNNAMED_WAVE, isSpikeWave } from '../../src/contract/schema.js';
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
    branch?: string; hasPr?: boolean; conflicts?: boolean; wave?: string;
  } = {}) => rowKind(
    o.branch ?? 'feature/x',
    o.hasPr ?? false,
    o.conflicts ?? false,
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
    expect(kind({ wave: 'Modelled' })).toBe('wave');
    expect(kind({ hasPr: true })).toBe('pr');
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

  it('still calls a PR a pr where no wave claims the branch', () => {
    // The arm survives one rank lower, and this is the case it answers: a branch
    // with a PR that nobody sliced into a wave.
    expect(kind({ hasPr: true })).toBe('pr');
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
            for (const wave of ['', 'Modelled', UNNAMED_WAVE]) {
              const k = kind({ branch, hasPr, conflicts, wave });
              expect(kinds.has(k), `${branch} ${hasPr} ${conflicts} ${wave} -> ${k}`)
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
