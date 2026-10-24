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
  perSprint: [],
  ...overrides,
});

describe('chipRow — This sprint', () => {
  it('is enabled and counts non-sprint rows as hidden when off', () => {
    const actual = chipRow(base());
    expect(actual.thisSprint).toEqual({
      label: 'This sprint', on: false, hiddenCount: 2, disabledReason: null,
    });
  });

  it('reports the same hidden count once the filter is on', () => {
    const off = chipRow(base()).thisSprint;
    const actual = chipRow(base({
      sprint: { hasActiveSprint: true, on: true, visibleRows: base().sprint.visibleRows },
    })).thisSprint;
    expect(actual.hiddenCount).toBe(2);
    expect(actual.hiddenCount).toBe(off.hiddenCount);
    expect(actual.on).toBe(true);
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

  it('is disabled with an empty identity, and never reports a hidden count', () => {
    const actual = chipRow(base({
      mine: { reader: {}, on: false, visibleRows: [{ kind: 'pr', author: 'eins78' }] },
    }));
    expect(actual.mine.disabledReason).toBe('No identity configured — set hostUser or gitEmail.');
    expect(actual.mine.hiddenCount).toBe(0);
    expect(actual.mine.on).toBe(false);
  });

  // ISSUE #2476: `isMine`'s ownership match never compares a host login to an
  // email (`ownership.ts`'s `comparableLogin`), so a `gitEmail`-only identity
  // can never match a row's author. Before this fix the chip enabled on
  // `gitEmail` and reported a `hiddenCount` that could never move — "Mine" on
  // looked actionable but filtered nothing. Now it disables with a reason
  // naming WHY, distinct from "nothing configured at all".
  it('is disabled with only gitEmail set — isMine can never match an email', () => {
    const actual = chipRow(base({
      mine: { reader: { gitEmail: 'jan.wloka@quatico.com' }, on: true, visibleRows: [] },
    }));
    expect(actual.mine.label).toBe('Mine');
    expect(actual.mine.disabledReason)
      .toBe('No host login configured — gitEmail cannot be matched to a PR or ticket author.');
    expect(actual.mine.on).toBe(false);
    expect(actual.mine.hiddenCount).toBe(0);
  });

  it('reports the same hidden count once the filter is on', () => {
    const actual = chipRow(base({
      mine: { ...base().mine, on: true },
    }));
    expect(actual.mine.hiddenCount).toBe(1);
    expect(actual.mine.hiddenCount).toBe(chipRow(base()).mine.hiddenCount);
  });

  // ISSUE #2476's TEST-COVERAGE FINDING: every prior `mine.visibleRows`
  // fixture names an author the directory or hostUser resolves. A row whose
  // owner cannot be determined at all (no author) must stay — the same
  // "unowned and unknown both stay" contract `rowsForReader` documents
  // (`AgentList.tsx`'s own comment on `mine-filter.ts`) — rather than being
  // treated as somebody else's and hidden.
  it('keeps a row whose owner cannot be determined, same as an unowned row', () => {
    const actual = chipRow(base({
      mine: {
        reader: { hostUser: 'jwloka', directory },
        on: true,
        visibleRows: [
          { kind: 'pr', author: 'jwloka' },
          { kind: 'pr', author: 'eins78' },
          { kind: 'pr', author: undefined },
          { kind: 'other' },
        ],
      },
    }));
    // Only the row that resolves to someone else is hidden; the unresolvable
    // PR author and the ownerless `other` row both stay, same as `jwloka`'s own.
    expect(actual.mine.hiddenCount).toBe(1);
  });
});

describe('chipRow — per-sprint chips', () => {
  it('returns one chip per Active sprint, with its own hidden count', () => {
    const actual = chipRow(base({
      perSprint: [
        {
          slug: 'alpha', title: 'Alpha', on: false,
          visibleRows: [{ inSprint: true }, { inSprint: false }, { inSprint: false }],
        },
        {
          slug: 'beta', title: 'Beta', on: true,
          visibleRows: [{ inSprint: false }, { inSprint: true }, { inSprint: false }],
        },
      ],
    }));
    expect(actual.perSprint).toEqual([
      { label: 'Alpha', on: false, hiddenCount: 2, disabledReason: null },
      { label: 'Beta', on: true, hiddenCount: 2, disabledReason: null },
    ]);
  });

  // DONE-WHEN FIXTURE: 3 Active sprints, selection narrowed to 1. The
  // per-sprint chip's own hidden count (what toggling THAT sprint alone would
  // hide) and `This sprint`'s hidden count (what the all-or-nothing toggle
  // would hide, against every Active sprint) must be asserted independently —
  // a naive implementation that feeds one into the other would make this
  // pass by accident whichever direction it leaked.
  it('answers independently of This sprint, with 3 Active sprints and a narrower selection', () => {
    // 6 total rows: 2 in alpha, 3 in beta, 1 in gamma. Selection = ['beta'].
    const actual = chipRow(base({
      sprint: {
        hasActiveSprint: true,
        on: true,
        // `This sprint`'s own count is against EVERY Active sprint — only the
        // row in none of the three (the 6th) is hidden by that all-or-nothing read.
        visibleRows: [
          { inSprint: true }, { inSprint: true }, // alpha's 2
          { inSprint: true }, { inSprint: true }, { inSprint: true }, // beta's 3
          { inSprint: false }, // the row in none of the three
        ],
      },
      perSprint: [
        {
          slug: 'alpha', title: 'Alpha', on: false,
          visibleRows: [
            { inSprint: true }, { inSprint: true },
            { inSprint: false }, { inSprint: false }, { inSprint: false }, { inSprint: false },
          ],
        },
        {
          slug: 'beta', title: 'Beta', on: true,
          visibleRows: [
            { inSprint: false }, { inSprint: false },
            { inSprint: true }, { inSprint: true }, { inSprint: true }, { inSprint: false },
          ],
        },
        {
          slug: 'gamma', title: 'Gamma', on: false,
          visibleRows: [
            { inSprint: false }, { inSprint: false },
            { inSprint: false }, { inSprint: false }, { inSprint: false }, { inSprint: false },
          ],
        },
      ],
    }));
    expect(actual.thisSprint.hiddenCount).toBe(1);
    expect(actual.perSprint).toEqual([
      { label: 'Alpha', on: false, hiddenCount: 4, disabledReason: null },
      { label: 'Beta', on: true, hiddenCount: 3, disabledReason: null },
      { label: 'Gamma', on: false, hiddenCount: 6, disabledReason: null },
    ]);
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
