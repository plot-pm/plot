import { describe, expect, it } from 'vitest';
import { chipRow, type ChipRowReadings } from '../src/rules/chip-row.js';
import { parsePersonDirectory } from '../src/entities/person.js';

const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');

const base = (overrides: Partial<ChipRowReadings> = {}): ChipRowReadings => ({
  sprint: {
    hasActiveSprint: true,
    on: false,
    visibleRows: [{ inSprint: true }, { inSprint: false }, { inSprint: false }],
  },
  mine: {
    reader: { hostUser: 'jwloka', directory },
    on: false,
    visibleRows: [{ kind: 'pr', author: 'jwloka' }, { kind: 'pr', author: 'eins78' }],
  },
  waitingOnMe: { on: false },
  ...overrides,
});

describe('chipRow — This sprint', () => {
  it('is enabled and counts non-sprint rows as hidden when off', () => {
    const actual = chipRow(base());
    expect(actual.thisSprint).toEqual({
      label: 'This sprint', on: false, hiddenCount: 2, disabledReason: null,
    });
  });

  it('reports zero hidden once the filter is on', () => {
    const actual = chipRow(base({ sprint: { hasActiveSprint: true, on: true, visibleRows: [] } }));
    expect(actual.thisSprint.hiddenCount).toBe(0);
    expect(actual.thisSprint.on).toBe(true);
  });

  it('is disabled with no active sprint, and never reports a hidden count', () => {
    const actual = chipRow(base({
      sprint: { hasActiveSprint: false, on: false, visibleRows: [{ inSprint: false }] },
    }));
    expect(actual.thisSprint.disabledReason).toBe('No sprint is Active.');
    expect(actual.thisSprint.hiddenCount).toBe(0);
  });
});

describe('chipRow — Mine', () => {
  it('names the identity in its label and counts rows that are not the reader\'s as hidden', () => {
    const actual = chipRow(base());
    expect(actual.mine).toEqual({
      label: 'Mine (jwloka)', on: false, hiddenCount: 1, disabledReason: null,
    });
  });

  it('falls back to the raw login where the directory declares no display name', () => {
    const actual = chipRow(base({
      mine: { reader: { hostUser: 'nobody' }, on: false, visibleRows: [] },
    }));
    expect(actual.mine.label).toBe('Mine (nobody)');
    expect(actual.mine.disabledReason).toBeNull();
  });

  it('falls back to gitEmail where hostUser is absent', () => {
    const actual = chipRow(base({
      mine: { reader: { gitEmail: 'jan.wloka@quatico.com' }, on: false, visibleRows: [] },
    }));
    expect(actual.mine.label).toBe('Mine (jan.wloka@quatico.com)');
    expect(actual.mine.disabledReason).toBeNull();
  });

  it('is disabled with an empty identity, and never reports a hidden count', () => {
    const actual = chipRow(base({
      mine: { reader: {}, on: false, visibleRows: [{ kind: 'pr', author: 'eins78' }] },
    }));
    expect(actual.mine.disabledReason).toBe('No identity configured — set hostUser or gitEmail.');
    expect(actual.mine.hiddenCount).toBe(0);
    expect(actual.mine.on).toBe(false);
  });

  it('is enabled with only gitEmail set — the inverse of the #2079 defect', () => {
    const actual = chipRow(base({
      mine: { reader: { gitEmail: 'jan.wloka@quatico.com' }, on: true, visibleRows: [] },
    }));
    expect(actual.mine.disabledReason).toBeNull();
    expect(actual.mine.on).toBe(true);
  });

  it('reports zero hidden once the filter is on', () => {
    const actual = chipRow(base({
      mine: { reader: { hostUser: 'jwloka', directory }, on: true, visibleRows: [] },
    }));
    expect(actual.mine.hiddenCount).toBe(0);
  });
});

describe('chipRow — Waiting on me', () => {
  it('is always disabled, with a reason naming no behaviour exists yet', () => {
    const actual = chipRow(base());
    expect(actual.waitingOnMe).toEqual({
      label: 'Waiting on me',
      on: false,
      hiddenCount: 0,
      disabledReason: 'Not yet defined — no rule names what this chip filters.',
    });
  });

  it('stays disabled even when the readings claim the filter is on', () => {
    const actual = chipRow(base({ waitingOnMe: { on: true } }));
    expect(actual.waitingOnMe.on).toBe(false);
    expect(actual.waitingOnMe.disabledReason).not.toBeNull();
  });
});
