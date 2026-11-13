import { describe, it, expect } from 'vitest';
import { baseCandidateBranches, baseLine, localChecksBase, type LocalChecksBaseReadings } from '../src/rules/local-checks-base.js';

const held = ['main', 'sprint/triggers-and-connectors', 'sprint/nothing-runs', 'bug/x'];

const readings = (over: Partial<LocalChecksBaseReadings>): LocalChecksBaseReadings => ({
  flag: null,
  manifestBase: null,
  defaultBranch: 'main',
  remoteBranches: held,
  candidates: [],
  ...over,
});

describe('baseCandidateBranches', () => {
  it('names the default branch first, then every sprint branch in name order, and no other branch', () => {
    expect(baseCandidateBranches('main', held)).toEqual(['main', 'sprint/nothing-runs', 'sprint/triggers-and-connectors']);
  });
});

describe('localChecksBase', () => {
  it('takes the --base argument first, over a manifest base and every count', () => {
    const chosen = localChecksBase(
      readings({ flag: 'main', manifestBase: 'sprint/nothing-runs', candidates: [{ branch: 'sprint/nothing-runs', ahead: 0 }] }),
    );
    expect(chosen).toEqual({ base: 'main', reason: 'flag', ahead: null });
  });

  it('takes the manifest base where origin holds it, over the counts', () => {
    const chosen = localChecksBase(
      readings({ manifestBase: 'sprint/nothing-runs', candidates: [{ branch: 'main', ahead: 0 }] }),
    );
    expect(chosen).toEqual({ base: 'sprint/nothing-runs', reason: 'manifest', ahead: null });
  });

  it('passes over a manifest base that origin no longer holds', () => {
    const chosen = localChecksBase(
      readings({ manifestBase: 'sprint/gone', candidates: [{ branch: 'main', ahead: 3 }] }),
    );
    expect(chosen).toEqual({ base: 'main', reason: 'nearest', ahead: 3 });
  });

  it('takes the sprint branch HEAD sits fewest commits past: one commit off the sprint against 47 off main', () => {
    const chosen = localChecksBase(
      readings({
        candidates: [
          { branch: 'main', ahead: 47 },
          { branch: 'sprint/nothing-runs', ahead: 60 },
          { branch: 'sprint/triggers-and-connectors', ahead: 1 },
        ],
      }),
    );
    expect(chosen).toEqual({ base: 'sprint/triggers-and-connectors', reason: 'nearest', ahead: 1 });
  });

  it('gives a tie to the default branch, wherever it stands in the list', () => {
    const chosen = localChecksBase(
      readings({
        candidates: [
          { branch: 'sprint/nothing-runs', ahead: 2 },
          { branch: 'main', ahead: 2 },
        ],
      }),
    );
    expect(chosen).toEqual({ base: 'main', reason: 'nearest', ahead: 2 });
  });

  it('gives a tie between sprint branches to the first in name order', () => {
    const chosen = localChecksBase(
      readings({
        candidates: [
          { branch: 'main', ahead: 9 },
          { branch: 'sprint/triggers-and-connectors', ahead: 1 },
          { branch: 'sprint/nothing-runs', ahead: 1 },
        ],
      }),
    );
    expect(chosen.base).toBe('sprint/nothing-runs');
  });

  it('skips an unread count rather than reading it as zero', () => {
    const chosen = localChecksBase(
      readings({
        candidates: [
          { branch: 'main', ahead: 5 },
          { branch: 'sprint/nothing-runs', ahead: null },
        ],
      }),
    );
    expect(chosen).toEqual({ base: 'main', reason: 'nearest', ahead: 5 });
  });

  it('answers the default branch as unread where no count was read', () => {
    const chosen = localChecksBase(readings({ candidates: [{ branch: 'main', ahead: null }] }));
    expect(chosen).toEqual({ base: 'main', reason: 'unread', ahead: null });
  });

  it('reads an empty flag and an empty manifest base as absent', () => {
    const chosen = localChecksBase(readings({ flag: ' ', manifestBase: ' ', candidates: [{ branch: 'main', ahead: 0 }] }));
    expect(chosen.reason).toBe('nearest');
  });
});

describe('baseLine', () => {
  it('names the base, the count and every other candidate for a nearest choice', () => {
    const candidates = [
      { branch: 'main', ahead: 47 },
      { branch: 'sprint/triggers-and-connectors', ahead: 1 },
    ];
    expect(baseLine({ base: 'sprint/triggers-and-connectors', reason: 'nearest', ahead: 1 }, candidates)).toBe(
      '# base: origin/sprint/triggers-and-connectors (nearest: HEAD is 1 commit past it; main 47)',
    );
  });

  it('names the reason for a flag, a manifest and an unread choice', () => {
    expect(baseLine({ base: 'main', reason: 'flag', ahead: null }, [])).toBe('# base: origin/main (the --base argument)');
    expect(baseLine({ base: 'sprint/s', reason: 'manifest', ahead: null }, [])).toBe('# base: origin/sprint/s (the desk manifest records it)');
    expect(baseLine({ base: 'main', reason: 'unread', ahead: null }, [])).toMatch(/^# base: origin\/main \(no candidate count/);
  });

  it('prints an object id as given', () => {
    const sha = 'a'.repeat(40);
    expect(baseLine({ base: sha, reason: 'flag', ahead: null }, [])).toBe(`# base: ${sha} (the --base argument)`);
  });
});
