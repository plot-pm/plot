import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mayResolve, repairEnabledFromEnv, repairFor, repairLogPath, resetRepairs, startRepair,
  REPAIR_ECHO_MS,
} from '../../src/server/resolver.js';
import { stuckState } from '../../src/server/stuck.js';
import { BOARD_ARTIFACT_PATH, type Stuck } from '../../src/contract/schema.js';

// THE ENTRY CONDITION IS THE PERMISSION, so these tests are mostly refusals.
//
// The one automatic write this system grants exists because of three verified
// properties — `-merge` keeps the file valid, the rebuild is deterministic, CI's
// no-diff gate proves it. Widening the condition, adding a second automatic
// path, or pushing before the local gate would each remove the argument that
// grants the permission while leaving code that still looks correct. Every
// assertion below is aimed at an implementation that would pass the positive
// case and fail one of those.

const OTHER = 'packages/board/src/server/fleet.ts';

function stuck(over: Partial<Stuck>): Stuck {
  return {
    state: 'artifact-conflict',
    conflicts: [BOARD_ARTIFACT_PATH],
    localAhead: 0,
    changedPaths: [],
    failingChecks: [],
    runHistory: [],
    ...over,
  };
}

describe('mayResolve — exactly one state, and only on an observed set', () => {
  it('accepts an artifact-only conflict', () => {
    expect(mayResolve(stuck({}))).toBe(true);
  });

  // THE PAIRING THAT MATTERS. An implementation asking *is the artifact among
  // the conflicts* passes every artifact-only assertion above and silently
  // repairs merges that need judgement as a whole. A conflict touching the
  // artifact AND anything else is one of those, even though one of its files
  // would resolve mechanically on its own.
  it('refuses a mixed conflict set — the artifact plus one other file', () => {
    const mixed = stuckState({
      state: 'wip',
      conflicts: [BOARD_ARTIFACT_PATH, OTHER],
      conflictsKnown: true,
      localAhead: 0,
    });
    expect(mixed?.state).toBe('conflict');
    expect(mayResolve(mixed)).toBe(false);

    // And directly, in case a future detector ever mislabels one: the guard
    // does not take the state's word for the set it names.
    expect(mayResolve(stuck({ conflicts: [BOARD_ARTIFACT_PATH, OTHER] }))).toBe(false);
  });

  // A HOST VERDICT WITH NO OBSERVED SET. `merge-tree` predicts from the refs
  // THIS machine holds; the host computed against the branch as it stands, so a
  // stale ref makes the prediction wrong in the REASSURING direction. Both
  // 2026-08-17 artifact conflicts appeared only at `gh pr merge`. The artifact
  // case rests entirely on the set being exactly one known file — and here
  // there is no set at all.
  it('refuses a host-declared conflict with an empty conflicts array', () => {
    const hostOnly = stuckState({
      state: 'wip',
      conflicts: [],
      conflictsKnown: false,
      localAhead: 0,
      prState: 'conflicts',
    });
    expect(hostOnly?.state).toBe('conflict');
    expect(hostOnly?.conflicts).toEqual([]);
    expect(mayResolve(hostOnly)).toBe(false);

    // Restated at this layer: an `artifact-conflict` carrying no set would be
    // the same guess wearing the one label licensed to write.
    expect(mayResolve(stuck({ conflicts: [] }))).toBe(false);
  });

  // NO OTHER FAILURE GAINS AN AUTOMATIC PATH. A real code conflict has no
  // deterministic resolution, a red check has no rebuild that proves it, and an
  // unpushed rebase is someone else's work in progress.
  it('refuses conflict, ci-failing and unpushed — every other stuck state', () => {
    expect(mayResolve(stuck({ state: 'conflict', conflicts: [OTHER] }))).toBe(false);
    expect(mayResolve(stuck({ state: 'ci-failing', conflicts: [] }))).toBe(false);
    expect(mayResolve(stuck({ state: 'unpushed', conflicts: [], localAhead: 3 }))).toBe(false);
    // The whole set, so a state added later must be considered rather than
    // inherited: exactly one of the four is repairable.
    const states = ['artifact-conflict', 'conflict', 'ci-failing', 'unpushed'] as const;
    const allowed = states.filter((s) =>
      mayResolve(stuck({ state: s, conflicts: [BOARD_ARTIFACT_PATH] })));
    expect(allowed).toEqual(['artifact-conflict']);
  });

  it('refuses a healthy branch — null is the common answer', () => {
    expect(mayResolve(null)).toBe(false);
    expect(mayResolve(undefined)).toBe(false);
  });
});

