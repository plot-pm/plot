import { describe, it, expect } from 'vitest';
import { classify } from '../../src/server/fleet.js';
import type { BranchState, WorkerState } from '../../src/contract/schema.js';

// THE INVARIANT: no row pairs `verdict: unapproved` with `group: not-started`.
//
// Swept over every `BranchState`, with and without a deferred reason, at age
// `null`/5/5000 with `quietMinutes` 30, over worker `none`/`elsewhere`/
// `running`, with no worktree or a held one. See `draftPlacement` in
// `@plot-pm/domain` and `docs/plans/
// 2026-10-02-a-draft-slice-waits-on-its-approval.md`'s Done-when.

const QUIET = 30;
const STATES: readonly BranchState[] = [
  'open', 'claimed', 'wip', 'blocked', 'waiting', 'deferred', 'merged', 'unknown',
];
const AGES: readonly (number | null)[] = [null, 5, 5000];
const WORKERS: readonly WorkerState[] = ['none', 'elsewhere', 'running'];
const DEFERRED_REASONS = ['', 'superseded by #42'];
const HELD = [false, true];

interface Case {
  state: BranchState;
  deferredReason: string;
  ageMinutes: number | null;
  worker: WorkerState;
  held: boolean;
}

const cases: Case[] = [];
for (const state of STATES) {
  // A deferred reason only varies anything for `deferred`; sweeping it for
  // every other state would multiply the fixture without adding a case the
  // rule treats differently.
  const reasons = state === 'deferred' ? DEFERRED_REASONS : [''];
  for (const deferredReason of reasons) {
    for (const ageMinutes of AGES) {
      for (const worker of WORKERS) {
        for (const held of HELD) {
          cases.push({ state, deferredReason, ageMinutes, worker, held });
        }
      }
    }
  }
}

const run = (c: Case, planPhase: string) => classify(
  c.state, 'eligible', c.ageMinutes, QUIET, null,
  held_dirty(c), 0, planPhase,
  c.worker, '', c.worker === 'running' ? '4242' : '', false,
  [], '', c.held, '', false, c.deferredReason, false, false,
  '',
);
// A held worktree is reported DIRTY here: `held` alone with a clean tree
// answers `held in a local worktree` from `localActivity`, which is a
// DIFFERENT sentence from an empty one, and the sweep wants the activity
// signal lifted whichever sentence it produces.
const held_dirty = (c: Case) => c.held;

describe('a Draft plan never reads not-started, for any swept state', () => {
  it('holds the fixture: an age-5, worker-none row exists for claimed and for wip', () => {
    // THE GUARD. Without this the sweep passes vacuously if a fixture bug
    // drops the fresh rows — and those are exactly the rows a fix of only the
    // no-work arms misses.
    const hasFreshNoneRow = (state: BranchState) =>
      cases.some((c) => c.state === state && c.ageMinutes === 5 && c.worker === 'none');
    expect(hasFreshNoneRow('claimed')).toBe(true);
    expect(hasFreshNoneRow('wip')).toBe(true);
  });

  it('never answers group: not-started for a Draft plan, across the whole sweep', () => {
    const offenders: string[] = [];
    for (const c of cases) {
      const r = run(c, 'draft');
      if (r.group === 'not-started') {
        offenders.push(JSON.stringify(c));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('answers group: working for every row with a running worker that reaches the worker block', () => {
    // `open` and `deferred` answer from their OWN arms, above the worker
    // block (`classifyGroup`'s `if (state !== 'merged')` guard) — `open` has
    // no ref yet to run a worker against, and a deferred branch is never
    // `working` by the arm's own rule: "the group is about the claim the row
    // makes... work somebody gave up is not work in progress". Every other
    // non-merged state passes through the worker block and a running worker
    // there outranks everything below it.
    const offenders: string[] = [];
    for (const c of cases) {
      if (c.worker !== 'running' || c.state === 'merged' || c.state === 'open' || c.state === 'deferred') continue;
      const r = run(c, 'draft');
      if (r.group !== 'working') {
        offenders.push(`${JSON.stringify(c)} -> ${r.group}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
