import { describe, it, expect } from 'vitest';
import { prRowPlacement, prChecksSuppressedByMerge, awaitsMarkReady, type PrRowReadings } from '../src/rules/pr-row.js';

const readings = (over: Partial<PrRowReadings> = {}): PrRowReadings => ({
  mergeable: 'mergeable',
  checks: 'green',
  ...over,
});

describe('prRowPlacement — conflict outranks everything', () => {
  for (const checks of ['pending', 'failing', 'none', 'unknown', 'green']) {
    it(`answers waiting-on-you/conflicts for a conflicting PR with ${checks} checks`, () => {
      expect(prRowPlacement(readings({ mergeable: 'conflicting', checks }))).toEqual({
        group: 'waiting-on-you',
        clause: 'conflicts',
      });
    });
  }
});

describe('prRowPlacement — unknown mergeability', () => {
  it('answers waiting-on-machine/CI running for unknown mergeability with pending checks', () => {
    expect(prRowPlacement(readings({ mergeable: 'unknown', checks: 'pending' }))).toEqual({
      group: 'waiting-on-machine',
      clause: 'CI running',
    });
  });

  it('answers waiting-on-machine/CI running for absent mergeability with pending checks', () => {
    expect(prRowPlacement(readings({ mergeable: undefined, checks: 'pending' }))).toEqual({
      group: 'waiting-on-machine',
      clause: 'CI running',
    });
  });

  it('answers waiting-on-you/cannot say whether it merges for unknown mergeability with green checks', () => {
    expect(prRowPlacement(readings({ mergeable: 'unknown', checks: 'green' }))).toEqual({
      group: 'waiting-on-you',
      clause: 'cannot say whether it merges',
    });
  });

  it('answers waiting-on-machine/CI running for an unrecognised mergeable word with pending checks', () => {
    expect(prRowPlacement(readings({ mergeable: 'some-future-word', checks: 'pending' }))).toEqual({
      group: 'waiting-on-machine',
      clause: 'CI running',
    });
  });
});

describe('prRowPlacement — mergeable PRs read their checks', () => {
  it('answers waiting-on-machine/CI running for mergeable with pending checks', () => {
    expect(prRowPlacement(readings({ checks: 'pending' }))).toEqual({
      group: 'waiting-on-machine',
      clause: 'CI running',
    });
  });

  it('answers waiting-on-you/checks failing for mergeable with failing checks', () => {
    expect(prRowPlacement(readings({ checks: 'failing' }))).toEqual({
      group: 'waiting-on-you',
      clause: 'checks failing',
    });
  });

  it('answers waiting-on-you/no checks for mergeable with no checks', () => {
    expect(prRowPlacement(readings({ checks: 'none' }))).toEqual({
      group: 'waiting-on-you',
      clause: 'no checks',
    });
  });

  it('answers waiting-on-you/cannot read the checks for mergeable with unknown checks', () => {
    expect(prRowPlacement(readings({ checks: 'unknown' }))).toEqual({
      group: 'waiting-on-you',
      clause: 'cannot read the checks',
    });
  });

  it('answers waiting-on-you/green for mergeable with green checks', () => {
    expect(prRowPlacement(readings({ checks: 'green' }))).toEqual({
      group: 'waiting-on-you',
      clause: 'green',
    });
  });

  it('answers waiting-on-you/cannot read the checks for a word that is not a known checks value', () => {
    expect(prRowPlacement(readings({ checks: 'some-future-word' }))).toEqual({
      group: 'waiting-on-you',
      clause: 'cannot read the checks',
    });
  });
});

describe('prChecksSuppressedByMerge', () => {
  it('answers true for MERGED — the rule reads state alone, so no checks value changes it', () => {
    expect(prChecksSuppressedByMerge('MERGED')).toBe(true);
  });

  it('answers false for an open or closed PR', () => {
    expect(prChecksSuppressedByMerge('OPEN')).toBe(false);
    expect(prChecksSuppressedByMerge('CLOSED')).toBe(false);
  });
});

describe('awaitsMarkReady', () => {
  const shape = { draft: true, mergeable: 'mergeable', checks: 'green', worker: 'finished' };

  it('is true for a green draft whose desk finished — the #2310 shape', () => {
    expect(awaitsMarkReady(shape)).toBe(true);
  });

  it('is true when no worker process exists', () => {
    expect(awaitsMarkReady({ ...shape, worker: 'none' })).toBe(true);
  });

  it.each(['running', 'waiting', 'failed', 'ended', 'stalled', 'elsewhere'])(
    'is false while the worker state is %s', (worker) => {
      expect(awaitsMarkReady({ ...shape, worker })).toBe(false);
    },
  );

  it('is false for a ready PR — nothing is left to mark', () => {
    expect(awaitsMarkReady({ ...shape, draft: false })).toBe(false);
  });

  it.each(['pending', 'failing', 'none', 'unknown'])('is false for a draft whose checks read %s', (checks) => {
    expect(awaitsMarkReady({ ...shape, checks })).toBe(false);
  });

  it('is false for a green draft that conflicts', () => {
    expect(awaitsMarkReady({ ...shape, mergeable: 'conflicting' })).toBe(false);
  });
});

describe('prRowPlacement — checks read on an older head', () => {
  const OLD = 'dc98f4a02';
  const NEW = '75da18f94';

  it('answers waiting-on-machine/new head, checks not yet read when checksSha names an older head than the tip', () => {
    expect(prRowPlacement(readings({ checks: 'failing', checksSha: OLD, tip: NEW }))).toEqual({
      group: 'waiting-on-machine',
      clause: 'new head, checks not yet read',
    });
  });

  it('answers checks failing when checksSha equals the tip', () => {
    expect(prRowPlacement(readings({ checks: 'failing', checksSha: NEW, tip: NEW }))).toEqual({
      group: 'waiting-on-you',
      clause: 'checks failing',
    });
  });

  it('decides by commit and ignores any timestamp the caller holds', () => {
    // A reading can be newer than the tip's own read and still name the older head.
    const withNewerUpdatedAt = { ...readings({ checks: 'failing', checksSha: OLD, tip: NEW }), updatedAt: '2026-11-01T13:09:35Z' };
    expect(prRowPlacement(withNewerUpdatedAt).clause).toBe('new head, checks not yet read');
  });

  it('answers checks failing when the host supplies no checksSha', () => {
    expect(prRowPlacement(readings({ checks: 'failing', tip: NEW }))).toEqual({
      group: 'waiting-on-you',
      clause: 'checks failing',
    });
  });

  it('answers checks failing when no tip was read', () => {
    expect(prRowPlacement(readings({ checks: 'failing', checksSha: OLD }))).toEqual({
      group: 'waiting-on-you',
      clause: 'checks failing',
    });
  });

  it('leaves a conflicting PR answering conflicts', () => {
    expect(prRowPlacement(readings({ mergeable: 'conflicting', checks: 'failing', checksSha: OLD, tip: NEW })).clause).toBe('conflicts');
  });
});
