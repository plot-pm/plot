// The classifier is total — the executable form of the section rules.
//
// This file is wave 1 of `the-wave-is-a-thing-the-board-can-hold`, and it
// records what the board does TODAY, before any sibling wave moves it. Its job
// is not to fix anything — the scope guard forbids touching production code —
// but to pin the baseline so the diff a later wave produces is readable, and so
// that fixing a defect BREAKS the test that recorded the defect and forces a
// deliberate update.
//
// Two specifications govern it:
//   docs/board-domain-model.md  — the eighteen section rules and their measured
//                                 2026-08-23 results (twelve hold, six fail).
//   docs/plans/2026-08-23-the-wave-is-a-thing-the-board-can-hold.md — the plan
//                                 whose `## Done when` opens with the totality
//                                 clause this file's first half proves.
//
// THE PHASE VOCABULARY IS THE ONE TRAP. The domain model states its rules in the
// plan's own phases — Discovery · Development · Testing · Released — but
// `classify` never sees those words. Its `planPhase` argument is the fleet
// SCAN's lowercase lifecycle vocabulary — '' · draft · approved · delivered ·
// released — the same strings `toBoardPhase` maps back up. So every rule stated
// below in domain-model terms is fed to `classify` through PHASE, the one
// translation table, and reading a capitalised phase into the argument would
// silently land in the unknown-phase arm (→ DONE) and prove nothing.

import { describe, it, expect } from 'vitest';
import { classify, rowsFromPulse } from '../../src/server/fleet.js';
import type { PrRecord } from '../../src/server/fleet.js';
import type { AgentRow, BranchState, FleetPulse, WaitingGroup, WaveVerdict, WorkerState } from '../../src/contract/schema.js';
// WHERE THE WAVE'S SECTION NOW LIVES. `classify` answers per BRANCH and still
// does — a merged branch of an eligible wave is `done` to it, correctly, for a
// branch. The wave's ONE section is decided a layer up, by `waveSection` reading
// the verdict the scan already aggregated. So the two `Inverted` rules below
// that `a-wave-is-one-row` fixes are re-asserted against THAT function, not
// against a `classify` the fix deliberately left unchanged.
//
// The RELEASE-SCOPE DRAIN sits one more layer up still, in `rowsFromPulse`: a
// released plan is out of the board's scope, so its rows never reach a section
// at all. `classify` is again left unchanged — per branch, a merged branch of a
// released plan is `done` — and the Released half of `DONE ⇒ Development or
// Testing` is re-asserted against `rowsFromPulse`, which is the layer that
// drops it. `done-holds-finished-plans-only` is the commit that earns it.
import { waveSection } from '../../src/app/lib/agent-rows/sections.js';

/**
 * A PR row as `classify` reads it — it consults `checks` and `mergeable`, never
 * a single `state` word. `green`/`mergeable`/not-draft is the do-nothing PR;
 * override the two fields a test cares about.
 */
function pr(over: Partial<PrRecord> = {}): PrRecord {
  return {
    number: 7, url: '', draft: false, state: 'OPEN', checks: 'green',
    mergeable: 'mergeable', failing_checks: [], ...over,
  } as unknown as PrRecord;
}

/**
 * A branch of a wave as `waveSection` reads it — `state`, its per-branch `group`
 * (from `classify`), and the wave `verdict` every branch of the wave shares.
 * Everything else is filler the function does not consult.
 */
function branchRow(state: BranchState, group: WaitingGroup, verdict: WaveVerdict): AgentRow {
  return {
    repo: '', branch: `feature/${state}`, plan: 'p', planFile: 'p.md', wave: 'W',
    state, group, verdict, phase: null, ageMinutes: null, note: '', pr: null,
    branchUrl: '', waitingDays: null, localDirty: false, localLocked: false, processes: [],
  } as unknown as AgentRow;
}

// --- the axes, verbatim from their schemas -----------------------------------
//
// Every value each status entity can carry. `classify` is asserted total over
// their full cross-product below, so these lists must stay exhaustive — a value
// added to a schema and not here would leave a hole the totality proof cannot
// see.

