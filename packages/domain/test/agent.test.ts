import { describe, it, expect } from 'vitest';
import {
  AgentStateSchema, AgentIdentitySchema, AgentActivitySchema, LIVE_STATES,
  isLive, isFree, identityWasDeclared, owesAnAnswer, leftWorkBehind, type Agent,
} from '../src/index.js';

/**
 * A process working a branch on behalf of a person.
 *
 * Its identity is minted, and the kind's failure — *nobody minting* — is this
 * entity's defining defect: 0 manifests against 13 dispatch worktrees, so every
 * agent row this estate renders is synthesized.
 */

const agent: Agent = {
  session: 'sess-1', identity: 'manifest', branch: 'feature/x', worktree: '/tmp/wt',
  command: 'plot-worker-loop.sh', startedAt: '2026-08-28T09:00:00Z', pid: '4242',
  previousPid: '', relaunches: 0, state: 'running', activity: 'working', exitCode: null,
  dirtyPaths: [], machineAtDeath: 'unmeasured',
};

describe('the agent vocabularies are closed sets', () => {
  it('names eight states — six about the process, two about the task', () => {
    // Every worker exits 0, so the exit code cannot say whether the work is
    // done. `waiting` and `stalled` are what answer that.
    expect(AgentStateSchema.options).toEqual([
      'running', 'waiting', 'stalled', 'finished', 'failed', 'ended', 'none', 'elsewhere',
    ]);
    expect(AgentStateSchema.safeParse('hung').success).toBe(false);
  });

  it('names the two identities and the three activity cues', () => {
    expect(AgentIdentitySchema.options).toEqual(['manifest', 'synthesized']);
    expect(AgentActivitySchema.options).toEqual(['working', 'idle', '']);
  });
});

describe('holding a machine is not the same question as being free', () => {
  it('counts running and waiting as live', () => {
    expect(LIVE_STATES).toEqual(['running', 'waiting']);
    expect(isLive(agent)).toBe(true);
    expect(isLive({ ...agent, state: 'waiting' })).toBe(true);
  });

  it('counts every other state as not live', () => {
    for (const state of ['stalled', 'finished', 'failed', 'ended', 'none', 'elsewhere'] as const) {
      expect(isLive({ ...agent, state })).toBe(false);
    }
  });

  it('treats a running agent between slices as free', () => {
    // `running` is not busy: an agent that finished a slice and is asking for
    // its next one is running with no branch, and is available.
    expect(isFree({ ...agent, branch: '' }, false)).toBe(true);
  });

  it('treats a running agent whose slice landed as free', () => {
    expect(isFree(agent, true)).toBe(true);
  });

  it('refuses a running agent still holding an unlanded slice', () => {
    expect(isFree(agent, false)).toBe(false);
  });

  it('refuses a waiting agent, which is live but blocked on a person', () => {
    // It occupies a slot and can take nothing — which is why live is the right
    // denominator for the cap and the wrong answer to who can take a slice.
    expect(isLive({ ...agent, state: 'waiting' })).toBe(true);
    expect(isFree({ ...agent, state: 'waiting', branch: '' }, true)).toBe(false);
  });

  it('refuses a finished agent, whose desk is abandoned rather than freed', () => {
    // `finished` is not free: nothing marks the transition today.
    expect(isFree({ ...agent, state: 'finished', branch: '' }, true)).toBe(false);
  });
});

describe('a row cannot say whether it knows who the agent is', () => {
  it('distinguishes a declared identity from a synthesized one', () => {
    // Measured 2026-08-28: 0 manifests, 13 worktrees, 0 holding a live worker.
    // A synthesized entry is not a kind of Agent — it is an Agent whose
    // identity was never written.
    expect(identityWasDeclared(agent)).toBe(true);
    expect(identityWasDeclared({ ...agent, identity: 'synthesized' })).toBe(false);
  });
});

describe('two states ask a person for something', () => {
  it('reports a waiting agent as owing an answer', () => {
    expect(owesAnAnswer({ ...agent, state: 'waiting' })).toBe(true);
    expect(owesAnAnswer(agent)).toBe(false);
  });

  it('reports a stalled agent that left work in its tree', () => {
    // A stall IS uncommitted work; one measured here left 324 finished lines
    // on the floor.
    expect(leftWorkBehind({ ...agent, state: 'stalled', dirtyPaths: ['src/x.ts'] })).toBe(true);
  });

  it('does not report a stalled agent whose tree is clean', () => {
    expect(leftWorkBehind({ ...agent, state: 'stalled' })).toBe(false);
  });

  it('does not soften a failed agent by reading its tree', () => {
    // `failed`, `ended` and `none` are deliberately not refined: a recorded
    // non-zero exit is a fact the tree cannot soften.
    expect(leftWorkBehind({ ...agent, state: 'failed', dirtyPaths: ['src/x.ts'] })).toBe(false);
  });
});
