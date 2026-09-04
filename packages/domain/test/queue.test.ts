import { describe, it, expect } from 'vitest';
import {
  assign,
  isHandOverReady,
  matchQueue,
  whyNotReady,
  type QueueAgent,
  type QueuedSlice,
} from '../src/index.js';

/**
 * The registry's queue and its assignment lock.
 *
 * **THIS IS WHERE *never the same slice twice* IS ASSERTED.** Until this rule
 * existed the property was unassertable: every agent shopped for its own branch
 * through `plot-fleet-scan.sh --offline --next`, and the only thing that stopped
 * two of them taking one branch was git rejecting the second claim push — a
 * refusal that fires AFTER the estate is already broken, and one no unit test
 * can reach without two processes and a remote.
 *
 * Matching is a pure function of its readings, so the invariant is now a plain
 * assertion over a record.
 */

const slice = (over: Partial<QueuedSlice> = {}): QueuedSlice => ({
  branch: 'feature/x',
  slug: 'a-plan',
  briefPresent: true,
  claimable: true,
  ...over,
});

const agent = (session: string, over: Partial<QueueAgent['reading']> = {}): QueueAgent => ({
  session,
  worktree: `/desks/${session}`,
  reading: { state: 'running', branch: '', sliceHasMerged: false, ...over },
});

describe('isHandOverReady — the brief gate, at the hand-over', () => {
  it('hands over a claimable slice with a brief', () => {
    expect(isHandOverReady(slice())).toBe(true);
    expect(whyNotReady(slice())).toBeNull();
  });

  it('holds a claimable slice with no brief, the gate rule unchanged', () => {
    expect(isHandOverReady(slice({ briefPresent: false }))).toBe(false);
    expect(whyNotReady(slice({ briefPresent: false }))).toBe('no-brief');
  });

  it('holds an unclaimable slice, and says so rather than blaming the brief', () => {
    // A slice held by its plan's phase, its ordering or a `waits:` prerequisite
    // is not a slice missing a brief, and a reader sent to write one would be
    // sent to fix the wrong thing.
    expect(whyNotReady(slice({ claimable: false, briefPresent: false }))).toBe('not-claimable');
  });
});

