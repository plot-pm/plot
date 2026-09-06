import { describe, expect, it } from 'vitest';
import { WorkerStateSchema, type WorkerState } from '../src/entities/fleet.js';
import { STATE_SOURCE } from '../src/transitions/agent.js';
import {
  isDecision,
  isRefusal,
  readWorkerState,
  workerStateReadable,
  workerStateSource,
  WORKER_LIFECYCLE,
  type WorkerReading,
} from '../src/transitions/worker.js';

const BRANCH = 'feature/six-lifecycles-declare-their-rules';

/** A reading whose source is the one that owns the state, with a desk here. */
const read = (state: WorkerState, over: Partial<WorkerReading> = {}) =>
  readWorkerState({
    branch: BRANCH,
    state,
    source: STATE_SOURCE[state],
    exitCode: null,
    worktreeHere: state !== 'elsewhere',
    ...over,
  });

describe('the states and their sources are consumed, never redeclared', () => {
  it('names the states the entity owns', () => {
    expect([...WORKER_LIFECYCLE].sort()).toEqual([...WorkerStateSchema.options].sort());
  });

  it('reads the agent transition’s source table rather than a second one', () => {
    // `entities/fleet.ts:122` says the scan's eight ARE the Agent's eight and
    // that the rule they want is `transitions/agent.ts`. Two tables over one
    // set of states is the Wave/Slice-shaped defect this repo carries once.
    for (const state of WorkerStateSchema.options) {
      expect(workerStateSource(state)).toBe(STATE_SOURCE[state]);
    }
  });

  it('splits the eight along the line CLAUDE.md draws', () => {
    const bySource = (want: string) =>
      WorkerStateSchema.options.filter((s) => workerStateSource(s) === want).sort();
    expect(bySource('worker')).toEqual(['ended', 'failed', 'finished', 'none', 'running']);
    expect(bySource('desk')).toEqual(['stalled', 'waiting']);
    expect(bySource('machine')).toEqual(['elsewhere']);
  });
});

describe('a reading its source could have produced', () => {
  it('accepts each state from the component that owns it', () => {
    for (const state of WorkerStateSchema.options) {
      expect(isDecision(read(state))).toBe(true);
    }
  });

  it('reports only running as alive', () => {
    for (const state of WorkerStateSchema.options) {
      const result = read(state);
      expect(isDecision(result) && result.alive).toBe(state === 'running');
    }
  });

  it('answers the same question through the callable-alone form', () => {
    expect(workerStateReadable({
      branch: BRANCH, state: 'running', source: 'worker', exitCode: null, worktreeHere: true,
    })).toBe(true);
    expect(workerStateReadable({
      branch: BRANCH, state: 'running', source: 'desk', exitCode: null, worktreeHere: true,
    })).toBe(false);
  });
});

describe('it refuses a reading no source could have produced', () => {
  it('refuses an unrecognised state', () => {
    const result = readWorkerState({
      branch: BRANCH, state: 'archived', source: 'worker', exitCode: null, worktreeHere: true,
    });
    expect(isRefusal(result) && result.reason).toBe('state-unrecognised');
  });

  it('refuses a task state read from the process table', () => {
    for (const state of ['waiting', 'stalled'] as const) {
      const result = read(state, { source: 'worker' });
      expect(isRefusal(result) && result.reason).toBe('source-cannot-answer');
    }
  });

  it('refuses a process state read from the desk', () => {
    for (const state of ['running', 'failed', 'ended', 'none'] as const) {
      const result = read(state, { source: 'desk' });
      expect(isRefusal(result) && result.reason).toBe('source-cannot-answer');
    }
  });

  it('refuses a task state decided from exit 0, because every worker exits 0', () => {
    // The measurement the file exists for: the exit code cannot say whether the
    // task finished, so `plot-worker-state.sh:46` reads the tree for both.
    for (const state of ['waiting', 'stalled'] as const) {
      const result = read(state, { exitCode: 0 });
      expect(isRefusal(result) && result.reason).toBe('exit-code-cannot-decide');
    }
  });

  it('admits a task state where the exit code is not the evidence', () => {
    for (const state of ['waiting', 'stalled'] as const) {
      expect(isDecision(read(state, { exitCode: null }))).toBe(true);
    }
  });

  it('refuses elsewhere while a desk is here — that names a different agent', () => {
    const result = read('elsewhere', { worktreeHere: true });
    expect(isRefusal(result) && result.reason).toBe('no-worktree-here');
  });

  it('refuses every other state with no desk to read', () => {
    for (const state of ['running', 'finished', 'waiting'] as const) {
      const result = read(state, { worktreeHere: false });
      expect(isRefusal(result) && result.reason).toBe('no-worktree-here');
    }
  });

  it('refuses on an unmet precondition', () => {
    const result = readWorkerState(
      { branch: BRANCH, state: 'running', source: 'worker', exitCode: null, worktreeHere: true },
      [{ name: 'ps-read', met: false, detail: 'ps exited 1' }],
    );
    expect(isRefusal(result) && result.reason).toBe('precondition-unmet');
  });
});
