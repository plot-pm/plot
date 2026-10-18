import { describe, expect, it } from 'vitest';

import {
  endingAction,
  killedWorkerEnding,
  needsPersonMarker,
  type EndingActionReadings,
} from '../src/rules/ending-action.js';

const BRANCH = 'bug/a-slice-the-desk-held-before';

const endingReadings = (over: Partial<EndingActionReadings> = {}): EndingActionReadings => ({
  ending: null,
  branch: BRANCH,
  refusedAssignment: '',
  hasManifest: false,
  priorFreshSessions: 0,
  commitBeyondClaim: 'no',
  prOpen: false,
  dirtyTree: 'no',
  prMerged: 'merged',
  endingAsked: false,
  blockedMarker: false,
  freeWait: false,
  ...over,
});

describe('a free loop that ends at the wait bound — the full path', () => {
  // #1784: this block used to open with a test asserting agentLoop(freeLoopAtBound())
  // writes no blocked-marker/declaration/loop-end and that feeding those kinds into
  // reapProblems(mergedDesk(...)) yields no refusals. Both halves are fully subsumed:
  // workflows-agent-loop.test.ts's "ends the free wait with no ending reason, exit 124"
  // already asserts `result.writes` is empty outright (stronger than the three
  // not.toContain checks here), and reapable.test.ts already asserts
  // refusalsOf(landed()) === [] for the same unblocked/merged fixture. Removed as
  // redundant rather than kept for its wiring alone.

  it('is answered `leave` by the supervisor tick that finds the desk with exit 124 and no ending', () => {
    // The tick turns "exit 124, no ending, no live loop, branch still checked out"
    // into an `unreadable` ending; for a merged branch `endingAction` leaves it.
    const written = killedWorkerEnding({ ending: { read: 'absent' }, exit: '124', loopAlive: false, branch: BRANCH });
    expect(written?.reason).toBe('unreadable');
    expect(endingAction(endingReadings({ ending: written?.reason ?? null }))).toBe('leave');
  });

  it('is answered `leave` for a desk with no ending record at all', () => {
    expect(endingAction(endingReadings({ ending: null }))).toBe('leave');
    expect(endingAction(endingReadings({ ending: null, prMerged: 'unanswerable' }))).toBe('leave');
  });
});

describe('the marker the 2026-10-15 desks received', () => {
  // Before the fix `.plot-worker.ending.json` was never cleared: ROW 2 writes
  // nothing, and an answered `blocked` ending stayed on the desk after its slice
  // finished or the desk was reset onto another slice
  // (`loop-ports.test.ts` pins both removals). A free
  // loop that later ends at the bound leaves that record as the desk's only
  // ending, and `endingAction` reads it as current whenever the host does not
  // confirm the merge.
  it('is composed from a leftover `blocked` ending read while the host does not confirm the merge', () => {
    const stale = endingReadings({ ending: 'blocked', prMerged: 'unanswerable' });
    expect(endingAction(stale)).toBe('needs-a-person');
    expect(needsPersonMarker('blocked', BRANCH, 'the agent declared itself blocked')).toContain(
      'Decide how it should proceed, or close out the slice.',
    );
  });

  it('stays `leave` while the host confirms the merge', () => {
    expect(endingAction(endingReadings({ ending: 'blocked', prMerged: 'merged' }))).toBe('leave');
  });
});

describe('#1917 — a free desk ending acts on no slice', () => {
  // A free wait's `unreadable` (supervisor, exit 124) carries no slice at all.
  // Before the fix, an unmerged branch reached `isBoundEnding`'s
  // `boundBranchHoldsWork` check and answered `start-fresh` or
  // `release-claim` for work the desk's PRIOR slice left behind — never this
  // free wait's own. `freeWait: true` must short-circuit to `leave` before
  // that check runs, whatever the branch holds.
  it('answers `leave` for an open PR left by the slice before this free wait', () => {
    const reading = endingReadings({
      ending: 'unreadable',
      prMerged: 'not-merged',
      prOpen: true,
      freeWait: true,
    });
    expect(endingAction(reading)).toBe('leave');
  });

  it('answers `leave` for a commit beyond the claim left by the slice before this free wait', () => {
    const reading = endingReadings({
      ending: 'unreadable',
      prMerged: 'not-merged',
      commitBeyondClaim: 'yes',
      freeWait: true,
    });
    expect(endingAction(reading)).toBe('leave');
  });

  it('answers `leave` even where the branch holds nothing beyond its claim', () => {
    const reading = endingReadings({
      ending: 'unreadable',
      prMerged: 'not-merged',
      freeWait: true,
    });
    expect(endingAction(reading)).toBe('leave');
  });

  it('answers `leave` where the free-wait reading itself could not be taken', () => {
    const reading = endingReadings({
      ending: 'unreadable',
      prMerged: 'not-merged',
      prOpen: true,
      freeWait: 'unanswerable',
    });
    expect(endingAction(reading)).toBe('leave');
  });

  it('still answers `start-fresh` for a mid-slice `unreadable` ending the desk\'s records do not call a free wait', () => {
    const reading = endingReadings({
      ending: 'unreadable',
      prMerged: 'not-merged',
      prOpen: true,
      freeWait: false,
    });
    expect(endingAction(reading)).toBe('start-fresh');
  });
});
