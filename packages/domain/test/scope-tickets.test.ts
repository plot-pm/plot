import { describe, it, expect } from 'vitest';
import {
  NO_TICKET_ROW_REASON, PLAN_NAMED_REASON, SCOPE_INCOMPLETE, scopePlanSlugs, scopeTickets, ticketIsMine,
  type ScopeTicketCard, type ScopeTicketRow, type ScopeTicketsInput,
} from '../src/rules/scope-tickets.js';
import { reviewIssueTitle } from '../src/rules/review-issue.js';
import type { TicketSource } from '../src/rules/ownership.js';

const HOST: TicketSource = { service: 'github', match: 'host-login' };
const ME = { hostUser: 'me' };

const card = (over: Partial<ScopeTicketCard> & { slug: string }): ScopeTicketCard =>
  ({ issues: [], prs: [], refutedIssues: [], ...over });

const row = (over: Partial<ScopeTicketRow> & { number: string }): ScopeTicketRow =>
  ({ title: `ticket ${over.number}`, url: `https://host/issues/${over.number}`, state: 'open', complete: true, assignees: [], ...over });

const input = (over: Partial<ScopeTicketsInput<ScopeTicketRow>> = {}): ScopeTicketsInput<ScopeTicketRow> => ({
  sprints: [{ members: [{ slug: 'a' }, { slug: 'b' }] }],
  cards: [],
  rows: [],
  ticketPlans: {},
  waiting: null,
  answer: 'answered',
  reader: ME,
  source: HOST,
  mine: 'off',
  ticketHref: (key) => `https://host/issues/${key}`,
  ...over,
});

describe('scopePlanSlugs', () => {
  it('leaves out the deferred tier and an empty slug', () => {
    const slugs = scopePlanSlugs([{ members: [{ slug: 'a' }, { slug: 'b', tier: 'deferred' }, { slug: '' }] }, { members: [{ slug: 'c', tier: 'must' }] }]);
    expect([...slugs]).toEqual(['a', 'c']);
  });
});

describe('ticketIsMine', () => {
  it('keeps every ticket under off', () => {
    expect(ticketIsMine({ assignees: ['bob'] }, HOST, [], ME, 'off')).toBe(true);
  });

  it('keeps an unassigned ticket under mine and hides it under strict', () => {
    expect(ticketIsMine({ assignees: [] }, HOST, [], ME, 'mine')).toBe(true);
    expect(ticketIsMine({ assignees: [] }, HOST, [], ME, 'strict')).toBe(false);
  });

  it('keeps another person\'s ticket under mine where the reader owns the plan', () => {
    expect(ticketIsMine({ assignees: ['bob'] }, HOST, [], ME, 'mine')).toBe(false);
    expect(ticketIsMine({ assignees: ['bob'] }, HOST, [{ author: 'me' }], ME, 'mine')).toBe(true);
  });

  it('reads the assignees alone under strict', () => {
    expect(ticketIsMine({ assignees: ['bob'] }, HOST, [{ author: 'me' }], ME, 'strict')).toBe(false);
    expect(ticketIsMine({ assignees: ['me'] }, HOST, [], ME, 'strict')).toBe(true);
  });
});

describe('scopeTickets — Delivered by the sprint', () => {
  it('shows one row per ticket and scope plan, with the plan\'s phase', () => {
    const out = scopeTickets(input({
      cards: [card({ slug: 'a', issues: ['#7'] }), card({ slug: 'b', issues: ['7'] }), card({ slug: 'z', issues: ['9'] })],
      rows: [row({ number: '7', state: 'closed' })],
      ticketPlans: { '7': [{ slug: 'a', title: 'A', story: '', state: 'delivered', total: 1, merged: 1 }, { slug: 'b', title: 'B', story: '', state: 'draft', total: 0, merged: null }] },
    }));
    expect(out.delivered.rows.map((r) => [r.key, r.plan, r.phase, r.ticketState])).toEqual([['7', 'a', 'delivered', 'closed'], ['7', 'b', 'planning', 'closed']]);
    expect(out.delivered.count).toBe(2);
    expect(out.delivered.rows.map((r) => r.stateText)).toEqual(['delivered · closed', 'planning · closed']);
    expect(out.delivered.heading).toBe('Delivered by the sprint · 2');
    expect(out.delivered.rows[0]!.menu.createPlan).toEqual({ kind: 'disabled', reason: PLAN_NAMED_REASON, code: 'plan-named' });
    expect(out.delivered.rows[0]!.menu.createStory).toEqual({ kind: 'tickets' });
    expect(out.delivered.rows[0]!.menu.openOnHost).toEqual({ href: 'https://host/issues/7', reason: null });
  });

  it('shows a key the rows lack as key and plan, with no state word', () => {
    const out = scopeTickets(input({ cards: [card({ slug: 'a', issues: ['PROJ-1'] })] }));
    const [only] = out.delivered.rows;
    expect(only).toMatchObject({ key: 'PROJ-1', issue: null, ticketState: null, phase: null, stateText: '' });
    expect(only!.menu.createStory).toEqual({ kind: 'disabled', reason: NO_TICKET_ROW_REASON });
    expect(only!.menu.openOnHost).toEqual({ href: 'https://host/issues/PROJ-1', reason: null });
  });

  it('disables Open on host where no address resolves for a key-only row', () => {
    const out = scopeTickets(input({ cards: [card({ slug: 'a', issues: ['PROJ-1'] })], ticketHref: () => undefined }));
    expect(out.delivered.rows[0]!.menu.openOnHost.reason).not.toBeNull();
  });

  it('leaves out a deferred member\'s plan', () => {
    const out = scopeTickets(input({ sprints: [{ members: [{ slug: 'a', tier: 'deferred' }] }], cards: [card({ slug: 'a', issues: ['7'] })] }));
    expect(out.delivered.rows).toEqual([]);
    expect(out.delivered.empty).toBe('— none');
  });
});

