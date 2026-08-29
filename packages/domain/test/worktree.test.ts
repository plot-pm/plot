import { describe, it, expect } from 'vitest';
import {
  WorktreeStateSchema,
  ReapRefusalSchema,
  holdsUnlandedWork,
  isOrphan,
  reapRefusals,
  isReapable,
  type Worktree,
} from '../src/index.js';

/**
 * The agent's desk — the only entity that exists as bytes on a disk.
 *
 * Its physicality is what makes it authoritative: *a shared file is a
 * prediction, but a desk somebody is sitting at is a measurement*. And it is
 * why dispatch alone can see it — the fleet scan derives from `origin/<branch>`,
 * so two implemented, green branches whose work was never pushed both read
 * `eligible` with no claim to contradict them.
 */

const desk: Worktree = {
  path: '/tmp/wt-feature-x',
  branch: 'feature/x',
  isMain: false,
  clean: true,
  agentSession: 'sess-1',
  prunable: false,
};

/** Everything measured of a finished, landed desk — the reapable baseline. */
const landed = { workerAlive: false, blockedMarker: false, hasMergedPr: true, defaultBranch: 'main' };

describe('the worktree vocabularies are closed sets', () => {
  it('names the five lifecycle states', () => {
    expect(WorktreeStateSchema.options).toEqual(['created', 'occupied', 'finished', 'reapable', 'gone']);
    expect(WorktreeStateSchema.safeParse('idle').success).toBe(false);
  });

  it('names the five reap refusals', () => {
    expect(ReapRefusalSchema.options).toEqual([
      'live-worker', 'uncommitted-changes', 'blocked-marker', 'on-default-branch', 'no-merged-pr',
    ]);
  });
});

describe('clean is two questions, and an uncheckable tree is not clean', () => {
  it('reads an unclean tree as holding work', () => {
    // No uncommitted changes AND no unpushed commits. A tree that cannot be
    // checked returns false, so the entry stays visible rather than being
    // silently dropped.
    expect(holdsUnlandedWork({ ...desk, clean: false })).toBe(true);
    expect(holdsUnlandedWork(desk)).toBe(false);
  });
});

describe('a tree with no agent is an orphan, not a free desk', () => {
  it('distinguishes owned from orphaned', () => {
    // The ownership runs one way: the worktree is the agent's desk. An orphan
    // is a different thing to report, not an unoccupied one to take.
    expect(isOrphan(desk)).toBe(false);
    expect(isOrphan({ ...desk, agentSession: null })).toBe(true);
  });
});

describe('a reap refuses on measurements, never on judgement', () => {
  it('removes a finished, landed, clean desk', () => {
    expect(reapRefusals(desk, landed)).toEqual([]);
    expect(isReapable(desk, landed)).toBe(true);
  });

  it('refuses a live worker', () => {
    expect(reapRefusals(desk, { ...landed, workerAlive: true })).toContain('live-worker');
  });

  it('refuses uncommitted work — one stall left 324 finished lines on the floor', () => {
    expect(reapRefusals({ ...desk, clean: false }, landed)).toContain('uncommitted-changes');
  });

  it('refuses a tree holding a PLOT-BLOCKED marker', () => {
    // A stopped worker owes a person an answer; removing its desk discards the
    // question.
    expect(reapRefusals(desk, { ...landed, blockedMarker: true })).toContain('blocked-marker');
  });

  it('refuses a tree sitting on the default branch', () => {
    // Its dispatched branch is not checked out, so its state was never
    // measured — nothing here is evidence about the work.
    expect(reapRefusals({ ...desk, branch: 'main' }, landed)).toContain('on-default-branch');
    expect(reapRefusals({ ...desk, isMain: true }, landed)).toContain('on-default-branch');
  });

  it('refuses a tree whose branch never merged', () => {
    // Read from a merged PR, never from ancestry: a squash-merge leaves the
    // branch permanently ahead of main, and ancestry alone cleared 1 of 29
    // finished trees here while the host cleared the other 28.
    expect(reapRefusals(desk, { ...landed, hasMergedPr: false })).toContain('no-merged-pr');
    expect(isReapable(desk, { ...landed, hasMergedPr: false })).toBe(false);
  });

  it('reports every refusal that applies, not just the first', () => {
    // An operator seeing only `live-worker` would kill the worker and try
    // again, learning about the uncommitted work one refusal at a time.
    const refusals = reapRefusals(
      { ...desk, clean: false, branch: 'main' },
      { workerAlive: true, blockedMarker: true, hasMergedPr: false, defaultBranch: 'main' },
    );
    expect(refusals).toEqual([
      'live-worker', 'uncommitted-changes', 'blocked-marker', 'on-default-branch', 'no-merged-pr',
    ]);
  });
});
