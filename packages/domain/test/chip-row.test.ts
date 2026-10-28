import { describe, expect, it } from 'vitest';
import { chipRow, type ChipRowReadings, type SprintChipReadings } from '../src/rules/chip-row.js';
import { parsePersonDirectory } from '../src/entities/person.js';

const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');

// Fixture: alpha holds plan-a1 and plan-a2, beta holds plan-b1..plan-b3,
// gamma holds plan-g1, and plan-z is in no sprint.
const membership = new Map([
  ['alpha', new Set(['plan-a1', 'plan-a2'])],
  ['beta', new Set(['plan-b1', 'plan-b2', 'plan-b3'])],
  ['gamma', new Set(['plan-g1'])],
]);
const planRow = (plan: string) => ({ kind: 'plan', plan });
const allRows = ['plan-a1', 'plan-a2', 'plan-b1', 'plan-b2', 'plan-b3', 'plan-g1', 'plan-z'].map(planRow);
const sprints = [
  { slug: 'alpha', title: 'Alpha' },
  { slug: 'beta', title: 'Beta' },
  { slug: 'gamma', title: 'Gamma' },
];

const sprintReadings = (selected: string[], overrides: Partial<SprintChipReadings> = {}): SprintChipReadings => ({
  sprints, selected, membership, rows: allRows, ...overrides,
});

const base = (overrides: Partial<ChipRowReadings> = {}): ChipRowReadings => ({
  sprint: sprintReadings([]),
  mine: {
    reader: { hostUser: 'jwloka', directory },
    mode: 'all',
    visibleRows: [{ kind: 'pr', author: 'jwloka' }, { kind: 'pr', author: 'eins78' }],
    visibleAgents: [],
  },
  waitingOnMe: { on: false },
  ...overrides,
});