describe('startRepair — what is started, and what is refused', () => {
  let repoRoot: string;
  let started: string[];
  let opts: Parameters<typeof startRepair>[2];

  beforeEach(() => {
    resetRepairs();
    started = [];
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-resolver-'));
    opts = {
      repoRoot,
      scriptsDir: '/scripts',
      // The seam exists so a REFUSAL is asserted as the absence of a call
      // rather than as the absence of a side effect on disk — the assertion
      // most likely to pass for the wrong reason.
      spawnRepair: ({ branch }) => { started.push(branch); },
    };
  });

  it('starts a repair for an artifact-only conflict and for nothing else', () => {
    expect(startRepair('feature/a', stuck({}), opts)).toBe(true);
    expect(startRepair('feature/b', stuck({ state: 'conflict', conflicts: [OTHER] }), opts))
      .toBe(false);
    expect(startRepair('feature/c', stuck({ state: 'unpushed', localAhead: 2 }), opts))
      .toBe(false);
    expect(startRepair('feature/d', stuck({ state: 'ci-failing', conflicts: [] }), opts))
      .toBe(false);
    expect(startRepair('feature/e', null, opts)).toBe(false);

    // The load-bearing assertion: the refusals SPAWNED NOTHING. Every other
    // assertion here can pass while the side effect still happened.
    expect(started).toEqual(['feature/a']);
  });

  // TWO REPAIRS NEVER RUN ON ONE BRANCH AT ONCE. The pulse fires every 5 s and
  // the repair takes minutes, during which the branch stays `artifact-conflict`
  // — so without this guard the SECOND pulse starts a duplicate that fights the
  // first over the same worktree, and the artifact belongs to neither run.
  it('refuses a second repair while the first is in flight', () => {
    expect(startRepair('feature/a', stuck({}), opts)).toBe(true);
    expect(startRepair('feature/a', stuck({}), opts)).toBe(false);
    expect(startRepair('feature/a', stuck({}), opts)).toBe(false);
    expect(started).toEqual(['feature/a']);
  });
});

describe('every repair is reported — running, pushed and abandoned alike', () => {
  let repoRoot: string;
  let exit: ((code: number | null) => void) | null;
  let opts: Parameters<typeof startRepair>[2];

  beforeEach(() => {
    resetRepairs();
    exit = null;
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-resolver-'));
    opts = {
      repoRoot,
      scriptsDir: '/scripts',
      spawnRepair: ({ onExit }) => { exit = onExit; },
    };
  });

  it('says a repair is running while it runs', () => {
    startRepair('feature/a', stuck({}), opts);
    const r = repairFor('feature/a');
    expect(r?.state).toBe('running');
    expect(r?.outcome).toBe('');
  });

  it('reports the pushed outcome the SCRIPT declared, from its log', () => {
    startRepair('feature/a', stuck({}), opts);
    fs.writeFileSync(repairLogPath(repoRoot, 'feature/a'),
      'step: pushed feature/a\nsummary: branch=feature/a outcome=pushed reason=artifact-conflict-resolved\n');
    exit!(0);

    const r = repairFor('feature/a');
    expect(r?.state).toBe('finished');
    expect(r?.outcome).toBe('pushed');
    expect(r?.reason).toBe('artifact-conflict-resolved');
  });

  // THE FAILURE IS REPORTED AS LOUDLY AS THE SUCCESS. A resolver that reported
  // only its successes would be quietest exactly when a reader needs it, and a
  // silent automatic write is indistinguishable from a defect — which is the
  // failure mode this whole plan exists to remove.
  it('reports an abandoned repair, naming the gate that stopped it', () => {
    startRepair('feature/a', stuck({}), opts);
    fs.writeFileSync(repairLogPath(repoRoot, 'feature/a'),
      'step: test:board failed — pushing nothing\nsummary: branch=feature/a outcome=abandoned reason=tests-failed\n');
    exit!(1);

    const r = repairFor('feature/a');
    expect(r?.state).toBe('finished');
    expect(r?.outcome).toBe('abandoned');
    expect(r?.reason).toBe('tests-failed');
  });

  it('never reports pushed for a run whose log it could not read and whose exit was non-zero', () => {
    startRepair('feature/a', stuck({}), opts);
    exit!(1);
    expect(repairFor('feature/a')?.outcome).toBe('abandoned');
  });

  it('a finished repair stops being reported once its echo expires', () => {
    startRepair('feature/a', stuck({}), opts);
    exit!(0);
    const now = Date.now();
    expect(repairFor('feature/a', now)).not.toBeNull();
    expect(repairFor('feature/a', now + REPAIR_ECHO_MS + 1)).toBeNull();
  });

  it('a branch nothing was attempted on reports nothing', () => {
    expect(repairFor('feature/untouched')).toBeNull();
  });

  // The branch is released for a LATER repair once the first finishes: a lock
  // that outlived its process would make one interrupted run block the branch
  // forever, and the repair is idempotent.
  it('allows a fresh repair after the previous one finished', () => {
    startRepair('feature/a', stuck({}), opts);
    exit!(0);
    expect(startRepair('feature/a', stuck({}), opts)).toBe(true);
  });
});

