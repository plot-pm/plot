import { describe, it, expect } from 'vitest';
import { oldLabelAction } from '../src/rules/old-label-migration.js';

/**
 * `oldLabelAction` — what to do with a loaded `com.plot-pm.registryd` unit,
 * given which checkout it serves. A plain function over the reading.
 */
describe('oldLabelAction', () => {
  it('unloads and removes a unit that serves this checkout', () => {
    expect(oldLabelAction({ kind: 'this', path: '/work/plot' })).toBe('unload-and-remove');
  });

  it('leaves a unit that serves another checkout', () => {
    expect(oldLabelAction({ kind: 'another', path: '/work/other' })).toBe('leave');
  });

  it('refuses when the serving checkout cannot be read', () => {
    expect(oldLabelAction({ kind: 'unknown' })).toBe('refuse');
  });
});
