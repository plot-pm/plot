import { describe, it, expect } from 'vitest';
import { placeDelivery, type ItemPlacement, type WorkItemReading } from '../src/rules/delivery-placement.js';
import { FIXER_ATTEMPTS_BUDGET } from '../src/rules/fixer-attempts.js';
import { ROW_COLUMNS, itemRowCells, workByCell, type ItemRowFacts } from '../src/rules/delivery-row-form.js';
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

  it('renders no cell where no gate reading exists', () => {
    expect(gates(undefined)).toBeNull();
  });

  it('links nothing where the PR number is unknown', () => {
    expect(gates({ ci: 'passed', review: 'passed' }, {})?.links).toEqual([]);
  });

  it('keeps the single status string for the You rows', () => {
    const you: ItemPlacement = { id: 's', kind: 'slice', section: 'you', group: 'blocks-delivery', marker: 'blocks-delivery', reason: 'review-pr', agents: [] };
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
    expect(built.cells.group?.value).toBe('PR open');
    expect(queued.cells.group?.value).toBe('first');
    expect(Object.keys(gate.cells)).toEqual([...WORK_ITEM_COLUMNS]);
  });

  it('return nothing for a Work items item with no row shape', () => {
    expect(workItemCells({ ...slice('queued'), kind: 'plan' }, {})).toBeNull();
  });

  it('return nothing for an item outside Work items', () => {
    expect(workItemCells({ ...slice('queued'), section: 'fleet' } as never, {})).toBeNull();
  });
});

describe('the Progress cell', () => {
  const progress = (facts: ItemRowFacts) => workItemCells(slice('being-built'), { plan: 'p', branch: 'feature/x', ...facts })!.cells.group;

  it('reads no PR yet where the item has no open PR', () => {
    expect(progress({})?.value).toBe('no PR yet');
  });
  it('reads PR open where it has one, linked to the PR', () => {
    expect(progress({ pr: 4 })).toMatchObject({ value: 'PR open', links: [{ to: 'pr', pr: 4 }] });
  });
  it('names the unpushed count as unpushed beside the PR state', () => {
    expect(progress({ pr: 4, unpushed: 2 })?.value).toBe('PR open · 2 unpushed');
    expect(progress({ unpushed: 1 })?.value).toBe('no PR yet · 1 unpushed');
  });
  it.each([[0], [undefined]])('prints no count for a pushed or unread branch (%s)', (unpushed) => {
    const cell = progress({ pr: 4, ...(unpushed === undefined ? {} : { unpushed }) });
    expect(cell?.value).toBe('PR open');
    expect(cell?.value).not.toContain('unpushed');
  });
});