// RETRY WHEN THE INPUT CHANGES, NOT WHEN THE CLOCK TICKS.
//
// The pulse fires every 5 s and the branch stays `artifact-conflict` throughout,
// so a refusal that leaves the input untouched is restarted by the very next
// pulse. Measured on 2026-08-17: five identical entries in the log, one per
// pulse, each reaching into the same worktree — a loop with no new information
// between iterations.
describe('a not-observed refusal does not repeat on unchanged input', () => {
  let repoRoot: string;
  let started: string[];
  let exit: ((code: number | null) => void) | null;
  let opts: Parameters<typeof startRepair>[2];

  /** Finish the in-flight repair the way the script would have, via its log. */
  function finishWith(branch: string, outcome: string, reason: string, code: number) {
    fs.writeFileSync(repairLogPath(repoRoot, branch),
      `summary: branch=${branch} outcome=${outcome} reason=${reason}\n`);
    exit!(code);
  }

  beforeEach(() => {
    resetRepairs();
    started = [];
    exit = null;
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-resolver-'));
    opts = {
      repoRoot,
      scriptsDir: '/scripts',
      spawnRepair: ({ branch, onExit }) => { started.push(branch); exit = onExit; },
    };
  });

  // THE MEASURED SYMPTOM, as an assertion: the second pulse with unchanged input
  // produces no second attempt.
  it('refuses the next pulse after a not-observed refusal', () => {
    expect(startRepair('feature/a', stuck({}), opts)).toBe(true);
    finishWith('feature/a', 'refused', 'not-observed', 1);

    expect(startRepair('feature/a', stuck({}), opts)).toBe(false);
    expect(startRepair('feature/a', stuck({}), opts)).toBe(false);
    // The load-bearing assertion — the pulses SPAWNED NOTHING. Five identical
    // log entries was the symptom; one is the fix.
    expect(started).toEqual(['feature/a']);
  });

  // AND IT IS NOT A PERMANENT BLOCK. Suppressing until a restart would turn one
  // transient refusal into a branch that is never repaired again — the opposite
  // failure, and the harder one to notice.
  // THE SUPPRESSION IS ON A VALUE, NOT AN IDENTITY. Every pulse builds a fresh
  // `Stuck` object, so a check comparing references would suppress nothing at
  // all and the loop would survive the fix looking repaired.
  it('suppresses an equal-but-distinct input object', () => {
    startRepair('feature/a', stuck({}), opts);
    finishWith('feature/a', 'refused', 'not-observed', 1);

    expect(startRepair('feature/a', stuck({}), opts)).toBe(false);
    expect(started).toEqual(['feature/a']);
  });

  // AND IT IS NOT A PERMANENT BLOCK. Suppressing until a restart would turn one
  // transient refusal into a branch that is never repaired again — the opposite
  // failure, and the harder one to notice. The input this decision rests on is
  // the state and the set, so a change to either is a new reading.
  it('retries once the observed set changes', () => {
    startRepair('feature/a', stuck({}), opts);
    finishWith('feature/a', 'refused', 'not-observed', 1);
    expect(startRepair('feature/a', stuck({}), opts)).toBe(false);

    // The board re-observed the branch and the artifact is no longer alone in
    // the set. `mayResolve` refuses that outright, so it cannot show a retry —
    // what it shows is that the NOTE is cleared rather than sticky: once the set
    // returns to artifact-only, the repair is available again.
    startRepair('feature/a', stuck({ state: 'conflict', conflicts: [OTHER] }), opts);
    expect(started).toEqual(['feature/a']);

    // A fresh reading of the repairable case, after a run that ended otherwise.
    resetRepairs();
    startRepair('feature/a', stuck({}), opts);
    finishWith('feature/a', 'pushed', 'artifact-conflict-resolved', 0);
    expect(startRepair('feature/a', stuck({}), opts)).toBe(true);
  });

  // SCOPED TO not-observed ALONE. Every other outcome may legitimately differ on
  // a second run: a suite can pass, a remote can stop moving, a busy worktree's
  // owner can finish. Suppressing those would be a repair never retried after
  // the world fixed itself.
  it('does not suppress after any other outcome', () => {
    const cases: Array<[string, string, number]> = [
      ['abandoned', 'tests-failed', 1],
      ['abandoned', 'build-failed', 1],
      ['refused', 'not-artifact-only', 1],
      ['refused', 'worktree-busy', 1],
      ['pushed', 'artifact-conflict-resolved', 0],
    ];
    for (const [outcome, reason, code] of cases) {
      resetRepairs();
      started = [];
      startRepair('feature/a', stuck({}), opts);
      finishWith('feature/a', outcome, reason, code);
      expect(startRepair('feature/a', stuck({}), opts),
        `${outcome}/${reason} must not suppress the next repair`).toBe(true);
      expect(started).toEqual(['feature/a', 'feature/a']);
    }
  });

  // A LOG THAT COULD NOT BE READ IS NOT A not-observed REFUSAL. The exit code
  // alone cannot tell one failure from another, and suppressing on that guess
  // would silence repairs that should retry.
  it('does not suppress when the outcome could not be read', () => {
    startRepair('feature/a', stuck({}), opts);
    exit!(1);
    expect(startRepair('feature/a', stuck({}), opts)).toBe(true);
  });
});

