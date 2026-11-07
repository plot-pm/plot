import { describe, expect, it } from 'vitest';
import { CardFactsSchema, type Known, type Ref } from '../src/entities/card-facts.js';
import { ticketCardFacts } from '../src/rules/ticket-card-facts.js';
import type { TicketLane } from '../src/rules/ticket-lane.js';
import type { TicketLaneRow } from '../src/rules/ticket-lanes.js';
import type { TicketPlan } from '../src/rules/ticket-phase.js';

const row = (over: Partial<TicketLaneRow> = {}): TicketLaneRow => ({
  id: '3102',
  title: 'Create plan offered twice',
  url: 'https://github.com/plot-pm/plot/issues/3102',
  createdAt: '2026-10-14T12:00:00.000Z',
  body: null,
  status: 'Open',
  statusCategory: 'To Do',
  closedAt: null,
  type: null,
  owner: null,
  assignees: [],
  source: null,
  ...over,
});

const plan = (over: Partial<TicketPlan> = {}): TicketPlan => ({
  slug: 'fix-it', title: 'Fix it', story: '', state: 'approved', total: 4, merged: 1, ...over,
});

const story = (slug: string, over: Partial<Extract<Ref, { kind: 'story' }>> = {}): Ref => ({
  kind: 'story', slug, title: slug, status: 'active', archived: false, ...over,
});

const facts = (over: {
  lane?: TicketLane; row?: TicketLaneRow; plans?: Known<readonly TicketPlan[]>; stories?: Known<readonly Ref[]>;
} = {}) => {
  const out = ticketCardFacts({
    row: over.row ?? row(),
    lane: over.lane ?? 'open',
    plans: over.plans ?? { value: [] },
    stories: over.stories ?? { value: [] },
  });
  expect(CardFactsSchema.safeParse(out).success).toBe(true);
  return out;
};

describe('ticketCardFacts next', () => {
  it('offers Create plan first and Create story second for a bare ticket', () => {
    const { next } = facts();
    expect(next.primary).toEqual({ action: 'create-plan', enabled: true, reason: null });
    expect(next.secondary).toEqual([{ action: 'create-story', enabled: true, reason: null }]);
  });

  it('offers no Create plan to a ticket whose plan sits in Development, in the open lane (#3102)', () => {
    const { next } = facts({ lane: 'open', plans: { value: [plan()] } });
    expect(next.primary?.action).not.toBe('create-plan');
    expect(next.secondary.map((a) => a.action)).not.toContain('create-plan');
  });

  it('offers Create story alone to a ticket with a plan and no story', () => {
    const { next } = facts({ plans: { value: [plan()] } });
    expect(next).toEqual({ primary: { action: 'create-story', enabled: true, reason: null }, secondary: [] });
  });

  it('offers nothing to a ticket with a plan and a story', () => {
    const { next } = facts({ plans: { value: [plan()] }, stories: { value: [story('s')] } });
    expect(next).toEqual({ primary: null, secondary: [] });
  });

  it('offers Create plan alone, inside the story, for one live story and no plan', () => {
    const { next } = facts({ stories: { value: [story('s')] } });
    expect(next).toEqual({ primary: { action: 'create-plan', enabled: true, reason: null }, secondary: [] });
  });

  it('disables Create plan naming both live stories for a ticket in two', () => {
    const two = [story('a'), story('b')];
    const { next } = facts({ stories: { value: two } });
    expect(next.primary).toEqual({
      action: 'create-plan', enabled: false, reason: { kind: 'linked-from-many-stories', stories: two },
    });
    expect(next.secondary).toEqual([]);
  });

  it('offers Create plan outside any story where the only stories are done or archived', () => {
    const dead = [story('d', { status: 'done' }), story('x', { archived: true })];
    const { next } = facts({ stories: { value: dead } });
    expect(next).toEqual({ primary: { action: 'create-plan', enabled: true, reason: null }, secondary: [] });
  });

  it('counts only the live stories of a ticket that also has a done one', () => {
    const { next } = facts({ stories: { value: [story('a'), story('d', { status: 'done' })] } });
    expect(next.primary).toEqual({ action: 'create-plan', enabled: true, reason: null });
  });

  it('ignores a rejected or superseded plan', () => {
    const { next } = facts({ plans: { value: [plan({ state: 'rejected' }), plan({ state: 'superseded' })] } });
    expect(next.primary?.action).toBe('create-plan');
  });

  it.each(['done', 'hidden'] as const)('offers nothing in the %s lane', (lane) => {
    expect(facts({ lane }).next).toEqual({ primary: null, secondary: [] });
  });

  it('disables Create plan with lineage-unknown where the plans are unread, never enabling it', () => {
    const { next } = facts({ plans: { unknown: 'failed' } });
    expect(next.primary).toEqual({
      action: 'create-plan', enabled: false, reason: { kind: 'lineage-unknown', relation: 'plans', reach: 'failed' },
    });
    expect(next.secondary).toEqual([]);
  });

  it('disables Create plan with lineage-unknown where the stories are unread and no plan exists', () => {
    const { next } = facts({ stories: { unknown: 'throttled' } });
    expect(next.primary).toEqual({
      action: 'create-plan', enabled: false, reason: { kind: 'lineage-unknown', relation: 'stories', reach: 'throttled' },
    });
  });

  it('offers nothing for a planned ticket whose stories are unread', () => {
    expect(facts({ plans: { value: [plan()] }, stories: { unknown: 'failed' } }).next).toEqual({ primary: null, secondary: [] });
  });
});