describe('chipRow — This sprint', () => {
  it('is off with no selection, and counts the rows in no Active sprint as hidden', () => {
    const actual = chipRow(base());
    expect(actual.thisSprint).toEqual({
      label: 'This sprint', on: false, hiddenCount: 1, disabledReason: null,
    });
  });

  it('is on with every Active sprint selected, and reports the same hidden count', () => {
    const actual = chipRow(base({ sprint: sprintReadings(['alpha', 'beta', 'gamma']) })).thisSprint;
    expect(actual.on).toBe(true);
    expect(actual.hiddenCount).toBe(chipRow(base()).thisSprint.hiddenCount);
  });

  it('counts against the current selection once it narrows', () => {
    const actual = chipRow(base({ sprint: sprintReadings(['beta']) })).thisSprint;
    expect(actual.on).toBe(true);
    // alpha's 2, gamma's 1 and the row in no sprint.
    expect(actual.hiddenCount).toBe(4);
  });

  it('is disabled with no active sprint, and never reports a hidden count', () => {
    const actual = chipRow(base({ sprint: sprintReadings([], { sprints: [], membership: new Map() }) }));
    expect(actual.thisSprint.disabledReason).toBe('No sprint is Active.');
    expect(actual.thisSprint.hiddenCount).toBe(0);
    expect(actual.perSprint).toEqual([]);
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
      mine: { reader: { hostUser: 'nobody' }, mode: 'all', visibleRows: [], visibleAgents: [] },
    }));
    expect(actual.mine.label).toBe('Mine (nobody)');
    expect(actual.mine.disabledReason).toBeNull();
  });

  it('is disabled with an empty identity, and never reports a hidden count', () => {
    const actual = chipRow(base({
      mine: { reader: {}, mode: 'all', visibleRows: [{ kind: 'pr', author: 'eins78' }], visibleAgents: [] },
    }));
    expect(actual.mine.disabledReason).toBe('No identity configured — set hostUser.');
    expect(actual.mine.hiddenCount).toBe(0);
    expect(actual.mine.on).toBe(false);
  });

  // ISSUE #2476: `ownership`'s match never compares a host login to an
  // email (`ownership.ts`'s `comparableLogin`), so a `gitEmail`-only identity
  // can never match a row's author. Before this fix the chip enabled on
  // `gitEmail` and reported a `hiddenCount` that could never move — "Mine" on
  // looked actionable but filtered nothing. Now it disables with a reason
  // naming WHY, distinct from "nothing configured at all".
  it('is disabled with only gitEmail set — ownership can never match an email', () => {
    const actual = chipRow(base({
      mine: {
        reader: { gitEmail: 'jan.wloka@quatico.com' },
        mode: 'mine-and-unknown',
        visibleRows: [],
        visibleAgents: [],
      },
    }));
    expect(actual.mine.label).toBe('Mine');
    expect(actual.mine.disabledReason)
      .toBe('No host login configured — gitEmail cannot be matched to a PR or ticket author; set hostUser.');
    expect(actual.mine.on).toBe(false);
    expect(actual.mine.hiddenCount).toBe(0);
  });

  // ISSUE #2526: `comparableLogin` reads an email-shaped `hostUser` as no
  // login, so `ownership` never answers `theirs` for it. The chip must not
  // enable on it and report a count it cannot act on.
  it('is disabled with an email-shaped hostUser, naming hostUser as the fix', () => {
    const actual = chipRow(base({
      mine: {
        reader: { hostUser: 'jan.wloka@quatico.com', directory },
        mode: 'mine-and-unknown',
        visibleRows: [{ kind: 'pr', author: 'eins78' }],
        visibleAgents: [],
      },
    }));
    expect(actual.mine).toEqual({
      label: 'Mine',
      on: false,
      hiddenCount: 0,
      disabledReason: 'hostUser is an email, not a host login — set hostUser to the host login.',
    });
  });

  it('reports the same hidden count once the filter is on', () => {
    const actual = chipRow(base({
      mine: { ...base().mine, mode: 'mine-and-unknown' },
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
        mode: 'mine-and-unknown',
        visibleRows: [
          { kind: 'pr', author: 'jwloka' },
          { kind: 'pr', author: 'eins78' },
          { kind: 'pr', author: undefined },
          { kind: 'other' },
        ],
        visibleAgents: [],
      },
    }));
    // Only the row that resolves to someone else is hidden; the unresolvable
    // PR author and the ownerless `other` row both stay, same as `jwloka`'s own.
    expect(actual.mine.hiddenCount).toBe(1);
  });

  // CONTRACT CHANGE (feature/mine-mode-control): `mine` mode switches the
  // chip's own match from the lenient `ownership(...) !== 'theirs'` test to
  // `isMineStrict`, so a row whose owner cannot be determined now counts as
  // hidden too — unlike `mine-and-unknown`, which keeps it (the test above).
  it('in `mine` mode, also counts a row whose owner cannot be determined as hidden', () => {
    const actual = chipRow(base({
      mine: {
        reader: { hostUser: 'jwloka', directory },
        mode: 'mine',
        visibleRows: [
          { kind: 'pr', author: 'jwloka' },
          { kind: 'pr', author: 'eins78' },
          { kind: 'pr', author: undefined },
          { kind: 'other' },
        ],
        visibleAgents: [],
      },
    }));
    // jwloka's own row stays; the other three — somebody else's, unresolvable,
    // and ownerless — all count as hidden under the strict match.
    expect(actual.mine.hiddenCount).toBe(3);
    expect(actual.mine.on).toBe(true);
  });

  // CONTRACT CHANGE (feature/mine-mode-control): `MineChipReadings` widened to
  // carry `visibleAgents` alongside `visibleRows`, so the chip's hidden count
  // also covers registry agents — an agent with no desk on this machine is
  // `unknown` (`agentOwnership`), which `mine-and-unknown` keeps and `mine`
  // hides, same as an unowned row.
  it('keeps an agent with no desk here under `mine-and-unknown`, hides it under `mine`', () => {
    const reader = { hostUser: 'jwloka', directory };
    const agents = [{ kind: 'agent' as const, state: 'running' }, { kind: 'agent' as const, state: 'elsewhere' }];
    const lenient = chipRow(base({
      mine: { reader, mode: 'mine-and-unknown', visibleRows: [], visibleAgents: agents },
    }));
    const strict = chipRow(base({
      mine: { reader, mode: 'mine', visibleRows: [], visibleAgents: agents },
    }));
    // `mine-and-unknown` hides nothing — both agents have a desk or are unknown, never `theirs`.
    expect(lenient.mine.hiddenCount).toBe(0);
    // `mine` additionally hides the agent with no desk here.
    expect(strict.mine.hiddenCount).toBe(1);
  });
});