// THE OFF SWITCH — an operator can take the write away without taking the
// board, or the report, with it.
//
// The repair is the one automatic write in the whole system, and until now it
// was gated on state alone: an operator who wanted to SEE artifact conflicts
// without the board acting on them had to stop the board. These assertions are
// aimed at the two ways a switch goes wrong — one that fails to disable, and
// one that disables more than it was asked to.
describe('PLOT_BOARD_REPAIR — the repair is refusable, and only ever downward', () => {
  let repoRoot: string;
  let started: string[];
  let opts: Parameters<typeof startRepair>[2];

  beforeEach(() => {
    resetRepairs();
    started = [];
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-resolver-'));
    opts = {
      repoRoot,
      scriptsDir: '/scripts',
      spawnRepair: ({ branch }) => { started.push(branch); },
    };
  });

  // HALF ONE OF THE CONTRACT: nothing is written.
  it('starts nothing when the repair is switched off', () => {
    expect(startRepair('feature/a', stuck({}), { ...opts, repairEnabled: false })).toBe(false);
    // The load-bearing half. `false` is also what every refusal returns, so the
    // return value alone cannot tell a disabled repair from a refused one —
    // only the absence of the spawn can.
    expect(started).toEqual([]);
  });

  // HALF TWO, AND THE ONE A NARROWER IMPLEMENTATION LOSES: turning the repair
  // off must not turn off the SEEING. An operator who silences the write and
  // thereby loses the report has swapped one blindness for another — so the
  // detector still classifies the conflict, and the row still names it.
  it('still detects and reports the conflict it will not repair', () => {
    const seen = stuckState({
      state: 'wip',
      conflicts: [BOARD_ARTIFACT_PATH],
      conflictsKnown: true,
      localAhead: 0,
    });
    expect(seen?.state).toBe('artifact-conflict');
    expect(seen?.conflicts).toEqual([BOARD_ARTIFACT_PATH]);

    startRepair('feature/a', seen, { ...opts, repairEnabled: false });
    expect(started).toEqual([]);
    // Detection is untouched by the switch: the same input still reads as
    // repairable, which is what the row renders from.
    expect(mayResolve(seen)).toBe(true);
  });

  // A DISABLED REPAIR LEAVES NO TRACE OF ONE. The fences below the switch write
  // as they refuse — `inFlight` marks a branch as being repaired — so a switch
  // placed after them would leave the branch reported as under repair forever,
  // by a process that never started one.
  it('reports no repair at all on a branch it declined to touch', () => {
    startRepair('feature/a', stuck({}), { ...opts, repairEnabled: false });
    expect(repairFor('feature/a')).toBe(null);
  });

  // AND THE SWITCH IS NOT STICKY. A disabled board must not poison the branch
  // for a board that comes back with the repair on.
  it('repairs normally once the switch is on again', () => {
    expect(startRepair('feature/a', stuck({}), { ...opts, repairEnabled: false })).toBe(false);
    expect(startRepair('feature/a', stuck({}), opts)).toBe(true);
    expect(started).toEqual(['feature/a']);
  });

  // THE PER-BRANCH LOCK STILL HOLDS. The switch is one more fence in a stack
  // whose second entry is what keeps two repairs off one worktree; adding a
  // gate above it must not have moved or bypassed it.
  it('still refuses a second repair while the first is in flight', () => {
    expect(startRepair('feature/a', stuck({}), { ...opts, repairEnabled: true })).toBe(true);
    expect(startRepair('feature/a', stuck({}), { ...opts, repairEnabled: true })).toBe(false);
    expect(started).toEqual(['feature/a']);
  });

  // THE VARIABLE NEVER CONVERTS A REFUSAL INTO A REPAIR.
  //
  // `isArtifactOnly` refuses any conflict set that is not exactly the artifact,
  // and that refusal is what licenses the write at all — the repair is a script
  // rather than an agent precisely because judgement's absence IS the
  // permission. An implementation reading the switch as *should this branch be
  // repaired* rather than as *may this process repair* passes every assertion
  // above and fails this one.
  it('refuses a conflict touching source even when explicitly switched ON', () => {
    const mixed = stuckState({
      state: 'wip',
      conflicts: [BOARD_ARTIFACT_PATH, OTHER],
      conflictsKnown: true,
      localAhead: 0,
    });
    expect(mixed?.state).toBe('conflict');
    expect(startRepair('feature/a', mixed, { ...opts, repairEnabled: true })).toBe(false);

    // And a plain source conflict, with the artifact nowhere in it.
    expect(startRepair('feature/b', stuck({ state: 'conflict', conflicts: [OTHER] }),
      { ...opts, repairEnabled: true })).toBe(false);

    expect(started).toEqual([]);
  });
});