describe('ticketCardFacts lineage and progress', () => {
  it('reads unknown, never an empty list, for unread plans and stories', () => {
    const out = facts({ plans: { unknown: 'throttled' }, stories: { unknown: 'failed' } });
    expect(out.lineage.plans).toEqual({ unknown: 'throttled' });
    expect(out.lineage.stories).toEqual({ unknown: 'failed' });
    expect(out.progress.work).toBeNull();
  });

  it('reads an empty list for plans and stories that were read and found none', () => {
    const out = facts();
    expect(out.lineage.plans).toEqual({ value: [] });
    expect(out.lineage.stories).toEqual({ value: [] });
  });

  it('carries the plan as a ref and its slices as the work', () => {
    const out = facts({ plans: { value: [plan()] } });
    expect(out.lineage.plans).toEqual({ value: [{ kind: 'plan', slug: 'fix-it', key: '3102', title: 'Fix it', status: 'in-progress' }] });
    expect(out.progress.work).toEqual({ unit: 'slices', done: { value: 1 }, total: 4 });
  });

  it('reads a plan with no merged-PR reading as unknown slice progress', () => {
    const out = facts({ plans: { value: [plan({ merged: null })] } });
    expect(out.progress.work).toEqual({ unit: 'slices', done: { unknown: 'unasked' }, total: 4 });
  });

  it('counts two plans in plans, done being Delivered or Released', () => {
    const out = facts({ plans: { value: [plan({ state: 'released' }), plan({ slug: 'b', state: 'delivered' }), plan({ slug: 'c' })] } });
    expect(out.progress.work).toEqual({ unit: 'plans', done: { value: 2 }, total: 3 });
  });

  it('carries the lane as state, the opened date and the resolved assignee', () => {
    const out = facts({ lane: 'in-progress', row: row({ assignees: ['jwloka'] }) });
    expect(out.progress.state).toEqual({ value: { kind: 'ticket', lane: 'in-progress' } });
    expect(out.ownership.since).toEqual({ at: '2026-10-14', event: 'opened' });
    expect(out.ownership.assignees).toEqual({ value: ['jwloka'] });
  });

  it('opens the ticket itself', () => {
    expect(facts().identity.opens).toEqual({ kind: 'ticket', key: '3102', title: 'Create plan offered twice', lane: 'open' });
  });
});
