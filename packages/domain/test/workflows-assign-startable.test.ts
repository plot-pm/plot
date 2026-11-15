import { describe, it, expect } from 'vitest';
import { startableSlices } from '../src/workflows/assign.js';
import type { HeldSlice } from '../src/rules/queue.js';

const held = (hold: HeldSlice['hold']): HeldSlice => ({
  branch: `feature/${hold}`,
  hold,
  waitsOn: [],
  waitHeld: '',
  assignedTo: '',
});

describe('startableSlices', () => {
  it('counts only the slices held on no-free-agent', () => {
    expect(
      startableSlices([held('no-free-agent'), held('no-brief'), held('no-free-agent'), held('already-merged')]),
    ).toBe(2);
  });

  it('is zero for an empty queue and for a queue held on gates alone', () => {
    expect(startableSlices([])).toBe(0);
    expect(startableSlices([held('no-brief'), held('merge-unknown')])).toBe(0);
  });
});
