import { describe, it, expect } from 'vitest';
import { isAgentFree, whyNotFree, isFree, type AgentReading } from '../src/index.js';

/**
 * `free` — the question the eight process states deliberately do not answer.
 *
 * NO BROWSER AND NO LIVE PROCESS. Every case here is a plain record, which is
 * the point of taking readings as values: the two facts `free` is derived from
 * are already held by whoever asks, so the rule needs nothing from the world.
 *
 * The empty-branch arm is the one that was unreachable in production until this
 * slice. `isFree` was written, exported and unit-tested by
 * `a-dispatch-asks-for-a-free-agent`, and nothing ever produced a manifest
 * carrying `branch: ""` — the worker loop's hop rewrote the field to the next
 * branch and never through the empty value. `plot-worker-loop.sh` now clears it
 * at the finish, so these assertions describe a state the estate can reach.
 */

const reading = (over: Partial<AgentReading> = {}): AgentReading => ({
  state: 'running',
  branch: 'feature/x',
  sliceHasMerged: false,
  ...over,
});

describe('isAgentFree — alive, and holding no slice', () => {
  it('frees a running agent between slices, holding no branch', () => {
    expect(isAgentFree(reading({ branch: '' }))).toBe(true);
  });

  it('frees a running agent whose branch has landed', () => {
    // Occupied AND free at once: it still holds a machine slot, and it can
    // still take the next slice.
    expect(isAgentFree(reading({ sliceHasMerged: true }))).toBe(true);
  });

  it('refuses a running agent still holding an unlanded branch', () => {
    expect(isAgentFree(reading())).toBe(false);
  });

  it('refuses a WAITING agent even with no branch and a landed slice', () => {
    // `waiting` is live and blocked on a person, so it holds a slot and can
    // take nothing. The block is the person, not the branch.
    expect(isAgentFree(reading({ state: 'waiting', branch: '', sliceHasMerged: true }))).toBe(false);
  });

  it('refuses a FINISHED agent between slices — its worker exited', () => {
    // `finished` is not free: nothing is there to hand work to. This is the
    // distinction the slice exists for — a free agent is running, not finished.
    expect(isAgentFree(reading({ state: 'finished', branch: '' }))).toBe(false);
  });

  it('refuses every state the process reading can carry but `running`', () => {
    // Named exhaustively rather than by complement: a ninth state arriving in
    // either vocabulary must be free on purpose, never by inheriting the word.
    for (const state of ['waiting', 'stalled', 'finished', 'failed', 'ended', 'none', 'elsewhere', 'unknown']) {
      expect(isAgentFree(reading({ state, branch: '', sliceHasMerged: true }))).toBe(false);
    }
  });

  it('takes silence about a branch as still held, never as landed', () => {
    // The caller sources `sliceHasMerged` from the pulse, and a branch the
    // pulse never mentions arrives here as `false`.
    expect(isAgentFree(reading({ sliceHasMerged: false }))).toBe(false);
  });
});

describe('whyNotFree — the sentence behind the refusal', () => {
  it('says nothing when the agent is free', () => {
    expect(whyNotFree(reading({ branch: '' }))).toBe('');
    expect(whyNotFree(reading({ sliceHasMerged: true }))).toBe('');
  });

  it('names the person a waiting agent is blocked on', () => {
    expect(whyNotFree(reading({ state: 'waiting' }))).toBe('blocked on a person');
  });

  it('names the state when the process is not running', () => {
    expect(whyNotFree(reading({ state: 'finished', branch: '' }))).toBe('not running — finished');
  });

  it('names the branch a running agent still holds', () => {
    expect(whyNotFree(reading())).toBe('holds feature/x');
  });

  it('agrees with isAgentFree on every case, so word and reason cannot diverge', () => {
    const cases: AgentReading[] = [
      reading(), reading({ branch: '' }), reading({ sliceHasMerged: true }),
      reading({ state: 'waiting' }), reading({ state: 'finished', branch: '' }),
      reading({ state: 'stalled' }), reading({ state: 'unknown', branch: '' }),
    ];
    for (const c of cases) {
      expect(whyNotFree(c) === '').toBe(isAgentFree(c));
    }
  });
});

describe('isFree — the entity delegates rather than re-deriving', () => {
  it('answers the same as the rule for every case', () => {
    // One implementation, asked through two signatures. A second copy is how
    // the entity's answer and the board's would drift on the word the fleet
    // dispatches on.
    const cases: AgentReading[] = [
      reading(), reading({ branch: '' }), reading({ sliceHasMerged: true }),
      reading({ state: 'waiting' }), reading({ state: 'finished', branch: '' }),
    ];
    for (const c of cases) {
      expect(isFree({ state: c.state, branch: c.branch }, c.sliceHasMerged)).toBe(isAgentFree(c));
    }
  });
});