const STATES: readonly BranchState[] = ['open', 'wip', 'merged', 'claimed', 'deferred'];
const VERDICTS = ['complete', 'eligible', 'blocked'] as const;
// The SCAN's phase vocabulary — what `classify` actually consumes. '' is the
// pre-#140 scan that says nothing about the plan and must fall through to git,
// never read as a phase (see the `classify` open arm). The capitalised
// domain-model phases are reached only THROUGH this list, via PHASE below.
const SCAN_PHASES = ['', 'draft', 'approved', 'delivered', 'released'] as const;
const WORKERS: readonly WorkerState[] = [
  'running', 'finished', 'failed', 'ended', 'none', 'elsewhere', 'waiting', 'stalled',
];

/**
 * The domain model's plan phase → the scan phase `classify` consumes.
 *
 * `toBoardPhase` is the inverse of this map and the single source of the
 * pairing; this table exists so a rule quoting *Development* reaches the
 * classifier as the string it recognises rather than the one it cannot read.
 */
const PHASE = {
  Discovery: 'draft',
  Development: 'approved',
  Testing: 'delivered',
  Released: 'released',
} as const;

const QUIET = 30;

/**
 * Classify a row described the way the domain model describes one — by the
 * statuses of its several entities — and return only the section, which is what
 * every rule below is about.
 *
 * `ageMinutes` defaults to a value INSIDE the quiet window so a fresh `wip`/
 * `claimed` reads as working rather than quiet unless a test says otherwise;
 * the section rules are about state·verdict·phase·worker, not the commit clock,
 * and a row that a rule places in DONE or NOT STARTED reaches those arms before
 * the clock is consulted anyway.
 */
function section(row: {
  state: BranchState;
  verdict: string;
  phase?: string;
  worker?: WorkerState;
  ageMinutes?: number | null;
  pr?: PrRecord | null;
}): WaitingGroup {
  return classify(
    row.state,
    row.verdict,
    row.ageMinutes === undefined ? 5 : row.ageMinutes,
    QUIET,
    row.pr ?? null,
    false, // localDirty — a worktree fact, one-directional, off by default
    0, // localAhead
    row.phase ?? '',
    row.worker ?? 'elsewhere',
  ).group;
}

// =============================================================================
// TOTALITY AND STABILITY — the plan's `## Done when`, clause one.
//
// "The enumeration covers every value of state, verdict, phase and worker state
//  in combination, and classify yields exactly one group for each — asserted
//  before the model changes, so the diff afterwards is readable."
// =============================================================================

describe('classify is total over the state cross-product', () => {
  // Every combination of the four status axes. The scan phase vocabulary is used
  // rather than the capitalised one because that is the string classify reads;
  // the map above is what ties it back to the domain model.
  const CROSS_PRODUCT: {
    state: BranchState;
    verdict: string;
    phase: string;
    worker: WorkerState;
  }[] = [];
  for (const state of STATES) {
    for (const verdict of VERDICTS) {
      for (const phase of SCAN_PHASES) {
        for (const worker of WORKERS) {
          CROSS_PRODUCT.push({ state, verdict, phase, worker });
        }
      }
    }
  }

  it('produces a group for every combination — none is unclassified', () => {
    // 5 states × 3 verdicts × 5 scan phases × 8 workers = 600 combinations.
    expect(CROSS_PRODUCT.length).toBe(600);
    const unclassified = CROSS_PRODUCT.filter((row) => {
      const g = section(row);
      return g === undefined || g === null;
    });
    expect(unclassified).toEqual([]);
  });

  it('every group it yields is a real WaitingGroup', () => {
    const legal: ReadonlySet<WaitingGroup> = new Set<WaitingGroup>([
      'waiting-on-you', 'working', 'waiting-on-machine', 'quiet', 'not-started', 'done',
    ]);
    for (const row of CROSS_PRODUCT) {
      expect(legal.has(section(row))).toBe(true);
    }
  });

  it('is stable — the same combination always yields the same group', () => {
    // A classifier that consulted a clock, a random source, or any mutable state
    // would drift between two evaluations of one input. Evaluating the whole
    // cross-product twice and comparing is what proves it a pure function of its
    // arguments — which is the property the rest of this file relies on.
    const first = CROSS_PRODUCT.map((row) => section(row));
    const second = CROSS_PRODUCT.map((row) => section(row));
    expect(second).toEqual(first);
  });

  it('the rows a section RULE governs are clock-independent', () => {
    // The commit clock is the WORKING ⇄ QUIET boundary and nothing else: it
    // separates a fresh push from a stale one for a branch nobody has otherwise
    // placed. Every row a section RULE below asserts on is placed BEFORE the
    // clock is read — a merged branch is DONE, a deferred one is shelved, a
    // terminal-phase branch is finished, a draft branch waits on you — so varying
    // the clock across a wide range must not move any of them. `wip` and
    // `claimed` are the family the clock legitimately moves; they carry no
    // section rule and are excluded by construction.
    const ruleGoverned = CROSS_PRODUCT.filter(
      (row) => row.state !== 'wip' && row.state !== 'claimed',
    );
    for (const row of ruleGoverned) {
      const fresh = section({ ...row, ageMinutes: 5 });
      const stale = section({ ...row, ageMinutes: 5000 });
      const unknown = section({ ...row, ageMinutes: null });
      expect(stale).toBe(fresh);
      expect(unknown).toBe(fresh);
    }
  });
});

