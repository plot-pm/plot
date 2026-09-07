import { describe, expect, it } from 'vitest';

import { AgentStateSchema } from '../src/entities/agent.js';
import {
  agentState,
  agentStateSource,
  type AgentStateReadings,
} from '../src/rules/agent-state.js';
import { STATE_SOURCE } from '../src/transitions/agent.js';
import type { TaskReadings } from '../src/rules/task.js';

/**
 * The readings of a desk nobody has touched: a worktree here, no pid recorded,
 * nothing left behind. Each test names only what it changes, so the reading
 * under test is the one visible in the case.
 */
const desk = (over: Partial<AgentStateReadings> = {}): AgentStateReadings => ({
  worktreeHere: true,
  pidRecorded: false,
  liveness: 'dead',
  exit: null,
  task: { hasPr: false, blocked: false, dirty: false, unpushed: null },
  ...over,
});

const task = (over: Partial<TaskReadings> = {}): TaskReadings => ({
  hasPr: false,
  blocked: false,
  dirty: false,
  unpushed: null,
  ...over,
});

describe('agentState', () => {
  it('answers elsewhere when this machine holds no worktree', () => {
    // The one state the shell's classifier never produces: its callers iterate
    // worktrees they found, so the question is settled before it is reached.
    expect(agentState(desk({ worktreeHere: false }))).toBe('elsewhere');
  });

  it('answers elsewhere before reading anything on a desk', () => {
    // A machine with no worktree cannot have read a pid or an exit, so a
    // caller supplying both is describing a desk that is not here. Nothing
    // below the worktree may overturn it.
    const answer = agentState(
      desk({ worktreeHere: false, pidRecorded: true, liveness: 'live', exit: '0' }),
    );
    expect(answer).toBe('elsewhere');
  });

  it('answers none when no pid was recorded', () => {
    // ABSENT IS NOT FALSE. `none` means UNKNOWN, never "nobody": a
    // hand-started worker writes no manifest, and five agents were started
    // that way in one session.
    expect(agentState(desk({ pidRecorded: false }))).toBe('none');
  });

  it('answers running for a live pid', () => {
    expect(agentState(desk({ pidRecorded: true, liveness: 'live' }))).toBe('running');
  });

  it('answers running without consulting the exit record', () => {
    // A live process has not exited. A recorded code beside it belongs to an
    // earlier run of the same desk.
    expect(agentState(desk({ pidRecorded: true, liveness: 'live', exit: '3' }))).toBe(
      'running',
    );
  });

  it('answers ended for a stale pid, whatever the exit record says', () => {
    // A reused pid means the worker is dead and no exit file can be trusted
    // either — the number belongs to an unrelated process now.
    expect(agentState(desk({ pidRecorded: true, liveness: 'stale', exit: '0' }))).toBe(
      'ended',
    );
    expect(agentState(desk({ pidRecorded: true, liveness: 'stale', exit: null }))).toBe(
      'ended',
    );
  });

  it('answers ended when no exit was recorded', () => {
    // A worker killed outright leaves no file. Guessing `finished` is the same
    // mistake in the other direction, and `finished` tells a reader to stop
    // looking.
    expect(agentState(desk({ pidRecorded: true, liveness: 'dead', exit: null }))).toBe(
      'ended',
    );
  });

  it('answers ended for an exit record that says nothing usable', () => {
    // READ THE EXIT CODE, NOT THE EMPTINESS. An unreadable record licenses no
    // verdict — which is the disagreement the shell resolved in `ended`'s
    // favour, against `failed (exit abc)`.
    expect(agentState(desk({ pidRecorded: true, exit: '' }))).toBe('ended');
    expect(agentState(desk({ pidRecorded: true, exit: 'abc' }))).toBe('ended');
    expect(agentState(desk({ pidRecorded: true, exit: '-1' }))).toBe('ended');
    expect(agentState(desk({ pidRecorded: true, exit: '1x' }))).toBe('ended');
  });

  describe('exit 0, the one arm the desk refines', () => {
    // Every worker exits 0, so `0` says only *the process ended tidily*. The
    // three below are the split, and they are `taskState`'s to make.
    const exited = (t: Partial<TaskReadings>): string =>
      agentState(desk({ pidRecorded: true, exit: '0', task: task(t) }));

    it('answers finished on a clean desk', () => {
      expect(exited({})).toBe('finished');
    });

    it('answers finished when the work reached review', () => {
      expect(exited({ hasPr: true })).toBe('finished');
    });

    it('answers waiting on a blocked marker', () => {
      expect(exited({ blocked: true })).toBe('waiting');
    });

    it('answers stalled on uncommitted work', () => {
      expect(exited({ dirty: true })).toBe('stalled');
    });

    it('answers stalled on unpushed commits', () => {
      expect(exited({ unpushed: true })).toBe('stalled');
    });

    it('answers finished when unpushed cannot be asked', () => {
      // `null` IS NOT `false`. A branch with no upstream cannot be asked, and
      // a failure to observe is not evidence of something to see.
      expect(exited({ unpushed: null })).toBe('finished');
    });
  });

  describe('a non-zero exit', () => {
    const crashed = (t: Partial<TaskReadings>): string =>
      agentState(desk({ pidRecorded: true, exit: '143', task: task(t) }));

    it('answers failed with no PR', () => {
      // The guess in the other direction — calling a genuine crash `finished`
      // — is the one this must never make.
      expect(crashed({})).toBe('failed');
      expect(crashed({ dirty: true })).toBe('failed');
      expect(crashed({ blocked: true })).toBe('failed');
    });

    it('answers about the task when a PR outranks the code', () => {
      // Measured 2026-08-24 on `bug/the-agents-tab-filters-on-membership`: a
      // worker SIGTERMed with its work pushed and PR #393 open rendered
      // `worker crashed - someone is on it` indefinitely, because nothing
      // about the branch can change a recorded exit code.
      expect(crashed({ hasPr: true })).toBe('finished');
    });
  });

  it('answers every one of the eight over some reading', () => {
    // A deriver that cannot reach a state does not own it. This is the claim
    // the corpus test cannot make — an estate exercises what it happens to
    // hold — so it is made here, where the readings are chosen.
    const reachable = new Set([
      agentState(desk({ worktreeHere: false })),
      agentState(desk()),
      agentState(desk({ pidRecorded: true, liveness: 'live' })),
      agentState(desk({ pidRecorded: true, liveness: 'stale' })),
      agentState(desk({ pidRecorded: true, exit: '0' })),
      agentState(desk({ pidRecorded: true, exit: '0', task: task({ blocked: true }) })),
      agentState(desk({ pidRecorded: true, exit: '0', task: task({ dirty: true }) })),
      agentState(desk({ pidRecorded: true, exit: '9' })),
    ]);
    expect([...reachable].sort()).toEqual([...AgentStateSchema.options].sort());
  });
});

