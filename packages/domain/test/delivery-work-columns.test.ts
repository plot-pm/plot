import { describe, it, expect } from 'vitest';
import { placeDelivery, type ItemPlacement, type WorkItemReading } from '../src/rules/delivery-placement.js';
import { ROW_COLUMNS, itemRowCells, type ItemRowFacts } from '../src/rules/delivery-row-form.js';
import {
  WORK_GROUP_COLUMN,
  WORK_ITEM_COLUMNS,
  oldestWaitsClause,
  workGroupCountText,
  workItemCells,
} from '../src/rules/delivery-work-columns.js';

const slice = (group: 'at-a-gate' | 'being-built' | 'queued'): ItemPlacement =>
  ({ id: `slice:${group}`, kind: 'slice', section: 'work-items', group, reason: null, agents: [] });

describe('the Gates cell', () => {
  const gates = (prReading: ItemRowFacts['prReading'], facts: Partial<ItemRowFacts> = { pr: 4 }) =>
    workItemCells(slice('at-a-gate'), { plan: 'p', branch: 'feature/x', prReading, ...facts })!.cells.group;

  it('shows both gates at once, each linked to its own page', () => {
    const cell = gates({ ci: 'passed', review: 'high' });
    expect(cell?.value).toBe('CI ✓ · review ✗');
    expect(cell?.parts).toEqual([
      { value: 'CI ✓', link: { to: 'checks', pr: 4 } },
      { value: 'review ✗', link: { to: 'review', pr: 4 } },
    ]);
  });

  it('marks CI failed beside a review nobody asked, and links only the CI mark', () => {
    const cell = gates({ ci: 'failed', review: 'none' });
    expect(cell?.value).toBe('CI ✗ · review –');
    expect(cell?.parts).toEqual([
      { value: 'CI ✗', link: { to: 'checks', pr: 4 } },
      { value: 'review –', link: null },
    ]);
    expect(cell?.links).toEqual([{ to: 'checks', pr: 4 }]);
  });

  it.each([
    ['pending', 'review ⟳'],
    ['high', 'review ✗'],
    ['passed', 'review ✓'],
  ] as const)('reads review %s as %s linked to the PR', (review, mark) => {
    expect(gates({ ci: 'unread', review })?.parts).toEqual([{ value: mark, link: { to: 'review', pr: 4 } }]);
  });

  it('renders no review mark for an unread review and no CI mark for an unread CI', () => {
    expect(gates({ ci: 'running', review: 'unread' })?.parts).toEqual([{ value: 'CI ⟳', link: { to: 'checks', pr: 4 } }]);
    expect(gates({ ci: 'unread', review: 'unread' })).toBeNull();
  });

  it('links nothing where the PR number is unknown', () => {
    expect(gates({ ci: 'passed', review: 'passed' }, {})?.links).toEqual([]);
  });

  it('keeps the single status string for the You rows', () => {
    const you: ItemPlacement = { id: 's', kind: 'slice', section: 'you', reason: 'review-pr', agents: [] };
    expect(itemRowCells(you, { pr: 4, prReading: { ci: 'passed', review: 'high' } })!.status?.value).toBe('review · CI ✓');
  });
});

describe('the Work items columns', () => {
  it('name one column per group and none of them is status', () => {
    expect([...WORK_ITEM_COLUMNS]).toEqual(['kind', 'item', 'where', 'group', 'by', 'age']);
    expect(WORK_ITEM_COLUMNS).not.toContain('status');
    expect(ROW_COLUMNS).toContain('status');
    expect(WORK_GROUP_COLUMN).toEqual({
      'at-a-gate': { name: 'Gates', holds: 'gate' },
      'being-built': { name: 'Progress', holds: 'progress' },
      queued: { name: 'Waits on', holds: 'wait' },
    });
  });

  it('give three groups three column names and three kinds of value', () => {
    const facts: ItemRowFacts = { plan: 'p', branch: 'feature/x', pr: 4, prReading: { ci: 'passed', review: 'pending' }, waitsOn: 'first' };
    const gate = workItemCells(slice('at-a-gate'), facts)!;
    const built = workItemCells(slice('being-built'), facts)!;
    const queued = workItemCells(slice('queued'), facts)!;
    expect([gate.column, built.column, queued.column]).toEqual(['Gates', 'Progress', 'Waits on']);
    expect(gate.cells.group?.value).toMatch(/CI|review/);
    expect(built.cells.group).toBeNull();
    expect(queued.cells.group?.value).toBe('waits on first');
    expect(Object.keys(gate.cells)).toEqual([...WORK_ITEM_COLUMNS]);
  });

  it('return nothing for a Work items item with no row shape', () => {
    expect(workItemCells({ ...slice('queued'), kind: 'plan' }, {})).toBeNull();
  });

  it('return nothing for an item outside Work items', () => {
    expect(workItemCells({ ...slice('queued'), section: 'fleet' } as never, {})).toBeNull();
  });
});

describe('Queued membership', () => {
  const item = (over: Partial<WorkItemReading>): WorkItemReading =>
    ({ id: 'plan:p', kind: 'plan', ownership: 'theirs', ...over }) as WorkItemReading;
  const input = { mine: 'off', autoReview: true, correctionBudget: 2, tickets: null, ticketSource: null, releases: [], sprints: [], releaseTickets: undefined } as never;

  it("places another person's Draft plan in Queued", () => {
    const out = placeDelivery({ items: [item({ phase: 'draft' })], agents: [] } as never, input);
    expect(out.items[0]).toMatchObject({ section: 'work-items', group: 'queued' });
  });

  it("places another person's approval-owed item in Queued", () => {
    const out = placeDelivery({ items: [item({ approvalOwed: 'plan' })], agents: [] } as never, input);
    expect(out.items[0]).toMatchObject({ section: 'work-items', group: 'queued' });
  });

  it('places a building slice with no live agent in Queued', () => {
    const out = placeDelivery({ items: [{ id: 'slice:a', kind: 'slice', ownership: 'mine', stage: 'building' }], agents: [] } as never, input);
    expect(out.items[0]).toMatchObject({ section: 'work-items', group: 'queued' });
  });
});

describe('the oldest age', () => {
  it('takes the oldest across all groups, not the first', () => {
    expect(oldestWaitsClause([undefined, 125, 5])).toBe('oldest waits 2h');
  });
  it('prints nothing where no row has an age, and never 0', () => {
    expect(oldestWaitsClause([])).toBeNull();
    expect(oldestWaitsClause([undefined, null])).toBeNull();
    expect(oldestWaitsClause([0])).toBe('oldest waits 0m');
  });
  it('counts first, label lowercase', () => {
    expect(workGroupCountText('At a gate', 2)).toBe('2 at a gate');
    expect(workGroupCountText('Queued', 0)).toBe('0 queued');
  });
});
