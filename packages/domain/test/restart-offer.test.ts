import { describe, expect, it } from 'vitest';
import { restartOffered } from '../src/rules/restart-offer.js';
import { WorkerStateSchema } from '../src/entities/fleet.js';

describe('restartOffered', () => {
  it.each(['stalled', 'failed', 'ended', 'none'] as const)('offers Restart for a %s worker', (state) => {
    expect(restartOffered(state)).toBe(true);
  });

  it.each(['running', 'waiting', 'finished', 'elsewhere'] as const)('offers nothing for a %s worker', (state) => {
    expect(restartOffered(state)).toBe(false);
  });

  it('decides every worker state', () => {
    expect(WorkerStateSchema.options.filter(restartOffered).sort()).toEqual(['ended', 'failed', 'none', 'stalled']);
  });
});