describe('chipRow — the hide/show-unknown control', () => {
  const reader = { hostUser: 'jwloka', directory };
  const mine = (mode: 'all' | 'mine-and-unknown' | 'mine', visibleRows: ChipRowReadings['mine']['visibleRows'], visibleAgents: ChipRowReadings['mine']['visibleAgents'] = []) =>
    chipRow(base({ mine: { reader, mode, visibleRows, visibleAgents } }));

  // ISSUE #2853's HIGH: the control was gated on the `theirs` count. It reads
  // the unknown count instead.
  it('shows with unknown rows and no row somebody else owns', () => {
    const actual = mine('mine-and-unknown', [{ kind: 'pr', author: 'jwloka' }, { kind: 'other' }, { kind: 'pr' }]);
    expect(actual.mine.hiddenCount).toBe(0);
    expect(actual.mineStrict).toEqual({ label: 'hide 2 unknown', pressed: false, unknownCount: 2 });
  });

  it('does not show with rows somebody else owns and no unknown row', () => {
    const actual = mine('mine-and-unknown', [{ kind: 'pr', author: 'jwloka' }, { kind: 'pr', author: 'eins78' }]);
    expect(actual.mine.hiddenCount).toBe(1);
    expect(actual.mineStrict).toBeNull();
  });

  it('names the unknown count in mine mode, beside a hidden count of theirs plus unknown', () => {
    const actual = mine('mine', [{ kind: 'pr', author: 'eins78' }, { kind: 'other' }, { kind: 'pr' }]);
    expect(actual.mine.hiddenCount).toBe(3);
    expect(actual.mineStrict).toEqual({ label: 'show 2 unknown', pressed: true, unknownCount: 2 });
  });

  it('does not show in all mode', () => {
    expect(mine('all', [{ kind: 'other' }]).mineStrict).toBeNull();
  });

  it('does not show while the chip is disabled', () => {
    const actual = chipRow(base({ mine: { reader: {}, mode: 'all', visibleRows: [{ kind: 'other' }], visibleAgents: [] } }));
    expect(actual.mineStrict).toBeNull();
  });

  // ISSUE #2853's MEDIUM: a branch whose row and agent both hide counted twice.
  it('counts a branch once where its row and its agent both hide', () => {
    const actual = mine(
      'mine',
      [{ kind: 'other', branch: 'feature/x' }],
      [{ kind: 'agent', state: 'elsewhere', branch: 'feature/x' }, { kind: 'agent', state: 'elsewhere', branch: 'feature/y' }],
    );
    expect(actual.mine.hiddenCount).toBe(2);
    expect(actual.mineStrict?.unknownCount).toBe(2);
  });
});

describe('chipRow — per-sprint chips', () => {
  it('returns one chip per Active sprint; with no selection each counts what its click would hide', () => {
    const actual = chipRow(base());
    expect(actual.perSprint).toEqual([
      { label: 'Alpha', on: false, hiddenCount: 5, disabledReason: null },
      { label: 'Beta', on: false, hiddenCount: 4, disabledReason: null },
      { label: 'Gamma', on: false, hiddenCount: 6, disabledReason: null },
    ]);
  });

  // ISSUE #2526's HIGH: «This sprint» selects every Active sprint, so every
  // per-sprint chip turns on. Each one that is on must report the rows the
  // screen hides — counted against its own slug alone, alpha's chip would
  // count beta's and gamma's visible rows as hidden.
  it('with every sprint selected, each chip that is on reports the rows the screen hides', () => {
    const actual = chipRow(base({ sprint: sprintReadings(['alpha', 'beta', 'gamma']) }));
    expect(actual.thisSprint.hiddenCount).toBe(1);
    expect(actual.perSprint.map((chip) => [chip.on, chip.hiddenCount])).toEqual([
      [true, 1], [true, 1], [true, 1],
    ]);
  });

  it('with two Active sprints both selected, each chip reports the one row in neither', () => {
    const twoSprints = sprintReadings(['alpha', 'beta'], {
      sprints: sprints.slice(0, 2),
      membership: new Map([...membership].slice(0, 2)),
      rows: allRows.filter((row) => row.plan !== 'plan-g1'),
    });
    const actual = chipRow(base({ sprint: twoSprints }));
    expect(actual.thisSprint.hiddenCount).toBe(1);
    expect(actual.perSprint).toEqual([
      { label: 'Alpha', on: true, hiddenCount: 1, disabledReason: null },
      { label: 'Beta', on: true, hiddenCount: 1, disabledReason: null },
    ]);
  });

  // Three Active sprints, alpha and beta selected: the screen hides gamma's
  // row and the row in no sprint. Gamma's chip is off; its click would add
  // gamma, leaving only the row in no sprint hidden.
  it('with three Active sprints and two selected, the chips that are on match the screen', () => {
    const actual = chipRow(base({ sprint: sprintReadings(['alpha', 'beta']) }));
    expect(actual.thisSprint.hiddenCount).toBe(2);
    expect(actual.perSprint).toEqual([
      { label: 'Alpha', on: true, hiddenCount: 2, disabledReason: null },
      { label: 'Beta', on: true, hiddenCount: 2, disabledReason: null },
      { label: 'Gamma', on: false, hiddenCount: 1, disabledReason: null },
    ]);
  });

  it('with one of three selected, the chips that are off count the selection with their sprint added', () => {
    const actual = chipRow(base({ sprint: sprintReadings(['beta']) }));
    expect(actual.thisSprint.hiddenCount).toBe(4);
    expect(actual.perSprint).toEqual([
      { label: 'Alpha', on: false, hiddenCount: 2, disabledReason: null },
      { label: 'Beta', on: true, hiddenCount: 4, disabledReason: null },
      { label: 'Gamma', on: false, hiddenCount: 3, disabledReason: null },
    ]);
  });

  it('never hides an exempt row', () => {
    const rows = [...allRows, { kind: 'release', plan: '' }, { kind: 'pr', plan: '' }];
    const actual = chipRow(base({ sprint: sprintReadings(['alpha'], { rows }) }));
    expect(actual.thisSprint.hiddenCount).toBe(5);
    expect(actual.perSprint[0].hiddenCount).toBe(5);
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