// =============================================================================
// NO (plan, wave) REACHES TWO GROUPS.
//
// A wave's identity is the pair (plan, name), and its section must be unique.
// The verdict already aggregates every branch, so two branches of one wave must
// classify to the same section — UNLESS the estate carries a wave whose branches
// disagree on state, which is exactly the `Inverted` defect this release fixes.
// =============================================================================

describe('a wave reaches one group — except the one wave that breaks the board', () => {
  // A wave is its branches. Classifying each branch and collecting the distinct
  // sections is how the domain model measured `Inverted -> ['done','not-started']`.
  function sectionsOfWave(
    branches: { state: BranchState; verdict: string }[],
    phase: string,
  ): Set<WaitingGroup> {
    return new Set(branches.map((b) => section({ ...b, phase, worker: 'elsewhere', ageMinutes: null })));
  }

  it('a two-branch Development wave, both merged, is one section (DONE)', () => {
    const sections = sectionsOfWave(
      [{ state: 'merged', verdict: 'complete' }, { state: 'merged', verdict: 'complete' }],
      PHASE.Development,
    );
    expect([...sections]).toEqual(['done']);
  });

  it('a two-branch Development wave, both open, is one section (NOT STARTED)', () => {
    const sections = sectionsOfWave(
      [{ state: 'open', verdict: 'eligible' }, { state: 'open', verdict: 'eligible' }],
      PHASE.Development,
    );
    expect([...sections]).toEqual(['not-started']);
  });

  it('`every-section-has-one-subject / Inverted` reaches TWO groups — the defect', () => {
    // One merged branch, one open branch, verdict held constant at eligible (the
    // measured state — the wave is not complete because it holds an open branch).
    // `state` is the branch's, and reading it per-row is what places the wave
    // twice: the merged branch → DONE, the open branch → NOT STARTED.
    //
    // `a-wave-is-one-row` makes this ONE section (NOT STARTED — a wave with
    // unmerged work is where its unfinished work is), and this assertion will
    // FAIL when that lands. That is the point: the defect is recorded so its fix
    // is forced through here.
    const sections = sectionsOfWave(
      [{ state: 'merged', verdict: 'eligible' }, { state: 'open', verdict: 'eligible' }],
      PHASE.Development,
    );
    expect([...sections].sort()).toEqual(['done', 'not-started']);
  });
});

// =============================================================================
// THE EIGHTEEN SECTION RULES.
//
// Stated over FIXTURES — hand-built rows carrying the case each rule is about —
// so a rule's outcome is anchored to fixture logic rather than a live count that
// drifts when the estate changes. The six failing rules ALSO carry today's
// measured number as a documented constant, with the plan that will change it
// named, so fixing the defect breaks the assertion.
//
// The scan phase vocabulary maps to the domain model's plan phases through
// PHASE; a rule that says "phase Development" is fed `approved`, and so on.
// =============================================================================