describe('scopeTickets — Found during the sprint', () => {
  it('finds the open review finding of a scope plan\'s PR and leaves one on a PR outside the scope', () => {
    const out = scopeTickets(input({
      cards: [card({ slug: 'a', prs: [12] }), card({ slug: 'z', prs: [13] })],
      rows: [row({ number: '40', title: reviewIssueTitle(12) }), row({ number: '41', title: reviewIssueTitle(13) })],
    }));
    expect(out.found.rows.map((r) => [r.key, r.kind, r.plan, r.pr])).toEqual([['40', 'review-finding', 'a', 12]]);
    expect([...out.findingKeys]).toEqual(['40']);
  });

  it('omits a closed refuted key and shows a missing one as key and plan', () => {
    const out = scopeTickets(input({
      cards: [card({ slug: 'a', refutedIssues: ['#50', '51', '52'] })],
      rows: [row({ number: '50', state: 'closed' }), row({ number: '51' })],
    }));
    expect(out.found.rows.map((r) => [r.key, r.kind, r.ticketState])).toEqual([['51', 'verification-finding', 'open'], ['52', 'verification-finding', null]]);
  });

  it('disables Create plan with plan-named on a finding a scope plan also names', () => {
    const out = scopeTickets(input({ cards: [card({ slug: 'a', issues: ['51'], refutedIssues: ['51'] })], rows: [row({ number: '51' })] }));
    expect(out.found.rows[0]!.menu.createPlan).toMatchObject({ code: 'plan-named' });
  });

  it('follows the Tickets rule for Create plan on a finding no scope plan names', () => {
    const out = scopeTickets(input({ cards: [card({ slug: 'a', refutedIssues: ['51'] })], rows: [row({ number: '51' })] }));
    expect(out.found.rows[0]!.menu.createPlan).toEqual({ kind: 'tickets' });
  });

  it('disables Create plan and Create story on a key-only finding', () => {
    const out = scopeTickets(input({ cards: [card({ slug: 'a', refutedIssues: ['52'] })] }));
    expect(out.found.rows[0]!.menu.createPlan).toEqual({ kind: 'disabled', reason: NO_TICKET_ROW_REASON });
    expect(out.found.rows[0]!.menu.createStory).toEqual({ kind: 'disabled', reason: NO_TICKET_ROW_REASON });
  });
});

describe('scopeTickets — an unread tracker', () => {
  for (const answer of ['failed', 'unsupported', null] as const) {
    it(`shows delivered and verification keys as key and plan, and no count, for ${String(answer)}`, () => {
      const out = scopeTickets(input({
        answer,
        cards: [card({ slug: 'a', issues: ['7'], prs: [12], refutedIssues: ['50'] })],
        rows: [row({ number: '7' }), row({ number: '40', title: reviewIssueTitle(12) }), row({ number: '50', state: 'closed' })],
      }));
      expect(out.delivered.rows.map((r) => [r.key, r.issue])).toEqual([['7', null]]);
      expect(out.found.rows.map((r) => [r.key, r.kind])).toEqual([['50', 'verification-finding']]);
      expect(out.delivered.count).toBeNull();
      expect(out.found.count).toBeNull();
      expect(out.found.heading).toBe('Found during the sprint · ?');
      expect(out.found.unread).toBe(true);
      expect(out.found.incomplete).toBeNull();
    });
  }
});

