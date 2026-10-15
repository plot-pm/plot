import { describe, expect, it } from 'vitest';

import { agentLoop, type AgentLoopReadings } from '../src/workflows/agent-loop.js';
import {
  endingAction,
  killedWorkerEnding,
  needsPersonMarker,
  type EndingActionReadings,
} from '../src/rules/ending-action.js';
import { reapProblems, type TreeReadings } from '../src/rules/reapable.js';
import type { Write } from '../src/workflows/decision.js';

const BRANCH = 'bug/a-slice-the-desk-held-before';

const freeLoopAtBound = (over: Partial<AgentLoopReadings> = {}): AgentLoopReadings =>
  ({
    assignedBranch: '',
    waitedSeconds: 28851,
    boundSeconds: 28800,
    registration: 'unset',
    worktree: '/estate/.worktrees/free-04e1f562',
    ...over,
  }) as AgentLoopReadings;

const mergedDesk = (over: Partial<TreeReadings> = {}): TreeReadings => ({
  branch: BRANCH,
  defaultBranch: 'main',
  isMain: false,
  workerPid: null,
  dirtyPath: '',
  blockedMarker: false,
  merge: 'merged',
  ...over,
});

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
  ...over,
});

describe('a free loop that ends at the wait bound — the full path', () => {
  it('writes no marker, no declaration and no ending, so the desk reaps', () => {
    const result = agentLoop(freeLoopAtBound());
    const kinds = result.writes.map((w: Write) => w.kind);
    expect(result.detail.exitCode).toBe(124);
    expect(kinds).not.toContain('blocked-marker');
    expect(kinds).not.toContain('declaration');
    expect(kinds).not.toContain('loop-end');

    // No marker was written, so the tree reads markerless and the reaper's
    // `blocked-marker` refusal does not fire.
    const refusals = reapProblems(mergedDesk({ blockedMarker: kinds.includes('blocked-marker') })).map((p) => p.refusal);
    expect(refusals).not.toContain('blocked-marker');
    expect(refusals).toEqual([]);
  });

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