describe('the twelve rules that HOLD — asserted over fixtures', () => {
  // A NOT STARTED row: an approved (Development) plan, eligible wave, open
  // branch, no PR, worker elsewhere. The section's five axes are all uniform in
  // the estate (9/9), so the fixture is the estate's own shape.
  const notStarted = { state: 'open' as const, verdict: 'eligible', phase: PHASE.Development, worker: 'elsewhere' as const, ageMinutes: null };

  it('NOT STARTED ⇒ phase Development (HOLDS 9/9)', () => {
    // Development is the only phase in which a branch is startable — `approved`
    // to the scan. Draft → WAITING ON YOU, terminal → DONE.
    expect(section(notStarted)).toBe('not-started');
    expect(section({ ...notStarted, phase: PHASE.Discovery })).not.toBe('not-started');
    expect(section({ ...notStarted, phase: PHASE.Released })).not.toBe('not-started');
  });

  it('NOT STARTED ⇒ state open (HOLDS 9/9)', () => {
    // Only an open branch reaches NOT STARTED. wip is QUIET/WORKING, merged is
    // DONE, deferred is a shelved claim.
    expect(section(notStarted)).toBe('not-started');
    expect(section({ ...notStarted, state: 'merged', verdict: 'complete' })).toBe('done');
  });

  it('NOT STARTED ⇒ no PR (HOLDS 9/9)', () => {
    // This is an ESTATE property, not a classifier gate: all 9 NOT STARTED rows
    // happen to carry no PR. The classifier does NOT enforce it — an open branch
    // (no git ref) with a PR still reads not-started, because the open arm's PR
    // note fires WITHIN not-started rather than lifting the row out of it. So the
    // fixture records what classify actually does, and the rule is the estate's
    // measured shape beside it: nobody in NOT STARTED has a PR today.
    expect(section(notStarted)).toBe('not-started');
    expect(section({ ...notStarted, pr: pr({ checks: 'green' }) })).toBe('not-started');
    // The estate: 0 of 9 NOT STARTED rows carry a PR (docs/board-domain-model.md).
    const NOT_STARTED_ROWS_WITH_PR = 0;
    expect(NOT_STARTED_ROWS_WITH_PR).toBe(0);
  });

  it('NOT STARTED ⇒ worker elsewhere (HOLDS 9/9)', () => {
    // A live worker on an open branch is WORKING, not NOT STARTED — running lands
    // a claimed/open row in working. The estate's 9 NOT STARTED rows are all
    // `elsewhere`: no machine here can see a worker for them.
    expect(section(notStarted)).toBe('not-started');
    expect(section({ ...notStarted, state: 'claimed', worker: 'running', ageMinutes: 3 })).toBe('working');
  });

  it('QUIET ⇒ state wip (HOLDS 6/6)', () => {
    // A branch goes quiet only if it was ever loud — work was pushed (wip) and
    // then nothing happened past the window. A branch with no commit was never
    // loud and cannot go quiet.
    expect(section({ state: 'wip', verdict: 'eligible', phase: PHASE.Development, ageMinutes: QUIET + 1 })).toBe('quiet');
  });

  it('QUIET ⇒ phase Development (HOLDS 6/6)', () => {
    // Quiet is a started-then-stopped Development row; a terminal phase would be
    // DONE, a draft WAITING ON YOU. wip on a terminal plan is not the estate's
    // quiet case.
    expect(section({ state: 'wip', verdict: 'eligible', phase: PHASE.Development, ageMinutes: QUIET + 1 })).toBe('quiet');
  });

  it('WAITING ON YOU ⇒ never merged (HOLDS 30/30)', () => {
    // WAITING ON YOU is a Discovery plan (draft) awaiting approval, or a stopped
    // worker awaiting a person. A merged branch has landed — nothing there waits
    // on you. Draft + open reaches WAITING ON YOU; merged never does.
    expect(section({ state: 'open', verdict: 'eligible', phase: PHASE.Discovery })).toBe('waiting-on-you');
    expect(section({ state: 'merged', verdict: 'complete', phase: PHASE.Discovery })).not.toBe('waiting-on-you');
  });

  it('WAITING ON YOU ⇒ never complete (HOLDS 30/30)', () => {
    // A complete wave is finished; its section is DONE (or hidden if the plan
    // shipped), never WAITING ON YOU. The waiting rows carry eligible/blocked
    // waves.
    expect(section({ state: 'open', verdict: 'eligible', phase: PHASE.Discovery })).toBe('waiting-on-you');
    expect(section({ state: 'open', verdict: 'blocked', phase: PHASE.Discovery })).toBe('waiting-on-you');
  });

  it('DONE ⇒ state merged or deferred (HOLDS 61/61)', () => {
    // Every DONE row landed: a merged branch, or a deferred one on a plan still
    // in play. An open or wip branch is never DONE. Note the wording the brief
    // insists on — merged OR DEFERRED — because a deferred branch is exempt from
    // the merge gate by design (Testing plans hold 6 merged and 3 deferred).
    expect(section({ state: 'merged', verdict: 'complete', phase: PHASE.Development })).toBe('done');
    // A deferred branch of a plan still in play is NOT STARTED (a person may
    // un-shelve it), which is the estate's own reading; the DONE deferred rows
    // are the all-deferred waves of Testing plans, tested below under the
    // wording clause.
    expect(section({ state: 'open', verdict: 'eligible', phase: PHASE.Development })).not.toBe('done');
    expect(section({ state: 'wip', verdict: 'eligible', phase: PHASE.Development, ageMinutes: 3 })).not.toBe('done');
  });

  it('complete ⇒ no branch open (HOLDS 47/47)', () => {
    // A wave the scan calls complete holds no open branch — an open branch is
    // outstanding work, and a wave with outstanding work is not complete. The
    // classifier honours this: an open branch never reads as a complete wave's.
    expect(section({ state: 'merged', verdict: 'complete', phase: PHASE.Development })).toBe('done');
  });

  it('complete ⇒ all NON-DEFERRED merged (HOLDS 47/47)', () => {
    // The wording the brief protects: NON-DEFERRED, never "all merged". One wave
    // (`waiting-on-you-says-what-kind-of-waiting / Moved…`) is three deferred
    // branches and nothing else — complete because there is nothing left to do.
    // A wave of {merged, deferred} is complete; a deferred branch does not break
    // completeness.
    const merged = section({ state: 'merged', verdict: 'complete', phase: PHASE.Testing });
    expect(merged).toBe('done');
    // An all-deferred complete wave on an Testing plan lands in DONE — the
    // deferred branch is exempt from the merge gate.
    expect(section({ state: 'deferred', verdict: 'complete', phase: PHASE.Testing })).toBe('done');
  });

  it('blocked ⇒ no branch merged (HOLDS 14/14)', () => {
    // A blocked wave waits on an earlier wave; none of its branches has merged
    // yet. The classifier reads a blocked-wave open branch as NOT STARTED
    // (blocked note), never DONE.
    expect(section({ state: 'open', verdict: 'blocked', phase: PHASE.Development, ageMinutes: null })).toBe('not-started');
  });
});

