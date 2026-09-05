import { describe, it, expect } from 'vitest';
import {
  assign,
  isHandOverReady,
  matchQueue,
  whyNotReady,
  type FleetCap,
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
  landed: 'not-landed',
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

describe('whyNotReady — a finished slice leaves the queue', () => {
  /**
   * **THE DEFECT THIS ASSERTS COST NOTHING ONLY BECAUSE `--once` WRITES
   * NOTHING.** Measured 2026-09-05, on the first supervisor tick that ever
   * matched agents to slices: three hand-overs were decided and two were
   * branches whose PRs had merged an hour earlier. The queue read *claimed*
   * off the remote ref, and merging deletes the ref — so the one event that
   * finishes a slice returned it to the queue looking untouched. A performing
   * tick would have put two agents on work already on `main`, each opening a
   * duplicate PR.
   */

  it('holds a slice the host says merged, and names the merge rather than the queue', () => {
    expect(whyNotReady(slice({ landed: 'landed' }))).toBe('already-merged');
  });

  it('offers a slice with no PR — the reading that stays is the ref', () => {
    // The correct offer of the three measured: a branch nobody had started,
    // with no PR at all. Adding the landing question must not cost it.
    expect(whyNotReady(slice({ landed: 'not-landed' }))).toBeNull();
    expect(isHandOverReady(slice({ landed: 'not-landed' }))).toBe(true);
  });

  it('holds a slice whose host could not be asked, and says which reading failed', () => {
    // SILENCE WITHHOLDS WORK HERE, WHICH INVERTS THE REAPER'S DIRECTION. There
    // an unreachable host answers *not merged* and keeps a checkout that was
    // about to be deleted; here the same word means *hand this over*, so a
    // quiet host would return every finished branch to the queue at once.
    expect(whyNotReady(slice({ landed: 'unknown' }))).toBe('merge-unknown');
  });

  it('blames the merge before the brief, so nobody is sent to write one for finished work', () => {
    // A merged branch keeps its brief and its plan, so it answers `claimable`
    // and `briefPresent` exactly as unstarted work does. Asked in either other
    // order the hold would read `no-brief` and send a reader to do nothing.
    expect(whyNotReady(slice({ landed: 'landed', briefPresent: false }))).toBe('already-merged');
    expect(whyNotReady(slice({ landed: 'landed', claimable: false }))).toBe('already-merged');
  });

  it('leaves `isHandOverReady` alone — the gate rule was told the wrong thing, not wrong', () => {
    // `rules/queue.ts` reads `claimable && briefPresent` and still does. The
    // landing is asked by `whyNotReady`, which is what `matchQueue` consults.
    expect(isHandOverReady(slice({ landed: 'landed' }))).toBe(true);
    expect(isHandOverReady(slice({ landed: 'unknown' }))).toBe(true);
  });

  it('keeps a merged slice out of the hand-over, and leaves the agent idle', () => {
    // THE PROPERTY THE DEFECT BROKE, asserted where it is decided. A free agent
    // and a finished slice must produce no assignment at all.
    const match = matchQueue({
      slices: [slice({ branch: 'feature/merged', landed: 'landed' })],
      agents: [agent('a')],
    });
    expect(match.assignments).toEqual([]);
    expect(match.held).toEqual([{ branch: 'feature/merged', hold: 'already-merged' }]);
    expect(match.idle).toEqual(['a']);
  });

  it('does not ask for an agent to take a merged slice', () => {
    // `scaleUp` COUNTS `no-free-agent` AND NOTHING ELSE, and this is what says
    // the new holds join the right side of that line: a finished branch is not
    // work waiting for capacity, so it must not pull a worker into existence.
    const decision = assign(
      {
        slices: [
          slice({ branch: 'feature/merged', landed: 'landed' }),
          slice({ branch: 'feature/quiet-host', landed: 'unknown' }),
        ],
        agents: [],
      },
      {
        fleet: {
          size: 3,
          headroom: 'clear',
          spawnCostMs: 1,
          desks: ['/desks/new-1', '/desks/new-2', '/desks/new-3'],
        },
      },
    );
    expect(decision.detail.scaling?.start).toBe(0);
    expect(decision.writes.some((write) => write.kind === 'worker-start')).toBe(false);
  });

  it('hands over the unmerged branch of a slice whose sibling merged', () => {
    // `claimable` IS A PROPERTY OF THE SLICE, applied to every branch in it. A
    // slice with one merged branch and one open branch is eligible, so the
    // merged branch used to inherit `claimable: true` — which is why the
    // reading has to be per branch rather than per slice.
    const match = matchQueue({
      slices: [
        slice({ branch: 'feature/merged', landed: 'landed' }),
        slice({ branch: 'feature/open', landed: 'not-landed' }),
      ],
      agents: [agent('a')],
    });
    expect(match.assignments.map((a) => a.branch)).toEqual(['feature/open']);
    expect(match.held).toEqual([{ branch: 'feature/merged', hold: 'already-merged' }]);
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

  it('scales nothing and reports `null` when no fleet cap was given', () => {
    // INERT FOR EVERY EXISTING CALLER. `null` is *nobody asked*, which is what
    // separates a daemon with no cap from one over a quiet estate.
    const decision = assign({ slices: [slice()], agents: [agent('s1')] });
    expect(decision.detail.scaling).toBeNull();
    expect(decision.writes.some((write) => write.kind === 'worker-start')).toBe(false);
  });
});

describe('assign — the tick starts agents when queued > running', () => {
  const cap = (over: Partial<FleetCap> = {}): FleetCap => ({
    size: 3,
    headroom: 'clear',
    spawnCostMs: 1,
    desks: ['/desks/new-1', '/desks/new-2', '/desks/new-3'],
    ...over,
  });

  it('starts agents for slices nothing could take, up to the cap', () => {
    const decision = assign(
      {
        slices: [slice({ branch: 'feature/a' }), slice({ branch: 'feature/b' })],
        agents: [],
      },
      { fleet: cap() },
    );

    expect(decision.detail.held).toEqual([
      { branch: 'feature/a', hold: 'no-free-agent' },
      { branch: 'feature/b', hold: 'no-free-agent' },
    ]);
    expect(decision.writes).toEqual([
      { kind: 'worker-start', branch: '', worktree: '/desks/new-1' },
      { kind: 'worker-start', branch: '', worktree: '/desks/new-2' },
      { kind: 'worker-start', branch: '', worktree: '/desks/new-3' },
    ]);
  });

  it('starts agents with NO branch — the hand-over is what fills it', () => {
    const decision = assign({ slices: [slice()], agents: [] }, { fleet: cap() });
    const starts = decision.writes.filter((write) => write.kind === 'worker-start');
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.every((write) => write.kind === 'worker-start' && write.branch === '')).toBe(true);
  });

  it('starts nothing over an empty queue — an idle fleet costs with nothing on the other side', () => {
    const decision = assign({ slices: [], agents: [] }, { fleet: cap() });
    expect(decision.detail.scaling?.start).toBe(0);
    expect(decision.writes).toEqual([]);
  });

  it('starts nothing for a slice held by its brief or its plan, not by a shortage', () => {
    // A worker put in front of a gate is not a worker put in front of work.
    const decision = assign(
      { slices: [slice({ briefPresent: false }), slice({ claimable: false })], agents: [] },
      { fleet: cap() },
    );
    expect(decision.detail.scaling?.start).toBe(0);
  });

  it('asks for the CAP and never for the queue — 456 slices do not start 456 agents', () => {
    const many = Array.from({ length: 20 }, (_, i) => slice({ branch: `feature/${i}` }));
    const decision = assign({ slices: many, agents: [] }, { fleet: cap({ size: 3 }) });
    expect(decision.writes.filter((w) => w.kind === 'worker-start')).toHaveLength(3);
  });

  it('counts a FREE agent as running — it holds a slot and is about to be handed work', () => {
    // Counting only the busy ones would start a second agent beside every idle
    // one, every tick.
    const decision = assign(
      { slices: [slice({ branch: 'feature/a' }), slice({ branch: 'feature/b' })], agents: [agent('s1')] },
      { fleet: cap({ size: 3 }) },
    );
    // One free agent takes `feature/a`; `feature/b` waits, and the fleet grows
    // by two rather than by three.
    expect(decision.writes.filter((w) => w.kind === 'worker-start')).toHaveLength(2);
  });

  it('grows towards the cap and never past it', () => {
    const decision = assign(
      { slices: [slice({ branch: 'feature/a' }), slice({ branch: 'feature/b' })], agents: [] },
      { fleet: cap({ size: 1 }) },
    );
    expect(decision.writes.filter((w) => w.kind === 'worker-start')).toHaveLength(1);
  });

  it('lets a starved machine give fewer, and says which reading did it', () => {
    const decision = assign(
      { slices: [slice({ branch: 'feature/a' }), slice({ branch: 'feature/b' })], agents: [] },
      { fleet: cap({ headroom: 'starved', spawnCostMs: 300 }) },
    );
    expect(decision.writes.filter((w) => w.kind === 'worker-start')).toHaveLength(1);
    expect(decision.detail.scaling?.shortfall).toContain('starved');
  });

  it('bounds itself by the desks offered, and says so rather than blaming the machine', () => {
    const decision = assign(
      { slices: [slice({ branch: 'feature/a' }), slice({ branch: 'feature/b' })], agents: [] },
      { fleet: cap({ size: 3, desks: ['/desks/only-one'] }) },
    );
    expect(decision.writes.filter((w) => w.kind === 'worker-start')).toHaveLength(1);
    expect(decision.detail.scaling?.shortfall).toContain('only 1 desk was offered');
  });

  it('counts more than one desk in the plural, because an operator reads it', () => {
    const decision = assign(
      {
        slices: [
          slice({ branch: 'feature/a' }),
          slice({ branch: 'feature/b' }),
          slice({ branch: 'feature/c' }),
        ],
        agents: [],
      },
      { fleet: cap({ size: 3, desks: ['/desks/one', '/desks/two'] }) },
    );
    expect(decision.writes.filter((w) => w.kind === 'worker-start')).toHaveLength(2);
    expect(decision.detail.scaling?.shortfall).toContain('only 2 desks were offered');
  });

  it('is a function of its readings — the same pass twice reaches the same decision', () => {
    // THE STATELESSNESS THE TICK RESTS ON: a daemon SIGKILLed between deciding
    // and starting repeats the reading rather than resuming a target.
    const readings = { slices: [slice()], agents: [] };
    const input = { fleet: cap() };
    expect(assign(readings, input)).toEqual(assign(readings, input));
  });
});
