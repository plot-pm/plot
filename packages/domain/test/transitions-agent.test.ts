import { describe, expect, it } from 'vitest';
import { AgentStateSchema, type AgentState } from '../src/entities/agent.js';
import { EndingActorSchema } from '../src/entities/ending.js';
import {
  agentStateObservable,
  elsewhereIsHonest,
  endingIsAttributable,
  ENDING_ACTORS,
  isDecision,
  isRefusal,
  manifestIsRegistryWritten,
  observeAgentState,
  STATE_SOURCE,
  type StateSource,
} from '../src/transitions/agent.js';

/** The session id every case uses — one agent, so a refusal's subject is never in doubt. */
const SESSION = 'plot-wt-feature-an-agent-lifecycle-refuses';

/** Observes a move, supplying the source the state actually belongs to. */
const move = (from: AgentState, to: AgentState) =>
  observeAgentState(SESSION, from, { to, source: STATE_SOURCE[to] });

describe('observeAgentState judges a move the lifecycle diagram allows', () => {
  it('lets a dispatch take a desk from none to running', () => {
    const result = move('none', 'running');
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.from).toBe('none');
    expect(result.to).toBe('running');
    expect(result.source).toBe('worker');
  });

  it('lets a running agent reach each of the five exits the diagram draws', () => {
    for (const to of ['waiting', 'stalled', 'finished', 'failed', 'ended'] as const) {
      expect(isDecision(move('running', to))).toBe(true);
    }
  });

  it('lets a person answer a waiting agent and a stalled one resume', () => {
    expect(isDecision(move('waiting', 'running'))).toBe(true);
    expect(isDecision(move('stalled', 'running'))).toBe(true);
  });

  it('lets a failed agent restart, the edge --restart takes after asking the PR', () => {
    expect(isDecision(move('failed', 'running'))).toBe(true);
  });

  it('lets a finished desk return to none, which is the next slice or the reap', () => {
    expect(isDecision(move('finished', 'none'))).toBe(true);
  });

  it('reports which component read the state, so a caller can tell a desk fact from a process one', () => {
    const waiting = move('running', 'waiting');
    const failed = move('running', 'failed');
    expect(isDecision(waiting) && waiting.source).toBe('desk');
    expect(isDecision(failed) && failed.source).toBe('worker');
  });
});

