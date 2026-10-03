import { describe, it, expect } from 'vitest';
import { classify } from '../../src/server/fleet.js';
import { DRAFT_PLAN_NOTE } from '../../src/contract/schema.js';
import type { BranchState, WorkerState } from '../../src/contract/schema.js';

// THE DRAFT RULE READS EVERY STATE.
//
// `classifyGroup` checked `planPhase === 'draft'` in only two arms, `deferred`
// and `open`. The no-work arms (`blocked`/`waiting`/`unknown`/unrecognised),
// the fresh `claimed` and `wip` returns, and every `localActivity` return
// placed a Draft plan's branch in NOT STARTED — pairing `verdict: unapproved`
// with `group: not-started`, which the board's own invariant forbids. See
// `draftPlacement` in `@plot-pm/domain` and `docs/plans/
// 2026-10-02-a-draft-slice-waits-on-its-approval.md`.

const QUIET = 30;

/**
 * `classify` with the arguments this suite varies spelled by NAME, matching
 * `a-slice-with-no-work-waits-in-not-started.test.ts`'s own helper.
 */
const classifyBranch = (over: {
  state: BranchState;
  verdict?: string;
  planPhase?: string;
  worker?: WorkerState;
  ageMinutes?: number | null;
  localDirty?: boolean;
  localAhead?: number;
  localLocked?: boolean;
  held?: boolean;
  deferredReason?: string;
  waitsOn?: readonly string[];
}) => classify(
  over.state, over.verdict ?? 'eligible', over.ageMinutes === undefined ? null : over.ageMinutes, QUIET, null,
  over.localDirty ?? false, over.localAhead ?? 0, over.planPhase ?? 'draft',
  over.worker ?? 'none', '', over.worker === 'running' ? '4242' : '', over.localLocked ?? false,
  [], '', over.held ?? false, '', false, over.deferredReason ?? '', false, false,
  over.waitsOn ?? [],
);

describe('a Draft plan\'s no-work states answer the draft rule', () => {
  for (const state of ['blocked', 'waiting', 'unknown'] as const) {
    it(`${state} reads waiting-on-you with the draft note`, () => {
      expect(classifyBranch({ state })).toEqual({
        group: 'waiting-on-you',
        note: DRAFT_PLAN_NOTE,
        verdict: 'eligible',
      });
    });
  }

  it('an unrecognised state also reads waiting-on-you with the draft note', () => {
    expect(classifyBranch({ state: 'rebasing' as BranchState })).toEqual({
      group: 'waiting-on-you',
      note: DRAFT_PLAN_NOTE,
      verdict: 'eligible',
    });
  });
});

describe('a Draft plan\'s open branch with a held worktree', () => {
  it('reads waiting-on-you with the draft note, not NOT STARTED\'s "held in a local worktree"', () => {
    expect(classifyBranch({ state: 'open', held: true })).toEqual({
      group: 'waiting-on-you',
      note: DRAFT_PLAN_NOTE,
      verdict: 'eligible',
    });
  });
});

describe('an Approved plan\'s blocked branch is unchanged', () => {
  it('still reads not-started naming its missing PR', () => {
    expect(classifyBranch({ state: 'blocked', planPhase: 'approved', verdict: 'blocked', waitsOn: ['bug/x'] }))
      .toEqual({ group: 'not-started', note: 'waits for bug/x, which has no pull request', verdict: 'blocked' });
  });
});

describe('a live worker still outranks the draft rule', () => {
  it('a Draft blocked branch with a running worker reads working', () => {
    expect(classifyBranch({ state: 'blocked', worker: 'running' }).group).toBe('working');
  });
});
