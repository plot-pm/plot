import { describe, it, expect } from 'vitest';
import {
  BuildStateSchema, buildIsRunning, buildConclusion, buildFailed,
  type Build, type BuildPipeline,
} from '../src/index.js';

/**
 * Two entities, not one — and a rollup that is neither.
 *
 * A BuildPipeline is the thing that RUNS and is stable across runs; a Build is
 * one RESULT of one run, addressed by its own URL. Measured on main
 * 2026-08-28: two pipelines, ten builds between them — `{ CI: 5, Release: 5 }`,
 * `{ success: 8, in_progress: 2 }`.
 */

const pipeline: BuildPipeline = { name: 'CI', url: 'https://host/workflows/ci' };

const build: Build = {
  url: 'https://host/runs/1', pipeline: 'CI', head: 'feature/x',
  state: 'success', startedAt: '2026-08-28T09:00:00Z', durationMs: 90_000,
};

describe('a build state is a state, not a conclusion', () => {
  it('names the six states, two of which are not outcomes', () => {
    // The two `in_progress` runs expose the error: a build that has not
    // finished HAS no conclusion, and a field that must hold `in_progress` is
    // not describing an outcome.
    expect(BuildStateSchema.options).toEqual([
      'queued', 'in_progress', 'success', 'failure', 'cancelled', 'timed_out',
    ]);
  });

  it('keeps the host’s own word verbatim', () => {
    // Normalizing it would be a lossy mapping.
    expect(BuildStateSchema.safeParse('timed_out').success).toBe(true);
    expect(BuildStateSchema.safeParse('red').success).toBe(false);
  });
});

describe('the pipeline is recognised, the build is opened', () => {
  it('identifies a pipeline by name and a build by its run URL', () => {
    // Two builds of CI minutes apart are different objects with one pipeline.
    const later: Build = { ...build, url: 'https://host/runs/2' };
    expect(later.pipeline).toBe(pipeline.name);
    expect(later.url).not.toBe(build.url);
  });
});

describe('a running build has no conclusion', () => {
  it('answers null while queued or in progress', () => {
    expect(buildConclusion({ ...build, state: 'queued', durationMs: null })).toBeNull();
    expect(buildConclusion({ ...build, state: 'in_progress', durationMs: null })).toBeNull();
  });

  it('reports a running build as running', () => {
    expect(buildIsRunning({ ...build, state: 'in_progress' })).toBe(true);
    expect(buildIsRunning(build)).toBe(false);
  });

  it('does not read a running build as failed', () => {
    // The distinction the null exists for: not-yet-passed is not failed.
    expect(buildFailed({ ...build, state: 'in_progress' })).toBe(false);
  });

  it('concludes true only on success', () => {
    expect(buildConclusion(build)).toBe(true);
  });

  it('concludes false on each of the three ways of not passing', () => {
    for (const state of ['failure', 'cancelled', 'timed_out'] as const) {
      expect(buildConclusion({ ...build, state })).toBe(false);
      expect(buildFailed({ ...build, state })).toBe(true);
    }
  });
});
