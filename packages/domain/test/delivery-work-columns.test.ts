import { describe, it, expect } from 'vitest';
import { placeDelivery, type ItemPlacement, type WorkItemReading } from '../src/rules/delivery-placement.js';
import { FIXER_ATTEMPTS_BUDGET } from '../src/rules/fixer-attempts.js';
import { itemRowCells, workByCell, type ItemRowFacts } from '../src/rules/delivery-row-form.js';
import {
  WORK_GROUP_VALUE,
  WORK_ITEM_COLUMNS,
  WORK_ITEM_COLUMN_LABELS,
  oldestWaitsClause,
  workGroupCountText,
  workItemCells,
  workItemPills,
} from '../src/rules/delivery-work-columns.js';
import type { StatusPill } from '../src/rules/status-pill.js';

const slice = (group: 'at-a-gate' | 'being-built' | 'queued', agents: string[] = []): ItemPlacement =>
  ({ id: `slice:${group}`, kind: 'slice', section: 'work-items', group, reason: null, agents });

const pills = (group: 'at-a-gate' | 'being-built' | 'queued', facts: ItemRowFacts, agents: string[] = []): StatusPill[] =>
  workItemPills(slice(group, agents), { plan: 'p', branch: 'feature/x', ...facts }, null)!;

describe('the Work items columns', () => {
  it('are one grid for every group, with no kind and no where column', () => {
    expect([...WORK_ITEM_COLUMNS]).toEqual(['item', 'plan', 'status', 'by', 'age', 'menu']);
    expect(WORK_ITEM_COLUMNS).not.toContain('kind');
    expect(WORK_ITEM_COLUMNS).not.toContain('where');
    expect(WORK_ITEM_COLUMNS.map((c) => WORK_ITEM_COLUMN_LABELS[c])).toEqual(['Item', 'Plan', 'Status', 'By', 'Age', 'Actions']);
  });

  it('give every group one value kind for its pills', () => {
    expect(WORK_GROUP_VALUE).toEqual({ 'at-a-gate': 'gate', 'being-built': 'progress', queued: 'wait' });
  });

  it('put the status pills and the By cell in the cells', () => {
    const out = workItemCells(slice('being-built', ['a1']), { plan: 'p', pr: 4 })!;
    expect(out).toMatchObject({ group: 'being-built', holds: 'progress' });
    expect(Object.keys(out.cells)).toEqual(['status', 'by']);
    expect(out.cells.status.map((p) => p.word)).toEqual(['PR open']);
  });

  it('give a plan item cells too, where it has no row shape', () => {
    const out = workItemCells({ ...slice('queued'), kind: 'plan' }, { plan: 'p', phase: 'draft', person: 'eins78' })!;
    expect(out.cells.status).toEqual([{ word: 'plan in Draft', tone: 'amber', href: null }]);
    expect(out.cells.by).toEqual({ value: 'eins78', links: [{ to: 'person', handle: 'eins78' }] });
  });

  it.each([
    [{ approvalOwed: 'plan', person: 'eins78', personName: 'Max Albrecht' }, { value: 'Max Albrecht', links: [{ to: 'person', handle: 'eins78' }] }],
    [{ person: 'eins78' }, null],
    [{ phase: 'design' }, null],
    [{}, null],
  ] as const)('name the person in By only where the item waits on them: %o', (facts, by) => {
    expect(workItemCells(slice('queued'), { plan: 'p', ...facts })!.cells.by).toEqual(by);
  });

  it('return nothing for an item outside Work items', () => {
    expect(workItemCells({ ...slice('queued'), section: 'fleet' } as never, {})).toBeNull();
    expect(workItemPills({ ...slice('queued'), section: 'fleet' } as never, {}, null)).toBeNull();
  });
});

describe('the gate pills', () => {
  it('keep each gate\'s link and read each outcome, with a link and without one', () => {
    expect(pills('at-a-gate', { pr: 4, prReading: { ci: 'failed', review: 'none' } })).toEqual([
      { word: 'CI failed', tone: 'red', href: { to: 'checks', pr: 4 } },
      { word: 'review not asked', tone: 'grey', href: null },
    ]);
  });

  it('link both gates to their own pages', () => {
    expect(pills('at-a-gate', { pr: 4, prReading: { ci: 'passed', review: 'high' } })).toEqual([
      { word: 'CI passed', tone: 'green', href: { to: 'checks', pr: 4 } },
      { word: 'review failed', tone: 'red', href: { to: 'review', pr: 4 } },
    ]);
  });

  it.each([
    ['running', 'unread', [{ word: 'CI running', tone: 'amber', href: { to: 'checks', pr: 4 } }]],
    ['unread', 'pending', [{ word: 'review running', tone: 'amber', href: { to: 'review', pr: 4 } }]],
    ['unread', 'passed', [{ word: 'review passed', tone: 'green', href: { to: 'review', pr: 4 } }]],
  ] as const)('read CI %s and review %s', (ci, review, expected) => {
    expect(pills('at-a-gate', { pr: 4, prReading: { ci, review } })).toEqual(expected);
  });

  it('link nothing where the PR number is unknown', () => {
    expect(pills('at-a-gate', { prReading: { ci: 'passed', review: 'passed' } }).map((p) => p.href)).toEqual([null, null]);
  });

  it('read gates unread where no gate was read, never an empty list', () => {
    expect(pills('at-a-gate', {})).toEqual([{ word: 'gates unread', tone: 'grey', href: null }]);
    expect(pills('at-a-gate', { prReading: { ci: 'unread', review: 'unread' } })).toEqual([{ word: 'gates unread', tone: 'grey', href: null }]);
  });

  it('leave the You rows their single status string', () => {
    const you: ItemPlacement = { id: 's', kind: 'slice', section: 'you', group: 'blocks-delivery', marker: 'blocks-delivery', reason: 'review-pr', agents: [] };
    expect(itemRowCells(you, { pr: 4, prReading: { ci: 'passed', review: 'high' } })!.status?.value).toBe('review · CI ✓');
  });
});