// UNSET BEHAVES EXACTLY AS TODAY — asserted, rather than reasoned.
//
// This is the assertion the default is most likely to lose silently. A parse
// that read unset as OFF would leave every test above passing (they state the
// flag) while every real board quietly stopped repairing, which looks from the
// outside exactly like a repair that never triggered.
describe('repairEnabledFromEnv — unset is on, and only "0" is off', () => {
  it('is on when the variable is unset', () => {
    expect(repairEnabledFromEnv({})).toBe(true);
  });

  it('is off for exactly "0"', () => {
    expect(repairEnabledFromEnv({ PLOT_BOARD_REPAIR: '0' })).toBe(false);
  });

  it('is on for "1"', () => {
    expect(repairEnabledFromEnv({ PLOT_BOARD_REPAIR: '1' })).toBe(true);
  });

  // AN UNRECOGNISED VALUE IS NOT AN OFF SWITCH. The default is the behaviour
  // that shipped and is under test; a board whose environment holds a typo
  // keeps doing what an unconfigured board does, rather than silently becoming
  // a board that reports and never writes.
  it('is on for anything else, including values that look like a no', () => {
    for (const value of ['', 'false', 'no', 'off', '00', ' 0', 'true']) {
      expect(repairEnabledFromEnv({ PLOT_BOARD_REPAIR: value }),
        `PLOT_BOARD_REPAIR=${JSON.stringify(value)} must not disable the repair`).toBe(true);
    }
  });

  // THE DEFAULT REACHES startRepair, not just the parser. An options object
  // that never mentions the switch — which is every caller written before it
  // existed — still repairs.
  it('an options object with no repairEnabled still repairs', () => {
    resetRepairs();
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-resolver-'));
    const started: string[] = [];
    const bare = { repoRoot, scriptsDir: '/scripts', spawnRepair: ({ branch }: { branch: string }) => { started.push(branch); } };
    expect('repairEnabled' in bare).toBe(false);
    expect(startRepair('feature/a', stuck({}), bare)).toBe(true);
    expect(started).toEqual(['feature/a']);
  });
});
