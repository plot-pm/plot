import { describe, expect, it } from 'vitest';
import type { Issue } from '../src/entities/issue.js';
import { DONE_LANE_LIMIT, doneTickets, ticketLane, type TicketLaneReading } from '../src/rules/ticket-lane.js';

const NOW = Date.parse('2026-10-13T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const issueWith = (over: Partial<Issue> = {}): Issue => ({
  id: '1',
  title: 'A ticket',
  url: '',
  createdAt: null,
  body: null,
  status: '',
  statusCategory: '',
  closedAt: null,
  assignees: [],
  ...over,
});

const reading = (over: Partial<TicketLaneReading> = {}): TicketLaneReading => ({
  categoryStated: true,
  namedByPlan: false,
  ...over,
});

describe('ticketLane', () => {
  it('reads Open for a category stated To Do', () => {
    const issue = issueWith({ statusCategory: 'To Do' });
    expect(ticketLane(issue, reading(), NOW)).toBe('open');
  });

  it('reads In progress for a category stated In Progress', () => {
    const issue = issueWith({ statusCategory: 'In Progress' });
    expect(ticketLane(issue, reading(), NOW)).toBe('in-progress');
  });

  it('reads Done for a category stated Done closed within 14 days', () => {
    const issue = issueWith({ statusCategory: 'Done', closedAt: new Date(NOW - 2 * DAY_MS).toISOString() });
    expect(ticketLane(issue, reading(), NOW)).toBe('done');
  });

  it('reads hidden for a category stated Done with no closedAt (WONTFIX)', () => {
    const issue = issueWith({ statusCategory: 'Done', closedAt: null });
    expect(ticketLane(issue, reading(), NOW)).toBe('hidden');
  });

  it('reads hidden for a category stated Done closed more than 14 days ago', () => {
    const issue = issueWith({ statusCategory: 'Done', closedAt: new Date(NOW - 20 * DAY_MS).toISOString() });
    expect(ticketLane(issue, reading(), NOW)).toBe('hidden');
  });

  it('reads Open for no stated category, open, not named by a plan', () => {
    const issue = issueWith({ statusCategory: 'To Do', closedAt: null });
    expect(ticketLane(issue, reading({ categoryStated: false, namedByPlan: false }), NOW)).toBe('open');
  });

  it('reads In progress for no stated category, open, named by a plan', () => {
    const issue = issueWith({ statusCategory: 'To Do', closedAt: null });
    expect(ticketLane(issue, reading({ categoryStated: false, namedByPlan: true }), NOW)).toBe('in-progress');
  });

  it('reads Done for no stated category, closed within 14 days', () => {
    const issue = issueWith({ statusCategory: 'Done', closedAt: new Date(NOW - DAY_MS).toISOString() });
    expect(ticketLane(issue, reading({ categoryStated: false }), NOW)).toBe('done');
  });

  it('reads hidden for no stated category, closed more than 14 days ago', () => {
    const issue = issueWith({ statusCategory: 'Done', closedAt: new Date(NOW - 15 * DAY_MS).toISOString() });
    expect(ticketLane(issue, reading({ categoryStated: false }), NOW)).toBe('hidden');
  });

  it('reads In progress for an open GitHub issue named by a plan although its derived category is To Do', () => {
    // GitHub/Bitbucket derive `statusCategory` from the state asked for, so an
    // open issue's derived category reads "To Do" — categoryStated must be
    // false for this source, and namedByPlan must win instead.
    const issue = issueWith({ statusCategory: 'To Do', closedAt: null });
    expect(ticketLane(issue, reading({ categoryStated: false, namedByPlan: true }), NOW)).toBe('in-progress');
  });

  it('reads hidden for a closedAt the tracker could not parse as a date', () => {
    const issue = issueWith({ statusCategory: 'Done', closedAt: 'not-a-date' });
    expect(ticketLane(issue, reading(), NOW)).toBe('hidden');
  });
});

describe('doneTickets', () => {
  it('orders newest closedAt first', () => {
    const rows = [
      { closedAt: new Date(NOW - 5 * DAY_MS).toISOString() },
      { closedAt: new Date(NOW - DAY_MS).toISOString() },
      { closedAt: new Date(NOW - 10 * DAY_MS).toISOString() },
    ];
    const result = doneTickets(rows);
    expect(result.rows.map((r) => r.closedAt)).toEqual([rows[1]!.closedAt, rows[0]!.closedAt, rows[2]!.closedAt]);
  });

  it('sorts a null closedAt last, never first or by insertion order', () => {
    const rows = [
      { closedAt: null },
      { closedAt: new Date(NOW - DAY_MS).toISOString() },
    ];
    const result = doneTickets(rows);
    expect(result.rows[0]!.closedAt).not.toBeNull();
    expect(result.rows[1]!.closedAt).toBeNull();
  });

  it('sorts a null closedAt last when it appears after a dated row', () => {
    const rows = [
      { closedAt: new Date(NOW - DAY_MS).toISOString() },
      { closedAt: null },
    ];
    const result = doneTickets(rows);
    expect(result.rows[0]!.closedAt).not.toBeNull();
    expect(result.rows[1]!.closedAt).toBeNull();
  });

  it('keeps two null closedAt rows together when both are null', () => {
    const rows = [{ closedAt: null }, { closedAt: null }];
    const result = doneTickets(rows);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.closedAt === null)).toBe(true);
  });

  it('caps at DONE_LANE_LIMIT and counts the rest, 25 rows answering 20 + 5', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      closedAt: new Date(NOW - i * DAY_MS).toISOString(),
    }));
    const result = doneTickets(rows);
    expect(result.rows).toHaveLength(DONE_LANE_LIMIT);
    expect(result.moreCount).toBe(5);
  });

  it('reports no more rows when under the cap', () => {
    const rows = [{ closedAt: new Date(NOW).toISOString() }];
    expect(doneTickets(rows).moreCount).toBe(0);
  });
});
