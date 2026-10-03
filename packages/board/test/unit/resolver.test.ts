import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mayResolve, repairEnabledFromEnv, repairFor, repairLogPath, resetRepairs, startRepair,
  REPAIR_ECHO_MS,
} from '../../src/server/resolver.js';
import { stuckState } from '../../src/server/stuck.js';
import { BOARD_ARTIFACT_PATHS, type Stuck } from '../../src/contract/schema.js';

// EVERY TEMP PATH THIS FILE CREATES, REMOVED BY THE EXACT NAME `mkdtempSync`
// RETURNED. This file created sandboxes and removed none, so each run left them
// in `TMPDIR`; `scripts/owned-run.sh` now fails a run that does.
//
// `rmTree` rather than a raw recursive `fs.rmSync`: CI's *A teardown does not
// race a child* step allows exactly ONE such call under `packages/board/test/`,
// and it is `rmTree`'s own body. `rmTree` also retries ENOTEMPTY/EBUSY/EPERM,
// which is what a teardown racing a still-running child throws.
//
// Never a glob and never a prefix sweep over the shared temp directory.
import { rmTree } from '../helpers.mjs';
const trackTemp = <T extends string>(dir: T): T => {
  trackedTempPaths.push(dir);
  return dir;
};
const trackedTempPaths: string[] = [];
afterAll(() => {
  for (const dir of trackedTempPaths) {
    try { rmTree(dir); } catch { /* a sandbox already gone is the wanted state */ }
  }
});

// Nested one level down: the board writes a repo's agent logs into its parent.
const nestedRepo = (): string => {
  const parent = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-resolver-')));
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(dir);
  return dir;
};


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

/** One bundle, standing for any of the nine — the set is asserted separately. */
const ARTIFACT = BOARD_ARTIFACT_PATHS[0]!;

function stuck(over: Partial<Stuck>): Stuck {
  return {
    state: 'artifact-conflict',
    conflicts: [ARTIFACT],
    localAhead: 0,
    changedPaths: [],
    failingChecks: [],
    runHistory: [],
    ...over,
  };
}

// SWITCHED OFF, since bug/a-pr-carries-no-bundle: a PR's diff carries no
// generated bundle (check-no-bundle-diff.sh refuses one that does), so an
// automatic rebuild pushed by this repair would commit into a PR that gate
// now refuses outright. `mayResolve` refuses every `artifact-conflict`
// unconditionally — the one assertion this slice's "Done when" names — and
// every other case that used to need its own refusal is now subsumed by it.
//
// NOT REMOVED. bug/the-artifact-repair-is-retired deletes `mayResolve`,
// `startRepair` and this file's reporting-layer tests below; this slice only
// closes the one entry point the removal has not yet reached.
describe('mayResolve — switched off, refuses every artifact-conflict', () => {
  it('refuses an artifact-only conflict — the one case this guard used to accept', () => {
    expect(mayResolve(stuck({}))).toBe(false);
  });

  it('refuses a conflict in ANY bundle the build emits, and in several together', () => {
    for (const bundle of BOARD_ARTIFACT_PATHS) {
      expect(mayResolve(stuck({ conflicts: [bundle] }))).toBe(false);
    }
    expect(mayResolve(stuck({ conflicts: [...BOARD_ARTIFACT_PATHS] }))).toBe(false);
  });

  it('refuses every other stuck state too, as it always did', () => {
    expect(mayResolve(stuck({ state: 'conflict', conflicts: [OTHER] }))).toBe(false);
    expect(mayResolve(stuck({ state: 'ci-failing', conflicts: [] }))).toBe(false);
    expect(mayResolve(stuck({ state: 'unpushed', conflicts: [], localAhead: 3 }))).toBe(false);
    const states = ['artifact-conflict', 'conflict', 'ci-failing', 'unpushed'] as const;
    const allowed = states.filter((s) =>
      mayResolve(stuck({ state: s, conflicts: [ARTIFACT] })));
    expect(allowed).toEqual([]);
  });

  it('refuses a healthy branch — null is the common answer', () => {
    expect(mayResolve(null)).toBe(false);
    expect(mayResolve(undefined)).toBe(false);
  });

  // THE TYPE GUARD STILL NARROWS CORRECTLY even though it never returns true at
  // runtime — `stuck is Stuck` is TypeScript's declaration of what a `true`
  // WOULD mean, not a promise that one is reachable. `stuckState` still
  // classifies `artifact-conflict` exactly as it did; only the permission to
  // act on it is gone.
  it('still recognises the classification it refuses to act on', () => {
    const mixed = stuckState({
      state: 'wip',
      conflicts: [ARTIFACT, OTHER],
      conflictsKnown: true,
      localAhead: 0,
    });
    expect(mixed?.state).toBe('conflict');
    expect(mayResolve(mixed)).toBe(false);
  });
});