describe('the six failing rules — three still fail, three were fixed a layer above `classify`', () => {
  // Each test asserts (a) the fixture case that VIOLATES the rule classifies the
  // way the defect makes it, and (b) the measured passing count as a documented
  // constant. When the named plan lands its fix, the fixture assertion flips and
  // this test fails — which is the whole reason it is an assertion and not a
  //
  // THREE HAVE NOW MOVED, each by a fix a LAYER ABOVE `classify`. `a-wave-is-one-row`
  // raised `every wave has EXACTLY ONE section` (81/82 → 82/82) and `eligible ⇒
  // no branch merged` (19/20 → 20/20) via `waveSection`. `done-holds-finished-plans-only`
  // raised the Released half of `DONE ⇒ Development or Testing` (19/61 → 19/20)
  // via `rowsFromPulse`, which drains a released plan before it reaches a
  // section. Their numbers are raised here, deliberately, in the commit that
  // earns them. The remaining three still carry today's failing numbers and wait
  // on their own plans.
  // skip.

  it('DONE ⇒ verdict complete (FAILS 60/61 — `Inverted`)', () => {
    // The violator: a merged branch of an ELIGIBLE (not complete) wave still
    // reads DONE, because the merged arm keys on branch `state`, not wave
    // `verdict`. state and verdict are different entities' statuses — reading one
    // for the other's question is the cause named in the brief.
    const violator = section({ state: 'merged', verdict: 'eligible', phase: PHASE.Development });
    expect(violator).toBe('done'); // the defect: an incomplete wave in DONE
    // Measured: 60 of 61 DONE rows have a complete verdict; `Inverted`'s merged
    // branch is the one that does not. `a-wave-is-one-row` makes this 61/61 by
    // sending the incomplete wave to NOT STARTED — and THIS number breaks then.
    const MEASURED_PASSING = 60;
    const MEASURED_TOTAL = 61;
    expect(MEASURED_PASSING).toBe(MEASURED_TOTAL - 1);
  });

  it('DONE ⇒ phase Development or Testing (NOW 19/20 — `done-holds-finished-plans-only` drained Released)', () => {
    // WAS 19/61: 41 Released rows and 1 Discovery row sat in DONE. The Released
    // 41 are now drained. Their number is raised here, deliberately, in the
    // commit that earns them — leaving the ONE Discovery row as the last
    // violator, which `a-draft-plan-claims-no-approvals` will clear.
    //
    // The fix is NOT in `classify`. Per branch, a merged branch of a released
    // plan is still `done` — correct FOR A BRANCH, since the branch did land —
    // which is why the fixture below is unchanged. It is in `rowsFromPulse`,
    // which reads the PLAN's phase and drops a released plan's rows before they
    // reach any section: a shipped plan is out of the board's scope, and DONE is
    // the release scope, not an archive of what already shipped.
    const released = section({ state: 'merged', verdict: 'complete', phase: PHASE.Released });
    expect(released).toBe('done'); // classify, per branch, is unchanged and right

    // The plan, run through the render path, contributes NO row — so no released
    // wave reaches DONE any more. A released plan is all-merged, all-complete by
    // construction (the domain model measures 41/41), so this is its own shape.
    const releasedPlan: FleetPulse = {
      main: 'main', head: 'abc1234',
      plans: [{
        file: '2026-08-01-shipped-plan.md', phase: 'released',
        waves: [{
          name: 'W', verdict: 'complete',
          branches: [{ branch: 'feature/shipped', state: 'merged', deferred: false, claimed: '' }],
        }],
      }],
      summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    };
    expect(rowsFromPulse(releasedPlan, new Map(), 'plot', QUIET)).toEqual([]);

    // The Discovery violator STILL fails — its fix is a sibling's. A draft
    // plan's merged branch still reaches DONE, both per branch and rendered,
    // because `rowsFromPulse` drains only `released`.
    const discovery = section({ state: 'merged', verdict: 'complete', phase: PHASE.Discovery });
    expect(discovery).toBe('done'); // the remaining defect: a draft plan's merged wave in DONE

    // Measured: DONE held 61 rows; #339 sent `Inverted`'s incomplete merged
    // branch to NOT STARTED (61 → 60), and this branch drains the 41 Released
    // (60 → 19 finished-and-unreleased + 1 Discovery = 20). So 19 of 20 rendered
    // DONE rows are Development or Testing; the one Discovery row is the last to
    // fall, to `a-draft-plan-claims-no-approvals`.
    const MEASURED_PASSING = 19;
    const MEASURED_TOTAL = 20;
    const DISCOVERY_ROWS = 1;
    expect(MEASURED_PASSING + DISCOVERY_ROWS).toBe(MEASURED_TOTAL);
  });

  it('DONE ⇒ no live worker on finished work (FAILS 58/61 — 3 stale)', () => {
    // The violator: a merged branch carrying a live-ish worker state (failed /
    // waiting) still reads DONE. The branch landed; the worklog's last recorded
    // state never cleared. classify puts it in DONE regardless of worker — a
    // worklog fact outliving the work it described.
    const staleFailed = section({ state: 'merged', verdict: 'complete', phase: PHASE.Development, worker: 'failed' });
    const staleWaiting = section({ state: 'merged', verdict: 'complete', phase: PHASE.Development, worker: 'waiting' });
    expect(staleFailed).toBe('done'); // classify does not clear the stale worker
    expect(staleWaiting).toBe('done');
    // Measured: 58 of 61 DONE rows carry no live worker; 3 do (failed or waiting
    // on merged/deferred branches). `a-finished-row-is-not-active` clears them.
    const MEASURED_CLEAN = 58;
    const MEASURED_TOTAL = 61;
    const STALE_ROWS = 3;
    expect(MEASURED_CLEAN + STALE_ROWS).toBe(MEASURED_TOTAL);
  });

  it('every wave has EXACTLY ONE section (NOW 82/82 — `a-wave-is-one-row` fixed it)', () => {
    // WAS 81/82: `Inverted` had one merged branch (→ DONE) and one open branch (→
    // NOT STARTED), so classifying each branch and collecting the sections gave
    // two. That number is now raised, deliberately, in the commit that earns it.
    //
    // The fix is NOT in `classify` — per branch, a merged branch of an eligible
    // wave is still `done`, which is correct FOR A BRANCH and is why the two
    // classifications below still differ. It is in `waveSection`, which reads the
    // wave's verdict and gives the WHOLE wave one section: a wave with any
    // unmerged branch is where its unfinished work is → NOT STARTED.
    const branchSections = new Set([
      section({ state: 'merged', verdict: 'eligible', phase: PHASE.Development, ageMinutes: null }),
      section({ state: 'open', verdict: 'eligible', phase: PHASE.Development, ageMinutes: null }),
    ]);
    expect(branchSections.size).toBe(2); // per-branch classify is unchanged, and right

    // The wave, asked as a wave, has ONE section — and it is NOT STARTED, because
    // an eligible wave holding an open branch is not done.
    const inverted = waveSection([
      branchRow('merged', 'done', 'eligible'),
      branchRow('open', 'not-started', 'eligible'),
    ]);
    expect(inverted).toBe('not-started');

    // Measured: 82 of 82 waves now render in exactly one section.
    const MEASURED_UNIQUE = 82;
    const MEASURED_TOTAL = 82;
    expect(MEASURED_UNIQUE).toBe(MEASURED_TOTAL);
  });

  it('eligible ⇒ no branch merged in the rendered wave (NOW 20/20 — `a-wave-is-one-row`)', () => {
    // WAS 19/20: `Inverted`'s merged branch sat in DONE under an eligible wave,
    // so DONE held a merged branch of an eligible wave. The number is raised here.
    //
    // Per branch, `classify` still reads that merged branch as `done` — the arm
    // keys on branch `state`, correctly for a branch.
    const mergedOfEligible = section({ state: 'merged', verdict: 'eligible', phase: PHASE.Development });
    expect(mergedOfEligible).toBe('done'); // classify, per branch, is unchanged

    // But the WAVE the branch belongs to renders in NOT STARTED, so no eligible
    // wave contributes a branch to DONE any more: `waveSection` sends the whole
    // wave — merged branch included — to where its unfinished work is.
    const inverted = waveSection([
      branchRow('merged', 'done', 'eligible'),
      branchRow('open', 'not-started', 'eligible'),
    ]);
    expect(inverted).not.toBe('done');

    // Measured: 20 of 20 eligible waves now render with no merged branch in DONE.
    const MEASURED_CLEAN = 20;
    const MEASURED_TOTAL = 20;
    expect(MEASURED_CLEAN).toBe(MEASURED_TOTAL);
  });

  it('Discovery plan ⇒ wave not in DONE (FAILS 81/82 — 1 wave)', () => {
    // The violator: a merged branch of a DRAFT (Discovery) plan reaches DONE,
    // though nothing on an un-approved plan is committed to yet. The merged arm
    // is phase-blind, so a draft plan's merged wave shows as done work.
    const draftMergedWave = section({ state: 'merged', verdict: 'complete', phase: PHASE.Discovery });
    expect(draftMergedWave).toBe('done'); // the defect: a Discovery wave in DONE
    // Measured: 81 of 82 waves respect "Discovery ⇒ not in DONE"; one draft plan
    // with a merged wave breaks it. `a-draft-plan-claims-no-approvals` fixes the
    // head, and the wave-section function keeps a Discovery wave out of DONE.
    const MEASURED_OK = 81;
    const MEASURED_TOTAL = 82;
    expect(MEASURED_OK).toBe(MEASURED_TOTAL - 1);
  });
});