describe('the progress pills', () => {
  it('read no PR yet where the item has no open PR', () => {
    expect(pills('being-built', {})).toEqual([{ word: 'no PR yet', tone: 'grey', href: null }]);
  });

  it('read PR open, linked to the PR', () => {
    expect(pills('being-built', { pr: 4 })).toEqual([{ word: 'PR open', tone: 'blue', href: { to: 'pr', pr: 4 } }]);
  });

  it('name the unpushed count in whole words', () => {
    expect(pills('being-built', { pr: 4, unpushed: 2 }).map((p) => p.word)).toEqual(['PR open', '2 unpushed commits']);
    expect(pills('being-built', { unpushed: 1 })[1]).toEqual({ word: '1 unpushed commit', tone: 'amber', href: null });
  });

  it.each([[0], [undefined]])('print no count for a pushed or unread branch (%s)', (unpushed) => {
    expect(pills('being-built', { pr: 4, ...(unpushed === undefined ? {} : { unpushed }) })).toHaveLength(1);
  });
});

describe('the wait pills', () => {
  it('read no agent assigned where nothing is waited on and no agent acts', () => {
    expect(pills('queued', {})).toEqual([{ word: 'no agent assigned', tone: 'grey', href: null }]);
  });

  it('read agent assigned where an agent acts and nothing is read', () => {
    expect(pills('queued', {}, ['a1'])).toEqual([{ word: 'agent assigned', tone: 'grey', href: null }]);
  });

  it('name the earlier slice, linked', () => {
    expect(pills('queued', { waitsOn: 'first' })).toEqual([{ word: 'waits on first', tone: 'grey', href: { to: 'slice', id: 'first' } }]);
  });

  it('read an earlier slice where the server names none', () => {
    expect(pills('queued', { waitsOn: '' })).toEqual([{ word: 'waits on an earlier slice', tone: 'grey', href: null }]);
  });

  it.each([
    [{ approvalOwed: 'plan' }, 'plan approval'],
    [{ approvalOwed: 'spike' }, 'spike approval'],
    [{ approvalOwed: 'release' }, 'release approval'],
    [{ phase: 'draft' }, 'plan in Draft'],
    [{ phase: 'design' }, 'plan in Design'],
  ] as const)('name %o as %s and never the person', (facts, word) => {
    const out = pills('queued', { ...facts, person: 'eins78', personName: 'Max Albrecht' });
    expect(out).toEqual([{ word, tone: 'amber', href: null }]);
    expect(out.map((p) => p.word).join(' ')).not.toMatch(/eins78|Max/);
  });

  it('read a claim with no work as claimed <age> ago, no work committed', () => {
    expect(pills('queued', { claim: { elsewhere: false }, ageMinutes: 2 * 24 * 60 + 5 })).toEqual([
      { word: 'claimed 2 days ago, no work committed', tone: 'amber', href: null },
    ]);
    expect(pills('queued', { claim: { elsewhere: false }, ageMinutes: 90 })[0].word).toBe('claimed 1 hour ago, no work committed');
    expect(pills('queued', { claim: { elsewhere: false } })[0].word).toBe('claimed, no work committed');
  });

  it('add the quiet claimed on another machine pill where the claim is held elsewhere', () => {
    expect(pills('queued', { claim: { elsewhere: true }, ageMinutes: 30 })).toEqual([
      { word: 'claimed 30 minutes ago, no work committed', tone: 'amber', href: null },
      { word: 'claimed on another machine', tone: 'quiet', href: null },
    ]);
  });
});

describe('the no sprint pill', () => {
  it('is grey and last, in every group', () => {
    for (const group of ['at-a-gate', 'being-built', 'queued'] as const) {
      const out = workItemPills(slice(group), { pr: 4 }, 'no sprint')!;
      expect(out.at(-1)).toEqual({ word: 'no sprint', tone: 'grey', href: null });
    }
  });

  it('is absent where the item is in a sprint', () => {
    expect(workItemPills(slice('queued'), {}, null)!.map((p) => p.word)).not.toContain('no sprint');
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

  it('stays null where the row has no By cell', () => {
    expect(workByCell(null, ['a1'], { agents: [{ id: 'a1', role: 'loop', name: 'n' }] })).toBeNull();
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