describe('agentStateSource', () => {
  it('reads the transitions table rather than restating it', () => {
    // `STATE_SOURCE` IS THE SPECIFICATION. There is one table, so the deriver
    // and the specification cannot disagree — this pins that there is one.
    for (const state of AgentStateSchema.options) {
      expect(agentStateSource(state)).toBe(STATE_SOURCE[state]);
    }
  });

  it('sources the desk states to the desk', () => {
    // CLAUDE.md: `waiting` and `stalled` are Agent facts read from the desk,
    // and the two kinds sharing one enum is not a licence to move one.
    expect(agentStateSource('waiting')).toBe('desk');
    expect(agentStateSource('stalled')).toBe('desk');
  });

  it('sources the process states to the worker and elsewhere to the machine', () => {
    for (const state of ['running', 'failed', 'ended', 'none', 'finished'] as const) {
      expect(agentStateSource(state)).toBe('worker');
    }
    expect(agentStateSource('elsewhere')).toBe('machine');
  });

  it('names the source of every state the deriver can answer', () => {
    // The pair the done-when asks for: a deriver that answers a state the
    // specification does not source would be wrong by the domain's own record.
    for (const state of AgentStateSchema.options) {
      expect(['worker', 'desk', 'machine']).toContain(agentStateSource(state));
    }
  });
});
