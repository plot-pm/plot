import { describe, expect, it } from 'vitest';
import { BranchStateSchema, type BranchState } from '../src/entities/fleet.js';
import {
  BRANCH_LIFECYCLE,
  branchStateObservable,
  isDecision,
  isRefusal,
  observeBranchState,
  refProblems,
  refReleasable,
  type RefReadings,
} from '../src/transitions/branch.js';

const BRANCH = 'feature/six-lifecycles-declare-their-rules';

const move = (from: BranchState, to: string) => observeBranchState(BRANCH, from, { to });

/** A merged branch nothing holds — the only shape whose ref may go. */
const releasable: RefReadings = {
  branch: BRANCH,
  defaultBranch: 'main',
  givenUp: false,
  merged: true,
  openPr: false,
  checkedOut: false,
};

describe('the states are consumed, never redeclared', () => {
  it('names the states the entity owns', () => {
    expect([...BRANCH_LIFECYCLE].sort()).toEqual([...BranchStateSchema.options].sort());
  });
});

describe('the path work takes', () => {
  it('goes open -> claimed -> wip -> merged', () => {
    expect(isDecision(move('open', 'claimed'))).toBe(true);
    expect(isDecision(move('claimed', 'wip'))).toBe(true);
    expect(isDecision(move('wip', 'merged'))).toBe(true);
  });

  it('lets a person skip the claim, because nobody dispatched them', () => {
    expect(isDecision(move('open', 'wip'))).toBe(true);
  });

  it('reports a merged branch as landed', () => {
    const result = move('wip', 'merged');
    expect(isDecision(result) && result.landed).toBe(true);
  });

  it('lets an unknown branch become anything a reading can produce', () => {
    for (const to of ['open', 'claimed', 'wip', 'merged', 'deferred'] as const) {
      expect(isDecision(move('unknown', to))).toBe(true);
    }
  });
});

describe('it refuses what the graph does not admit', () => {
  it('refuses an unrecognised state', () => {
    const result = move('open', 'archived');
    expect(isRefusal(result) && result.reason).toBe('state-unrecognised');
  });

  it('refuses a move to the state it already holds', () => {
    expect(isRefusal(move('wip', 'wip')) && (move('wip', 'wip') as { reason: string }).reason)
      .toBe('state-unchanged');
  });

  it('refuses to un-merge, because merged work does not un-merge', () => {
    const result = move('merged', 'open');
    expect(isRefusal(result) && result.reason).toBe('state-terminal');
  });

  it('refuses to move a deferred branch — only editing the plan undoes it', () => {
    const result = move('deferred', 'wip');
    expect(isRefusal(result) && result.reason).toBe('state-terminal');
  });

  it('refuses a backward move within the path', () => {
    const result = move('wip', 'claimed');
    expect(isRefusal(result) && result.reason).toBe('state-unreachable');
  });

  it('refuses to overwrite work with a state about ANOTHER branch', () => {
    // The entity's own sentence, made refusable: `waiting` and `blocked` are
    // what the host said about a branch this one waits on, so a branch carrying
    // work keeps the state its work earned.
    for (const from of ['claimed', 'wip'] as const) {
      for (const to of ['waiting', 'blocked'] as const) {
        const result = move(from, to);
        expect(isRefusal(result) && result.reason).toBe('work-would-be-overwritten');
      }
    }
  });

  it('refuses those two from merged as TERMINAL, which is the stronger answer', () => {
    // `merged` carries work and would also trip `work-would-be-overwritten`,
    // but it is terminal for every destination — a caller told the branch has
    // merged needs that, not a reason specific to two of the eight.
    for (const to of ['waiting', 'blocked'] as const) {
      const result = move('merged', to);
      expect(isRefusal(result) && result.reason).toBe('state-terminal');
    }
  });

  it('admits waiting and blocked from open and unknown, which carry no work', () => {
    for (const from of ['open', 'unknown'] as const) {
      expect(isDecision(move(from, 'waiting'))).toBe(true);
      expect(isDecision(move(from, 'blocked'))).toBe(true);
    }
  });

  it('refuses on an unmet precondition', () => {
    const result = observeBranchState(BRANCH, 'open', {
      to: 'wip',
      preconditions: [{ name: 'refs-listed', met: false, detail: 'git exited 128' }],
    });
    expect(isRefusal(result) && result.reason).toBe('precondition-unmet');
  });

  it('answers the same question through the callable-alone form', () => {
    expect(branchStateObservable(BRANCH, 'open', 'claimed')).toBe(true);
    expect(branchStateObservable(BRANCH, 'merged', 'open')).toBe(false);
  });
});

describe('the ref guards are the release-refs script’s five', () => {
  it('releases a merged branch nothing holds', () => {
    expect(refProblems(releasable)).toEqual([]);
    expect(isDecision(refReleasable(releasable))).toBe(true);
  });

  it('never deletes the default branch', () => {
    const result = refReleasable({ ...releasable, branch: 'main' });
    expect(isRefusal(result) && result.reason).toBe('ref-is-default-branch');
  });

  it('keeps a given-up branch — reconcile needs the ref AND its annotation', () => {
    const result = refReleasable({ ...releasable, givenUp: true });
    expect(isRefusal(result) && result.reason).toBe('ref-deferred');
  });

  it('keeps unlanded work, and an unaskable host answers the same way', () => {
    // `merged: false` is what a host that could not be asked reports, so
    // silence keeps the ref.
    const result = refReleasable({ ...releasable, merged: false });
    expect(isRefusal(result) && result.reason).toBe('ref-unlanded');
  });

  it('keeps a branch with an open PR, even where an older one merged', () => {
    const result = refReleasable({ ...releasable, openPr: true });
    expect(isRefusal(result) && result.reason).toBe('ref-has-open-pr');
  });

  it('keeps a checked-out branch — somebody is reading it', () => {
    const result = refReleasable({ ...releasable, checkedOut: true });
    expect(isRefusal(result) && result.reason).toBe('ref-checked-out');
  });

  it('reports every guard that applies, most urgent first', () => {
    expect(refProblems({ ...releasable, givenUp: true, merged: false, checkedOut: true }))
      .toEqual(['ref-deferred', 'ref-unlanded', 'ref-checked-out']);
  });

  it('refuses on an unmet precondition once the guards pass', () => {
    const result = refReleasable(releasable, [{ name: 'host-asked', met: false }]);
    expect(isRefusal(result) && result.reason).toBe('precondition-unmet');
  });
});
