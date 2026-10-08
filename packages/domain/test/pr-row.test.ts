import { describe, it, expect } from 'vitest';
import { prRowPlacement, type PrRowReadings } from '../src/rules/pr-row.js';

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