describe('observeAgentState refuses a state that is not one of the eight', () => {
  it('refuses a spelling no enum admits', () => {
    const result = observeAgentState(SESSION, 'running', { to: 'crashed', source: 'worker' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unrecognised');
  });

  it("refuses the registry's own ninth, which is not the domain's", () => {
    // `unknown` is real and lives BESIDE the eight — DESIGN-agent.md:350 calls
    // it *nobody looked*. It is not a state an agent transitions into.
    const result = observeAgentState(SESSION, 'running', { to: 'unknown', source: 'worker' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unrecognised');
  });
});

describe('observeAgentState refuses a move that moves nothing', () => {
  it('refuses a state observing itself', () => {
    const result = observeAgentState(SESSION, 'running', { to: 'running', source: 'worker' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unchanged');
  });
});

describe('observeAgentState refuses a move out of a state that leads nowhere', () => {
  it("refuses a move out of ended, where nothing is recorded about how it stopped", () => {
    const result = move('ended', 'running');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
  });

  it('refuses a move out of elsewhere, because no machine here can observe one', () => {
    const result = move('elsewhere', 'running');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-terminal');
    expect(result.detail).toContain('no worktree on this machine');
  });

  it('refuses a move INTO elsewhere, which is entered at the start or not at all', () => {
    const result = move('running', 'elsewhere');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreachable');
  });
});

describe('observeAgentState refuses an edge the diagram does not draw', () => {
  it('refuses none -> finished, an agent finishing work no worker ever started', () => {
    const result = move('none', 'finished');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreachable');
  });

  it('refuses waiting -> finished, which would answer a question by declaring it answered', () => {
    const result = move('waiting', 'finished');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreachable');
  });

  it('refuses stalled -> finished, the move that would lose unlanded work', () => {
    // The five reap refusals exist because this move is what a careless
    // reader performs: a stalled desk holds work, and calling it finished is
    // how the work stops being visible.
    const result = move('stalled', 'finished');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreachable');
  });

  it('refuses finished -> running, because a restart goes through none', () => {
    const result = move('finished', 'running');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreachable');
  });

  it('names the reachable set in the refusal, so a caller need not read the diagram', () => {
    const result = move('none', 'failed');
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('running');
  });
});

describe('observeAgentState refuses a source that does not own the state it reports', () => {
  // CLAUDE.md: the two kinds share one enum for a historical reason, "which is
  // not a licence to add a workflow state to the process side".
  // `plot-worker-state.sh:46` decides both workflow states from the TREE.

  it('refuses waiting read from the process, because a PLOT-BLOCKED marker is in the tree', () => {
    const result = observeAgentState(SESSION, 'running', { to: 'waiting', source: 'worker' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('source-mismatch');
    expect(result.detail).toContain('desk fact is not a process event');
  });

  it('refuses stalled read from the process, because unlanded work is in the tree', () => {
    const result = observeAgentState(SESSION, 'running', { to: 'stalled', source: 'worker' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('source-mismatch');
  });

  it('refuses failed read from the desk, because a recorded non-zero exit is a process fact', () => {
    const result = observeAgentState(SESSION, 'running', { to: 'failed', source: 'desk' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('source-mismatch');
    expect(result.detail).toContain('process fact is not a reading of the desk');
  });

  it('refuses running read from the desk, because only the pid answers that', () => {
    const result = observeAgentState(SESSION, 'none', { to: 'running', source: 'desk' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('source-mismatch');
  });

  it('sources every one of the eight, so no state is judged without an owner', () => {
    for (const state of AgentStateSchema.options) {
      expect(STATE_SOURCE[state]).toBeDefined();
    }
  });

  it('keeps finished on the worker side, refined by the desk rather than read from it', () => {
    // DESIGN-agent.md:366 — "Worker, refined by the desk". The exit is what
    // makes it reachable; the desk narrows it away from `stalled`.
    expect(STATE_SOURCE.finished).toBe('worker');
    const result = observeAgentState(SESSION, 'running', { to: 'finished', source: 'desk' });
    expect(isRefusal(result)).toBe(true);
  });
});

describe('observeAgentState refuses a reading the caller measured and failed', () => {
  it('refuses on an unmet precondition and names it', () => {
    const result = observeAgentState(SESSION, 'none', {
      to: 'running',
      source: 'worker',
      preconditions: [{ name: 'desk-exists', met: false, detail: 'no worktree at that path' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
    expect(result.detail).toContain('desk-exists');
    expect(result.detail).toContain('no worktree at that path');
  });

  it('reports the FIRST unmet reading, so a caller fixes them in the order they were taken', () => {
    const result = observeAgentState(SESSION, 'none', {
      to: 'running',
      source: 'worker',
      preconditions: [
        { name: 'brief-readable', met: true },
        { name: 'desk-exists', met: false },
        { name: 'claim-pushed', met: false },
      ],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.detail).toContain('desk-exists');
    expect(result.detail).not.toContain('claim-pushed');
  });

  it('checks the lifecycle gates before the readings, so an illegal move refuses as one', () => {
    const result = observeAgentState(SESSION, 'none', {
      to: 'finished',
      source: 'worker',
      preconditions: [{ name: 'desk-exists', met: false }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('state-unreachable');
  });
});

describe('agentStateObservable answers the same question without the verdict', () => {
  it('agrees with observeAgentState on a legal move and an illegal one', () => {
    expect(agentStateObservable(SESSION, 'none', 'running', 'worker')).toBe(true);
    expect(agentStateObservable(SESSION, 'none', 'finished', 'worker')).toBe(false);
  });

  it('is not a permission — it applies the source gate too', () => {
    expect(agentStateObservable(SESSION, 'running', 'stalled', 'desk')).toBe(true);
    expect(agentStateObservable(SESSION, 'running', 'stalled', 'worker')).toBe(false);
  });
});

describe('endingIsAttributable refuses an agent that recorded itself as the actor', () => {
  // THE NARROW ASSERTION. Verified 2026-09-05 against plot-worker-loop.sh:
  // four self-exits exist, and only the watcher path writes an ending naming a
  // watcher. It attributes itself to `bound` or `monitor`, never to the agent.
  //
  // THE PAIR IS WHAT DECIDES, NOT THE ACTOR. `a-second-slice-needs-its-own-session`
  // added a fifth reason, `unstarted`, for a prompt whose command exited
  // non-zero without running — an ending no watcher produced, so `agent` is the
  // only honest actor for it. Every other reason still refuses `agent`, which
  // is why the rule reads both fields.

  it('refuses actor agent on a reason a watcher produced', () => {
    for (const reason of ['bound', 'quiet', 'unreadable', 'spent']) {
      const result = endingIsAttributable(SESSION, { actor: 'agent', reason });
      expect(isRefusal(result)).toBe(true);
      if (!isRefusal(result)) continue;
      expect(result.reason).toBe('ending-self-attributed');
      expect(result.detail).toContain('the bound or the monitor');
    }
  });

  it('refuses actor agent with no reason, because absent is not unstarted', () => {
    // An older caller, or a record that named no reason. It reads as *not
    // unstarted*, which keeps the refusal that held before the field existed.
    const result = endingIsAttributable(SESSION, { actor: 'agent' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('ending-self-attributed');
  });

  it('accepts actor agent on unstarted, the one ending no watcher produces', () => {
    // The floor did not expire and the monitor published nothing: the agent's
    // own process launched the command and received the refusal. Naming `bound`
    // or `monitor` here would claim a measurement neither made.
    expect(isDecision(endingIsAttributable(SESSION, {
      actor: 'agent',
      reason: 'unstarted',
    }))).toBe(true);
  });

  it('accepts the two actors the watcher paths write', () => {
    expect(isDecision(endingIsAttributable(SESSION, { actor: 'bound' }))).toBe(true);
    expect(isDecision(endingIsAttributable(SESSION, { actor: 'monitor' }))).toBe(true);
  });

  it('refuses a spelling neither actor uses', () => {
    const result = endingIsAttributable(SESSION, { actor: 'registry' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('ending-actor-unrecognised');
  });

  it('refuses an empty actor, which is a record that has said nothing', () => {
    const result = endingIsAttributable(SESSION, { actor: '' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('ending-actor-unrecognised');
  });

  it('refuses on an unmet reading, such as an ending file that did not parse', () => {
    const result = endingIsAttributable(SESSION, {
      actor: 'bound',
      preconditions: [{ name: 'ending-parsed', met: false, detail: 'not JSON' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
  });

  it('holds the enum to the actors that have writers', () => {
    // `agent` was removed on 2026-09-04 because nothing wrote it, and returned
    // on 2026-09-05 with the `unstarted` writer. The list is what has a writer,
    // never what has been imagined — a sixth actor still needs one.
    expect(EndingActorSchema.options).toEqual(['bound', 'monitor', 'agent']);
    expect(ENDING_ACTORS).toEqual(['bound', 'monitor', 'agent']);
  });

  it('reads a string rather than the type, because an ending file is bytes first', () => {
    // A worker of an older vintage wrote a value into a file that still sits on
    // a desk. The type may not admit it; the parse of that file must still have
    // an answer, and this is it.
    const fromDisk: string = 'registry';
    expect(isRefusal(endingIsAttributable(SESSION, { actor: fromDisk }))).toBe(true);
  });
});

describe('manifestIsRegistryWritten refuses a declaration the registry did not make', () => {
  it('accepts a manifest the registry wrote', () => {
    expect(isDecision(manifestIsRegistryWritten(SESSION, { writer: 'registry' }))).toBe(true);
  });

  it('refuses a manifest the agent wrote for itself', () => {
    const result = manifestIsRegistryWritten(SESSION, { writer: 'agent' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('manifest-not-registry-written');
    expect(result.detail).toContain('the desk belongs to the agent');
  });

  it('refuses a manifest whose writer nobody measured, because cannot answer is not yes', () => {
    const result = manifestIsRegistryWritten(SESSION, { writer: 'unknown' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('manifest-not-registry-written');
    expect(result.detail).toContain('cannot vouch');
  });

  it('refuses on an unmet reading, such as an unreachable registry directory', () => {
    const result = manifestIsRegistryWritten(SESSION, {
      writer: 'registry',
      preconditions: [{ name: 'registry-dir', met: false, detail: 'ENOENT' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
  });
});

describe('elsewhereIsHonest refuses elsewhere where the machine can answer', () => {
  it('accepts an agent with no desk on a machine that could look', () => {
    const result = elsewhereIsHonest(SESSION, { hasWorktreeHere: false, worktreesReadable: true });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.to).toBe('elsewhere');
    expect(result.source).toBe('machine');
  });

  it('refuses elsewhere for an agent that has a desk here', () => {
    const result = elsewhereIsHonest(SESSION, { hasWorktreeHere: true, worktreesReadable: true });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('elsewhere-has-a-worktree');
  });

  it('refuses elsewhere when the worktrees could not be listed, which is unknown', () => {
    const result = elsewhereIsHonest(SESSION, { hasWorktreeHere: false, worktreesReadable: false });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('elsewhere-not-observable');
    expect(result.detail).toContain('nobody looked');
  });

  it('asks whether anyone looked BEFORE what they saw, so a false reading cannot pass', () => {
    // An unreadable list yields `hasWorktreeHere: false` from a caller that
    // defaults it — which reads exactly like a genuine absence.
    const result = elsewhereIsHonest(SESSION, { hasWorktreeHere: true, worktreesReadable: false });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('elsewhere-not-observable');
  });

  it('refuses on an unmet reading', () => {
    const result = elsewhereIsHonest(SESSION, {
      hasWorktreeHere: false,
      worktreesReadable: true,
      preconditions: [{ name: 'manifest-present', met: false }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
  });
});

describe('the rule reaches nothing — readings as values, the shape rules/quiet.ts uses', () => {
  it('judges the same readings the same way every time', () => {
    const once = observeAgentState(SESSION, 'running', { to: 'waiting', source: 'desk' });
    const twice = observeAgentState(SESSION, 'running', { to: 'waiting', source: 'desk' });
    expect(once).toEqual(twice);
  });

  it('names the agent in every refusal, so a fleet-wide sweep can attribute one', () => {
    const sources: readonly StateSource[] = ['worker', 'desk', 'machine'];
    for (const source of sources) {
      const result = observeAgentState(SESSION, 'ended', { to: 'running', source });
      expect(isRefusal(result)).toBe(true);
      if (!isRefusal(result)) continue;
      expect(result.session).toBe(SESSION);
    }
  });
});