describe('matchQueue — one slice to one agent', () => {
  it('hands each queued slice to a different free agent', () => {
    const match = matchQueue({
      slices: [slice({ branch: 'feature/a' }), slice({ branch: 'feature/b' })],
      agents: [agent('s1'), agent('s2')],
    });

    expect(match.assignments.map((a) => [a.branch, a.session])).toEqual([
      ['feature/a', 's1'],
      ['feature/b', 's2'],
    ]);
  });

  it('never hands one agent two slices', () => {
    const match = matchQueue({
      slices: [slice({ branch: 'feature/a' }), slice({ branch: 'feature/b' })],
      agents: [agent('s1')],
    });

    const sessions = match.assignments.map((a) => a.session);
    expect(new Set(sessions).size).toBe(sessions.length);
    expect(match.assignments).toHaveLength(1);
    expect(match.held).toEqual([{ branch: 'feature/b', hold: 'no-free-agent' }]);
  });

  it('never hands one slice to two agents', () => {
    const match = matchQueue({
      slices: [slice({ branch: 'feature/a' })],
      agents: [agent('s1'), agent('s2')],
    });

    const branches = match.assignments.map((a) => a.branch);
    expect(new Set(branches).size).toBe(branches.length);
    expect(match.assignments).toHaveLength(1);
    expect(match.idle).toEqual(['s2']);
  });

  it('holds every slice and refuses nothing when no agent is free', () => {
    // `0 free` is a COUNT and a report. Refusing the run here is the capacity
    // coupling `DESIGN-machine.md` §10 rejected twice; the queue absorbs it.
    const match = matchQueue({
      slices: [slice({ branch: 'feature/a' })],
      agents: [agent('s1', { branch: 'feature/busy' })],
    });

    expect(match.assignments).toEqual([]);
    expect(match.held).toEqual([{ branch: 'feature/a', hold: 'no-free-agent' }]);
    expect(match.idle).toEqual([]);
  });

  it('skips a slice with no brief and gives its agent to the next one', () => {
    const match = matchQueue({
      slices: [slice({ branch: 'feature/a', briefPresent: false }), slice({ branch: 'feature/b' })],
      agents: [agent('s1')],
    });

    expect(match.assignments).toEqual([
      { session: 's1', worktree: '/desks/s1', branch: 'feature/b', slug: 'a-plan' },
    ]);
    expect(match.held).toEqual([{ branch: 'feature/a', hold: 'no-brief' }]);
  });

  it('takes agents in registry order and slices in plan order', () => {
    // The pass is a function of its readings and ranks nothing: two daemons
    // reading one estate reach one answer, and which work matters is the
    // plan author's judgement rather than this rule's.
    const match = matchQueue({
      slices: [slice({ branch: 'feature/a' }), slice({ branch: 'feature/b' })],
      agents: [agent('s2'), agent('s1')],
    });

    expect(match.assignments.map((a) => a.session)).toEqual(['s2', 's1']);
  });

  it('counts an agent whose slice has landed as free', () => {
    const match = matchQueue({
      slices: [slice({ branch: 'feature/a' })],
      agents: [agent('s1', { branch: 'feature/done', sliceHasMerged: true })],
    });

    expect(match.assignments.map((a) => a.session)).toEqual(['s1']);
  });

  it('passes over an agent blocked on a person', () => {
    const match = matchQueue({
      slices: [slice({ branch: 'feature/a' })],
      agents: [agent('s1', { state: 'waiting' }), agent('s2')],
    });

    expect(match.assignments.map((a) => a.session)).toEqual(['s2']);
  });

  it('decides nothing over an empty queue', () => {
    expect(matchQueue({ slices: [], agents: [agent('s1')] })).toEqual({
      assignments: [],
      held: [],
      idle: ['s1'],
    });
  });
});

describe('assign — the hand-over workflow', () => {
  it('names one manifest write per assignment and refuses nothing', () => {
    const decision = assign({
      slices: [slice({ branch: 'feature/a' }), slice({ branch: 'feature/b' })],
      agents: [agent('s1'), agent('s2')],
    });

    expect(decision.outcome).toBe('decided');
    expect(decision.workflow).toBe('assign');
    expect(decision.writes).toEqual([
      { kind: 'agent-assign', session: 's1', worktree: '/desks/s1', branch: 'feature/a', slug: 'a-plan' },
      { kind: 'agent-assign', session: 's2', worktree: '/desks/s2', branch: 'feature/b', slug: 'a-plan' },
    ]);
  });

  it('decides with no writes when nothing is free, rather than refusing', () => {
    const decision = assign({
      slices: [slice()],
      agents: [agent('s1', { branch: 'feature/busy' })],
    });

    expect(decision.outcome).toBe('decided');
    expect(decision.writes).toEqual([]);
    expect(decision.detail.held).toEqual([{ branch: 'feature/x', hold: 'no-free-agent' }]);
  });

  it('bounds a pass, and reports what the bound held rather than dropping it', () => {
    const decision = assign(
      {
        slices: [slice({ branch: 'feature/a' }), slice({ branch: 'feature/b' })],
        agents: [agent('s1'), agent('s2')],
      },
      { max: 1 },
    );

    expect(decision.writes).toHaveLength(1);
    expect(decision.detail.assignments.map((a) => a.branch)).toEqual(['feature/a']);
    expect(decision.detail.held).toEqual([{ branch: 'feature/b', hold: 'no-free-agent' }]);
    expect(decision.detail.idle).toEqual(['s2']);
  });

  it('performs nothing — the decision holds every write and makes none', () => {
    const decision = assign({ slices: [slice()], agents: [agent('s1')] });
    expect(decision.writes.every((write) => write.kind === 'agent-assign')).toBe(true);
  });
});