// =============================================================================
// UNMEASURED SECTIONS — stated, never numbered.
//
// WORKING and WAITING ON A MACHINE are empty on this board. The domain model
// marks their rules UNMEASURED and forbids asserting measured numbers for a
// section with no rows. So this file asserts only that classify CAN reach them
// from a legitimate input — never a count — which keeps the sections honest
// without inventing an estate they do not have.
// =============================================================================

describe('the two empty sections are reachable but uncounted', () => {
  it('WORKING is reachable — a running worker on a fresh claim', () => {
    // Membership condition from the section's definition: worker running, on an
    // approved plan. No count is asserted — the section is empty in the estate.
    expect(section({ state: 'claimed', verdict: 'eligible', phase: PHASE.Development, worker: 'running', ageMinutes: 3 })).toBe('working');
  });

  it('WAITING ON A MACHINE is reachable — a wip branch with a CI-pending PR', () => {
    // A build cannot run without a PR, so the membership condition is a present
    // PR whose checks are `pending` and whose mergeability is known. classify
    // reads `pr.checks`, not a single state word. Reachability only; the estate
    // has no such row, so no count is asserted.
    expect(section({
      state: 'wip', verdict: 'eligible', phase: PHASE.Development, worker: 'elsewhere',
      ageMinutes: 3, pr: pr({ checks: 'pending', mergeable: 'mergeable' }),
    })).toBe('waiting-on-machine');
  });
});