describe('scopeTickets — Mine', () => {
  it('hides another person\'s ticket and says how many Mine hides', () => {
    const out = scopeTickets(input({ mine: 'strict', cards: [card({ slug: 'a', issues: ['7'] })], rows: [row({ number: '7', assignees: ['bob'] })] }));
    expect(out.delivered.rows).toEqual([]);
    expect(out.delivered.hiddenByMine).toBe(1);
    expect(out.delivered.empty).toBe('— none · 1 hidden by Mine');
    expect(out.delivered.count).toBe(0);
  });

  it('takes the finding keys before Mine', () => {
    const out = scopeTickets(input({ mine: 'strict', cards: [card({ slug: 'a', refutedIssues: ['51'] })], rows: [row({ number: '51', assignees: ['bob'] })] }));
    expect(out.found.rows).toEqual([]);
    expect([...out.findingKeys]).toEqual(['51']);
  });
});

describe('scopeTickets — the no-plan counts and the incomplete read', () => {
  it('subtracts the finding keys from the hidden counts', () => {
    const out = scopeTickets(input({
      cards: [card({ slug: 'a', refutedIssues: ['51', '52'] })],
      rows: [row({ number: '51' }), row({ number: '52' })],
      waiting: { unassigned: 3, assignedToOthers: 2, complete: true, unassignedKeys: ['51', '60', '61'], assignedToOthersKeys: ['#52', '62'] },
    }));
    expect(out.noPlan).toEqual({ unassigned: 2, assignedToOthers: 1, hidden: 3 });
  });

  it('keeps the counts where an older server sends no keys', () => {
    const out = scopeTickets(input({ cards: [card({ slug: 'a', refutedIssues: ['51'] })], waiting: { unassigned: 3, assignedToOthers: 2, complete: true, unassignedKeys: [], assignedToOthersKeys: [] } }));
    expect(out.noPlan).toEqual({ unassigned: 3, assignedToOthers: 2, hidden: 5 });
  });

  it('names an incomplete read on an answered tracker', () => {
    const out = scopeTickets(input({ rows: [row({ number: '7', complete: false })] }));
    expect(out.delivered.incomplete).toBe(SCOPE_INCOMPLETE);
    expect(out.found.incomplete).toBe(SCOPE_INCOMPLETE);
  });

  it('reads completeness from the waiting read where no row exists', () => {
    const out = scopeTickets(input({ waiting: { unassigned: 0, assignedToOthers: 0, complete: false, unassignedKeys: [], assignedToOthersKeys: [] } }));
    expect(out.delivered.incomplete).toBe(SCOPE_INCOMPLETE);
  });
});

describe('scopeTickets — the Mine cells', () => {
  const cards = [
    card({ slug: 'mine-plan', author: 'me', issues: ['1', 'K-2'], refutedIssues: ['3'] }),
    card({ slug: 'their-plan', author: 'bob', issues: ['4'] }),
  ];
  const rows = [row({ number: '1', assignees: ['bob'] }), row({ number: '3' }), row({ number: '4', assignees: ['me'] })];
  const shown = (mine: 'off' | 'mine' | 'strict', sprints: ScopeTicketsInput<ScopeTicketRow>['sprints']) => {
    const out = scopeTickets(input({ mine, cards, rows, sprints }));
    return { delivered: out.delivered.rows.map((r) => r.key), found: out.found.rows.map((r) => r.key) };
  };
  const release = [{ members: [{ slug: 'mine-plan' }] }, { members: [{ slug: 'their-plan' }] }];
  const mySprint = [{ members: [{ slug: 'mine-plan' }] }];

  it('shows another\'s ticket on my plan, an unassigned finding on my plan and a key-only ticket on my plan under mine', () => {
    expect(shown('mine', release)).toEqual({ delivered: ['1', 'K-2', '4'], found: ['3'] });
  });

  it('keeps only my own ticket on another\'s plan under strict', () => {
    expect(shown('strict', release)).toEqual({ delivered: ['4'], found: [] });
  });

  it('shows every scope row under off', () => {
    expect(shown('off', release)).toEqual({ delivered: ['1', 'K-2', '4'], found: ['3'] });
  });

  it('never widens a narrower scope', () => {
    expect(shown('off', mySprint)).toEqual({ delivered: ['1', 'K-2'], found: ['3'] });
    expect(shown('mine', mySprint)).toEqual({ delivered: ['1', 'K-2'], found: ['3'] });
    expect(shown('strict', mySprint)).toEqual({ delivered: [], found: [] });
  });
});