describe('the Waits on cell', () => {
  const waits = (facts: ItemRowFacts, agents: string[] = []) =>
    workItemCells({ ...slice('queued'), agents }, facts)!.cells.group;

  it('reads no agent assigned where nothing is waited on and no agent acts', () => {
    expect(waits({ plan: 'p' })?.value).toBe('no agent assigned');
  });
  it('is null where an agent acts and nothing is read', () => {
    expect(waits({ plan: 'p' }, ['a1'])).toBeNull();
  });
  it('names the earlier slice, linked, including a slice of another plan', () => {
    expect(waits({ waitsOn: 'first' })).toMatchObject({ value: 'first', links: [{ to: 'slice', id: 'first' }] });
    expect(waits({ waitsOn: 'other-plan/first' })?.value).toBe('other-plan/first');
  });
  it('reads an earlier slice where the server names none', () => {
    expect(waits({ waitsOn: '' })).toMatchObject({ value: 'an earlier slice', links: [] });
  });
  it("names another person's Draft plan with the display name", () => {
    expect(waits({ phase: 'draft', person: 'eins78', personName: 'Max Albrecht' })?.value).toBe('Draft · Max Albrecht');
    expect(waits({ phase: 'design', person: 'eins78', personName: 'Max Albrecht' })?.value).toBe('Design · Max Albrecht');
  });
  it('names the phase alone where no person is read, and the handle where no display name is declared', () => {
    expect(waits({ phase: 'draft' })).toMatchObject({ value: 'Draft', links: [] });
    expect(waits({ phase: 'draft', person: '' })?.value).toBe('Draft');
    expect(waits({ phase: 'draft', person: 'eins78' })).toMatchObject({ value: 'Draft · eins78', links: [{ to: 'person', handle: 'eins78' }] });
    expect(waits({ phase: 'draft', personName: 'Max Albrecht' })).toMatchObject({ value: 'Draft · Max Albrecht', links: [] });
  });
  it('names the spike and release approvals', () => {
    expect(waits({ approvalOwed: 'spike' })?.value).toBe('spike approval');
    expect(waits({ approvalOwed: 'release' })?.value).toBe('release approval');
  });
  it('names an owed approval with the person', () => {
    const cell = waits({ approvalOwed: 'plan', person: 'eins78', personName: 'Max Albrecht' });
    expect(cell).toMatchObject({ value: 'plan approval · Max Albrecht', links: [{ to: 'person', handle: 'eins78' }] });
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

describe('the By cell', () => {
  const placed = (agents: string[], group: 'at-a-gate' | 'being-built' | 'queued' = 'being-built'): ItemPlacement =>
    ({ id: 's', kind: 'slice', section: 'work-items', group, reason: null, agents });
  const base: ItemRowFacts = { plan: 'p', slice: 'w', branch: 'feature/x' };
  const by = (placement: ItemPlacement, facts: ItemRowFacts) => workItemCells(placement, { ...base, ...facts })!.cells.by;

  it('names the first agent with its role, name and every agent linked', () => {
    const cell = by(placed(['a1', 'a2']), {
      agents: [{ id: 'a1', role: 'loop', name: 'feature/x' }, { id: 'a2', role: 'fixer', name: 'agent:fixer:9', attempt: 1 }],
    });
    expect(cell).toMatchObject({ value: 'feature/x', agent: { role: 'loop', attempt: null } });
    expect(cell?.links).toEqual([{ to: 'agent', id: 'a1' }, { to: 'agent', id: 'a2' }]);
  });

  it('writes a fixer attempt against the budget constant, never the Correction budget key', () => {
    const cell = by(placed(['f']), { agents: [{ id: 'f', role: 'fixer', name: 'agent:fixer:3', attempt: 1 }] });
    expect(cell?.agent).toEqual({ role: 'fixer', attempt: `1/${FIXER_ATTEMPTS_BUDGET}` });
    expect(cell?.agent?.attempt).toBe('1/2');
  });

  it('takes the role from the reading, not from the id', () => {
    const cell = by(placed(['fixer-x']), { agents: [{ id: 'fixer-x', role: 'loop', name: 'fixer-x' }] });
    expect(cell?.agent?.role).toBe('loop');
  });

  it('shows no attempt where the run carries none', () => {
    const cell = by(placed(['f']), { agents: [{ id: 'f', role: 'fixer', name: 'n' }] });
    expect(cell?.agent).toEqual({ role: 'fixer', attempt: null });
  });

  it('gives a person no chip', () => {
    const person = { value: 'eins78', links: [{ to: 'person', handle: 'eins78' }] } as const;
    const cell = workByCell({ ...person, links: [...person.links] }, [], { ...base, person: 'eins78', agents: [{ id: 'a1', role: 'loop', name: 'n' }] });
    expect(cell).toEqual(person);
  });

  it('keeps the plain id where the agent\'s facts were not read', () => {
    const cell = by(placed(['a1']), {});
    expect(cell).toMatchObject({ value: 'a1' });
    expect(cell?.agent).toBeUndefined();
  });

  it('leaves itemRowCells\' by plain for the other sections', () => {
    const cells = itemRowCells(placed(['a1']), { ...base, agents: [{ id: 'a1', role: 'loop', name: 'n' }] });
    expect(cells?.by?.agent).toBeUndefined();
    expect(cells?.by?.value).toBe('a1');
  });
});
