import { describe, expect, it } from 'vitest';
import { runLimitRefusal, DEFAULT_SLICE_MAX_RUNS } from '../src/rules/run-limit.js';

describe('runLimitRefusal', () => {
  it('allows a run under the limit', () => {
    expect(runLimitRefusal(3, 12)).toBe(false);
  });

  it('refuses the run exactly at the limit', () => {
    expect(runLimitRefusal(12, 12)).toBe(true);
  });

  it('refuses a run past the limit', () => {
    expect(runLimitRefusal(13, 12)).toBe(true);
  });

  it('the default is 12', () => {
    expect(DEFAULT_SLICE_MAX_RUNS).toBe(12);
    expect(runLimitRefusal(11, DEFAULT_SLICE_MAX_RUNS)).toBe(false);
    expect(runLimitRefusal(12, DEFAULT_SLICE_MAX_RUNS)).toBe(true);
  });
});
