import { describe, it, expect } from 'vitest';
import { oldLabelAction, labelAction } from '../src/rules/old-label-migration.js';

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

/**
 * `labelAction` — whether `plot-fleetctl.sh` may act on the job loaded under
 * the resolved label, given which checkout it serves and which verb asks.
 * One case per cell of the plan's table.
 */
describe('labelAction', () => {
  describe('start', () => {
    it('refuses a job that serves this checkout', () => {
      expect(labelAction({ kind: 'this', path: '/work/plot' }, 'start')).toBe('refuse');
    });

    it('refuses a job that serves another checkout', () => {
      expect(labelAction({ kind: 'another', path: '/work/other' }, 'start')).toBe('refuse');
    });

    it('refuses when the serving checkout cannot be read', () => {
      expect(labelAction({ kind: 'unknown' }, 'start')).toBe('refuse');
    });
  });

  describe('start-default', () => {
    it('refuses a job that serves this checkout', () => {
      expect(labelAction({ kind: 'this', path: '/work/plot' }, 'start-default')).toBe('refuse');
    });

    it('proceeds for a job that serves another checkout', () => {
      expect(labelAction({ kind: 'another', path: '/work/other' }, 'start-default')).toBe('proceed');
    });

    it('proceeds when the serving checkout cannot be read', () => {
      expect(labelAction({ kind: 'unknown' }, 'start-default')).toBe('proceed');
    });
  });

  describe('stop', () => {
    it('proceeds for a job that serves this checkout', () => {
      expect(labelAction({ kind: 'this', path: '/work/plot' }, 'stop')).toBe('proceed');
    });

    it('refuses a job that serves another checkout', () => {
      expect(labelAction({ kind: 'another', path: '/work/other' }, 'stop')).toBe('refuse');
    });

    it('refuses when the serving checkout cannot be read', () => {
      expect(labelAction({ kind: 'unknown' }, 'stop')).toBe('refuse');
    });
  });
});