describe('startRepair — what is started, and what is refused', () => {
  let repoRoot: string;
  let started: string[];
  let opts: Parameters<typeof startRepair>[2];

  beforeEach(() => {
    resetRepairs();
    started = [];
    repoRoot = nestedRepo();
    opts = {
      repoRoot,
      scriptsDir: '/scripts',
      // The seam exists so a REFUSAL is asserted as the absence of a call
      // rather than as the absence of a side effect on disk — the assertion
      // most likely to pass for the wrong reason.
      spawnRepair: ({ branch }) => { started.push(branch); },
    };
  });

  // mayResolve REFUSES EVERY STATE NOW, so startRepair starts nothing for any
  // of them — the artifact-only case included. This is the exact property
  // `bug/a-pr-carries-no-bundle` exists to add: the one write this system used
  // to grant automatically is gone, and nothing downstream needed to change
  // for that to be true, because startRepair's first fence IS mayResolve.
  it('starts a repair for nothing — mayResolve refuses every state, artifact-only included', () => {
    expect(startRepair('feature/a', stuck({}), opts)).toBe(false);
    expect(startRepair('feature/b', stuck({ state: 'conflict', conflicts: [OTHER] }), opts))
      .toBe(false);
    expect(startRepair('feature/c', stuck({ state: 'unpushed', localAhead: 2 }), opts))
      .toBe(false);
    expect(startRepair('feature/d', stuck({ state: 'ci-failing', conflicts: [] }), opts))
      .toBe(false);
    expect(startRepair('feature/e', null, opts)).toBe(false);

    // The load-bearing assertion: NOTHING SPAWNED. Every other assertion here
    // can pass while the side effect still happened.
    expect(started).toEqual([]);
  });
});

// THE REPORTING LAYER (repairFor, the log parse, the echo window) IS UNCHANGED
// CODE, but it can no longer be reached from this test file's only entry
// point: startRepair now refuses before it ever calls spawnRepair, because its
// first fence is mayResolve. bug/the-artifact-repair-is-retired removes this
// machinery outright; until then this block is a record of what untestable
// through the public surface, not a claim that the behavior is gone.
describe.skip('every repair is reported — running, pushed and abandoned alike (unreachable: mayResolve refuses before any repair starts)', () => {
  let repoRoot: string;
  let exit: ((code: number | null) => void) | null;
  let opts: Parameters<typeof startRepair>[2];

  beforeEach(() => {
    resetRepairs();
    exit = null;
    repoRoot = nestedRepo();
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
// ALSO UNREACHABLE: the not-observed fence is startRepair's THIRD check, after
// mayResolve. Since mayResolve now refuses every state, this block's premise —
// a repair that started once and was refused as not-observed — can no longer
// occur. Skipped for the reason the reporting-layer block above states.
describe.skip('a not-observed refusal does not repeat on unchanged input (unreachable: mayResolve refuses before any repair starts)', () => {
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
    repoRoot = nestedRepo();
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
// ALSO UNREACHABLE, for the reason the two blocks above state: every one of
// these assertions turns the switch ON at some point and expects startRepair
// to then succeed, which mayResolve's unconditional refusal now forecloses.
// "starts nothing when switched off" is no longer a distinguishing case — the
// repair starts nothing either way.
describe.skip('PLOT_BOARD_REPAIR — the repair is refusable, and only ever downward (unreachable: mayResolve refuses regardless of the switch)', () => {
  let repoRoot: string;
  let started: string[];
  let opts: Parameters<typeof startRepair>[2];

  beforeEach(() => {
    resetRepairs();
    started = [];
    repoRoot = nestedRepo();
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
      conflicts: [ARTIFACT],
      conflictsKnown: true,
      localAhead: 0,
    });
    expect(seen?.state).toBe('artifact-conflict');
    expect(seen?.conflicts).toEqual([ARTIFACT]);

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
      conflicts: [ARTIFACT, OTHER],
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

  // THE DEFAULT OMITS THE SWITCH ENTIRELY, not just unsets it — every caller
  // written before `PLOT_BOARD_REPAIR` existed passes an options object with no
  // `repairEnabled` key at all, and that path must not throw or behave
  // differently from one that passes `true` explicitly. `mayResolve`'s
  // unconditional refusal means startRepair still starts nothing either way —
  // see the skipped `PLOT_BOARD_REPAIR` block above for what this asserted
  // before that switch-off.
  it('an options object with no repairEnabled starts nothing, same as every other input now', () => {
    resetRepairs();
    const repoRoot = nestedRepo();
    const started: string[] = [];
    const bare = { repoRoot, scriptsDir: '/scripts', spawnRepair: ({ branch }: { branch: string }) => { started.push(branch); } };
    expect('repairEnabled' in bare).toBe(false);
    expect(startRepair('feature/a', stuck({}), bare)).toBe(false);
    expect(started).toEqual([]);
  });
});
