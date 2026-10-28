import { describe, it, expect } from 'vitest';
import { chipRow } from '@plot-pm/domain/rules/chip-row';
import { rowInSprintSelection } from '@plot-pm/domain';
import { chipReadings, type ChipReadingsInput } from '../../src/app/lib/agent-rows/chip-readings.js';

/**
 * `chipReadings` gathers what the Delivery tab passes to `chipRow`. This file
 * runs the two together over the inputs `AgentList.tsx` holds, so a wrong row
 * set or a wrong slug list reaching the domain fails here; the domain's own
 * counting is covered by `packages/domain/test/chip-row.test.ts`.
 */

type Row = ChipReadingsInput['rows'][number];

const row = (plan: string, overrides: Partial<Row> = {}): Row => ({
  kind: 'branch', plan, pr: null, assignee: '', author: '', approver: '', ...overrides,
} as Row);

const membership = new Map([
  ['alpha', new Set(['plan-a1', 'plan-a2'])],
  ['beta', new Set(['plan-b1', 'plan-b2'])],
  ['gamma', new Set(['plan-g1'])],
]);
const activeSprints = [
  { slug: 'alpha', title: 'Alpha' },
  { slug: 'beta', title: 'Beta' },
  { slug: 'gamma', title: 'Gamma' },
];
const rows = ['plan-a1', 'plan-a2', 'plan-b1', 'plan-b2', 'plan-g1', 'plan-z'].map((plan) => row(plan));

/** The inputs as `AgentList.tsx` derives them from one selection. */
const input = (selectedSprints: string[], overrides: Partial<ChipReadingsInput> = {}): ChipReadingsInput => ({
  rows,
  sprintFilteredRows: selectedSprints.length === 0
    ? rows
    : rows.filter((r) => rowInSprintSelection(r, selectedSprints, membership)),
  agents: [],
  activeSprints,
  selectedSprints,
  membership,
  reader: { hostUser: 'jwloka' },
  mode: 'all',
  ...overrides,
});

/** How many rows the screen hides for a selection, as `AgentList.tsx` filters them. */
const hiddenOnScreen = (selected: string[]): number => rows.length - input(selected).sprintFilteredRows.length;

describe('chipReadings — every sprint chip reads the current selection', () => {
  // ISSUE #2526's HIGH: «This sprint» selects every Active sprint. Each
  // per-sprint chip is then on and must report what the screen hides, not
  // what its own slug alone would hide.
  it('with every Active sprint selected, every chip reports the rows the screen hides', () => {
    const selected = ['alpha', 'beta', 'gamma'];
    const chips = chipRow(chipReadings(input(selected)));
    expect(hiddenOnScreen(selected)).toBe(1);
    expect(chips.thisSprint.hiddenCount).toBe(1);
    expect(chips.perSprint.map((chip) => chip.hiddenCount)).toEqual([1, 1, 1]);
  });

  it('with two of three selected, the chips that are on match the screen', () => {
    const selected = ['alpha', 'beta'];
    const chips = chipRow(chipReadings(input(selected)));
    expect(hiddenOnScreen(selected)).toBe(2);
    expect(chips.thisSprint).toMatchObject({ on: true, hiddenCount: 2 });
    expect(chips.perSprint).toEqual([
      { label: 'Alpha', on: true, hiddenCount: 2, disabledReason: null },
      { label: 'Beta', on: true, hiddenCount: 2, disabledReason: null },
      { label: 'Gamma', on: false, hiddenCount: 1, disabledReason: null },
    ]);
  });

  it('passes the Active sprints in order, one per-sprint chip each', () => {
    const readings = chipReadings(input([]));
    expect(readings.sprint.sprints).toEqual(activeSprints);
    expect(readings.sprint.selected).toEqual([]);
    expect(readings.sprint.rows).toHaveLength(rows.length);
  });
});

describe('chipReadings — the Mine chip reads the rows after the sprint filter', () => {
  it('counts only the sprint-filtered rows somebody else owns', () => {
    const owned = [
      row('plan-a1', { pr: { author: 'eins78' } as Row['pr'] }),
      row('plan-z', { pr: { author: 'eins78' } as Row['pr'] }),
      row('plan-a2', { pr: { author: 'jwloka' } as Row['pr'] }),
    ];
    const selected = ['alpha'];
    const chips = chipRow(chipReadings(input(selected, {
      rows: owned,
      sprintFilteredRows: owned.filter((r) => rowInSprintSelection(r, selected, membership)),
      mode: 'mine-and-unknown',
    })));
    // plan-z is hidden by the sprint filter, so only plan-a1 counts.
    expect(chips.mine).toEqual({ label: 'Mine (jwloka)', on: true, hiddenCount: 1, disabledReason: null });
  });
});

describe('chipReadings — a branch counts once for the Mine chip', () => {
  // ISSUE #2853's MEDIUM: a branch whose row and agent both hid added 2.
  it('joins an agent to the row on its branch', () => {
    const branchRows = [row('plan-z', { branch: 'feature/x' } as Partial<Row>)];
    const agents = [
      { branch: 'feature/x', identity: 'manifest', state: 'elsewhere' },
      { branch: 'feature/y', identity: 'manifest', state: 'elsewhere' },
    ] as ChipReadingsInput['agents'];
    const chips = chipRow(chipReadings(input([], { rows: branchRows, sprintFilteredRows: branchRows, agents, mode: 'mine' })));
    expect(chips.mine.hiddenCount).toBe(2);
    expect(chips.mineStrict).toEqual({ label: 'show 2 unknown', pressed: true, unknownCount: 2 });
  });
});
