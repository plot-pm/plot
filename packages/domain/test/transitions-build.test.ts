import { describe, expect, it } from 'vitest';
import { BuildStateSchema, type Build, type BuildState } from '../src/entities/build.js';
import {
  BUILD_LIFECYCLE,
  buildStateObservable,
  isDecision,
  isRefusal,
  observeBuildState,
} from '../src/transitions/build.js';

const URL = 'https://github.com/plot-pm/plot/actions/runs/34031043261';

const buildWith = (over: Partial<Build> = {}): Build => ({
  url: URL,
  pipeline: 'CI',
  head: 'feature/six-lifecycles-declare-their-rules',
  state: 'queued',
  startedAt: '2026-09-06T19:00:00Z',
  durationMs: null,
  ...over,
});

/** A move, with the duration a run in that state would carry. */
const move = (from: BuildState, to: string, durationMs?: number | null) =>
  observeBuildState(buildWith({ state: from }), { to, durationMs });

describe('the states are consumed, never redeclared', () => {
  it('names the states the entity owns, in the order it draws them', () => {
    expect([...BUILD_LIFECYCLE]).toEqual([...BuildStateSchema.options]);
  });
});

describe('a run is queued, runs, and ends one of four ways', () => {
  it('goes queued -> in_progress -> success', () => {
    expect(isDecision(move('queued', 'in_progress', null))).toBe(true);
    expect(isDecision(move('in_progress', 'success', 62_000))).toBe(true);
  });

  it('reaches all four ends from in_progress', () => {
    for (const to of ['success', 'failure', 'cancelled', 'timed_out'] as const) {
      expect(isDecision(move('in_progress', to, 62_000))).toBe(true);
    }
  });

  it('lets a queued run be cancelled or time out without ever running', () => {
    // A job cancelled before a runner picked it up never entered in_progress,
    // and recording that it did would claim work nobody did.
    expect(isDecision(move('queued', 'cancelled', 1_000))).toBe(true);
    expect(isDecision(move('queued', 'timed_out', 1_000))).toBe(true);
  });

  it('answers the conclusion only once the run has ended', () => {
    const running = move('queued', 'in_progress', null);
    expect(isDecision(running) && running.conclusion).toBeNull();
    const passed = move('in_progress', 'success', 62_000);
    expect(isDecision(passed) && passed.conclusion).toBe(true);
  });

  it('keeps the host’s four ends apart rather than collapsing them to failure', () => {
    // `cancelled` and `timed_out` are repaired differently from a red test —
    // somebody stopped it, or the bound was hit.
    for (const to of ['failure', 'cancelled', 'timed_out'] as const) {
      const result = move('in_progress', to, 62_000);
      expect(isDecision(result) && result.to).toBe(to);
      expect(isDecision(result) && result.conclusion).toBe(false);
    }
  });

  it('answers the same question through the callable-alone form', () => {
    expect(buildStateObservable(buildWith(), 'in_progress')).toBe(true);
    expect(buildStateObservable(buildWith({ state: 'success' }), 'queued')).toBe(false);
  });
});

describe('it refuses what the lifecycle does not admit', () => {
  it('refuses an unrecognised state', () => {
    const result = move('queued', 'skipped');
    expect(isRefusal(result) && result.reason).toBe('state-unrecognised');
  });

  it('refuses a move to the state it already holds', () => {
    const result = move('in_progress', 'in_progress');
    expect(isRefusal(result) && result.reason).toBe('state-unchanged');
  });

  it('refuses to restart a finished run — a re-run is a NEW build', () => {
    // The identity is the run URL: two builds of one pipeline minutes apart are
    // different objects.
    for (const from of ['success', 'failure', 'cancelled', 'timed_out'] as const) {
      const result = move(from, 'queued');
      expect(isRefusal(result) && result.reason).toBe('state-terminal');
    }
  });

  it('refuses to go from queued straight to success', () => {
    const result = move('queued', 'success', 62_000);
    expect(isRefusal(result) && result.reason).toBe('state-unreachable');
  });
});

describe('a duration and an end arrive together', () => {
  it('refuses a still-running state carrying a duration', () => {
    const result = move('queued', 'in_progress', 62_000);
    expect(isRefusal(result) && result.reason).toBe('duration-without-end');
  });

  it('refuses an ended state carrying none', () => {
    const result = move('in_progress', 'success', null);
    expect(isRefusal(result) && result.reason).toBe('end-without-duration');
  });

  it('asks neither where the caller supplied no duration reading', () => {
    // A caller holding only a state is believed: both gates are skipped.
    expect(isDecision(move('queued', 'in_progress'))).toBe(true);
    expect(isDecision(move('in_progress', 'success'))).toBe(true);
  });

  it('refuses on an unmet precondition', () => {
    const result = observeBuildState(buildWith(), {
      to: 'in_progress',
      preconditions: [{ name: 'host-asked', met: false, detail: 'gh exited 1' }],
    });
    expect(isRefusal(result) && result.reason).toBe('precondition-unmet');
  });
});
