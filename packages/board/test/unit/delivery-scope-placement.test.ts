// The My sprint scope narrows You and Work items and leaves Fleet and Tickets as they are.
import { describe, it, expect } from 'vitest';
import { deliveryScope, parsePersonDirectory, placeDelivery, rowInSprintSelection } from '@plot-pm/domain';
import type { AgentRow } from '../../src/contract/schema.js';
import { deliveryMapping, type DeliveryMapInput, type RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';

const reader = { hostUser: 'me', directory: parsePersonDirectory('me = Me; them = Them') };
const sprints = [{ slug: 'alpha', ownerHandle: 'me' }, { slug: 'beta', ownerHandle: 'them' }];
const membership = new Map([['alpha', new Set(['plan-a'])], ['beta', new Set(['plan-b'])]]);

const row = (branch: string, plan: string): AgentRow => ({
  branch, plan, wave: 'w', kind: 'branch', phase: 'Development', planState: 'approved', state: 'wip', group: 'not-started',
  pr: null, question: null, blockedBy: null, assignee: '', author: '', approver: '',
}) as unknown as AgentRow;
const rows = [row('feature/a', 'plan-a'), row('feature/b', 'plan-b')];
const agents = [{ session: 's', branch: 'fix/x', state: 'running', pid: 1 }] as unknown as RegistryAgent[];
const tickets = [{
  kind: 'ticket', number: '7', title: 'Ticket 7', url: '', ageMinutes: 1,
  status: 'open', statusCategory: 'To Do', assignees: ['me'],
}] as unknown as NonNullable<DeliveryMapInput['tickets']>;

// The rows AgentList.tsx hands the mapping: every row in the release scope, the
// scope's rows in the my-sprint scope.
const placeIn = (selected: string[]) => {
  const scope = deliveryScope(selected, reader, sprints);
  const scoped = scope.kind === 'my-sprint'
    ? rows.filter((r) => rowInSprintSelection(r, [...scope.selection], membership))
    : rows;
  const m = deliveryMapping({
    rows: scoped, slices: [], agents, drafts: [], reader, mode: 'all',
    config: { autoReview: true, correctionBudget: 2 },
    tickets, ticketSource: { service: 'github', match: 'host-login' },
  });
  return placeDelivery(m.readings, m.input);
};

describe('the Delivery scope over the placement', () => {
  const off = placeIn([]);
  const on = placeIn(['alpha']);

  it('narrows You and Work items to the owned sprint', () => {
    const plans = (p: typeof on) => p.items.map((i) => i.id.split(/[:\0]/)[1]).sort();
    expect(plans(off)).toEqual(['plan-a', 'plan-b']);
    expect(plans(on)).toEqual(['plan-a']);
  });

  it('leaves Fleet and Tickets unscoped', () => {
    expect(on.agents).toEqual(off.agents);
    expect(on.agents.length).toBe(1);
    expect(on.tickets).toEqual(off.tickets);
    expect(on.tickets.length).toBe(1);
  });
});
