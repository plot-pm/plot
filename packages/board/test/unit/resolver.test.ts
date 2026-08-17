import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mayResolve, repairFor, repairLogPath, resetRepairs, startRepair, REPAIR_ECHO_MS,
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
