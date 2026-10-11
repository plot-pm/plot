import { describe, it, expect } from 'vitest';
import { oldLabelAction } from '../src/rules/old-label-migration.js';

/**
 * `oldLabelAction` — what to do with a loaded `com.plot-pm.registryd` unit,
 * given which checkout it serves and which verb asks. A plain function over the
 * reading.
 */
describe('oldLabelAction', () => {
  describe('retire, for --start and --stop', () => {
    it('unloads and removes a unit that serves this checkout', () => {
      expect(oldLabelAction({ kind: 'this', path: '/work/plot' }, 'retire')).toBe('unload-and-remove');
    });

    it('leaves a unit that serves another checkout', () => {
      expect(oldLabelAction({ kind: 'another', path: '/work/other' }, 'retire')).toBe('leave');
    });

    it('refuses when the serving checkout cannot be read', () => {
      expect(oldLabelAction({ kind: 'unknown' }, 'retire')).toBe('refuse');
    });
  });

  describe('status, for --status', () => {
    it('notes a unit that serves this checkout', () => {
      expect(oldLabelAction({ kind: 'this', path: '/work/plot' }, 'status')).toBe('note');
    });

    it('leaves a unit that serves another checkout', () => {
      expect(oldLabelAction({ kind: 'another', path: '/work/other' }, 'status')).toBe('leave');
    });

    it('leaves, and never refuses, when the serving checkout cannot be read', () => {
      expect(oldLabelAction({ kind: 'unknown' }, 'status')).toBe('leave');
    });
  });
});
