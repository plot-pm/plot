import { describe, expect, it } from 'vitest';
import { doneTickets, DONE_LANE_LIMIT } from '../src/rules/ticket-lane.js';
import {
  ticketLanes,
  type TicketLaneGroups,
  type TicketLanesReading,
  type TicketSourceRow,
} from '../src/rules/ticket-lanes.js';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number): string => new Date(NOW - days * DAY_MS).toISOString();

const row = (number: string, over: Partial<TicketSourceRow> = {}): TicketSourceRow => ({
  number,
  title: `t${number}`,
  url: `https://x/${number}`,
  ...over,
});
const closedRow = (number: string, days: number): TicketSourceRow =>
  row(number, { closedAt: ago(days), status: 'closed', createdAt: ago(100) });

const reading = (over: Partial<TicketLanesReading> = {}): TicketLanesReading => ({
  categoryStated: false,
  named: new Set(),
  kept: null,
  ...over,
});
const ids = (rows: readonly { id: string }[] | undefined): string[] => (rows ?? []).map((r) => r.id);

describe('ticketLanes type and owner', () => {
  const lane = (r: TicketSourceRow, over: Partial<TicketLanesReading> = {}) =>
    ticketLanes([r], [], null, reading(over), false, NOW).lanes?.open[0];
  const jira = { service: 'jira', match: 'tracker-account', prefix: 'jira:' } as const;
  const github = { service: 'github', match: 'host-login' } as const;

  it('carries the tracker type lowercased', () => {
    expect(lane(row('1', { type: 'Story' }))?.type).toBe('story');
  });

  it('carries no type where the row has none, or an empty one', () => {
    expect(lane(row('1'))?.type).toBeNull();
    expect(lane(row('1', { type: '' }))?.type).toBeNull();
  });

  it('resolves a Jira account through its jira: spelling', () => {
    const r = row('P-1', { assignees: ['a@x.io'] });
    expect(lane(r, { source: jira, directory: { 'jira:a@x.io': 'jwloka' } })?.owner).toBe('jwloka');
  });

  it('shows an undeclared assignee as written', () => {
    expect(lane(row('1', { assignees: ['Someone-Else'] }), { source: github, directory: {} })?.owner).toBe('Someone-Else');
    expect(lane(row('P-1', { assignees: ['a@x.io'] }), { source: jira, directory: {} })?.owner).toBe('a@x.io');
  });

  it('resolves a host login through the directory', () => {
    expect(lane(row('1', { assignees: ['JWloka'] }), { source: github, directory: { jwloka: 'jan' } })?.owner).toBe('jan');
  });

  it('carries no type where the row states null', () => {
    expect(lane(row('1', { type: null }))?.type).toBeNull();
  });

  it('reads an assignee as written where the reading names no source and no directory', () => {
    expect(lane(row('1', { assignees: ['Alice'] }))?.owner).toBe('Alice');
  });

  it('carries no owner for a null or blank assignee list', () => {
    expect(lane(row('1', { assignees: null }))?.owner).toBeNull();
    expect(lane(row('1', { assignees: ['  '] }))?.owner).toBeNull();
  });

  it('carries no owner where nobody is assigned', () => {
    expect(lane(row('1', { assignees: [] }))?.owner).toBeNull();
    expect(lane(row('1'))?.owner).toBeNull();
  });
});

describe('ticketLanes', () => {
  it('lanes open rows by plan naming and a recent closed row as Done', () => {
    const result = ticketLanes(
      [row('1'), row('2')], [closedRow('3', 3)], null, reading({ named: new Set(['2']) }), false, NOW,
    );
    expect(result.plansUnreadable).toBe(false);
    expect(ids(result.lanes?.open)).toEqual(['1']);
    expect(ids(result.lanes?.['in-progress'])).toEqual(['2']);
    expect(ids(result.lanes?.done)).toEqual(['3']);
  });

  it('maps absent optional fields to empty strings and nulls', () => {
    const result = ticketLanes([row('1', { createdAt: null, status: null, statusCategory: null, closedAt: null })], [], null, reading(), false, NOW);
    expect(result.lanes?.open[0]).toEqual({
      id: '1', title: 't1', url: 'https://x/1', createdAt: null, body: null, status: '', statusCategory: '', closedAt: null,
      type: null, owner: null,
    });
    const bare = ticketLanes([row('2')], [], null, reading(), false, NOW);
    expect(bare.lanes?.open[0]).toMatchObject({ createdAt: null, status: '', statusCategory: '', closedAt: null });
  });

  it('leaves a ticket closed 30 days ago out of every lane with the toggle off', () => {
    const result = ticketLanes([], [closedRow('3', 30)], null, reading(), false, NOW);
    expect(result.lanes).toEqual({ open: [], 'in-progress': [], done: [], moreCount: 0 });
  });

  it('puts a ticket closed 30 days ago in Done with the toggle on', () => {
    const result = ticketLanes([], [closedRow('3', 30)], null, reading(), true, NOW);
    expect(ids(result.lanes?.done)).toEqual(['3']);
  });

  it('puts a stated Done ticket with no closedAt in Done with the toggle on only', () => {
    const stated = reading({ categoryStated: true });
    const undated = row('4', { statusCategory: 'Done' });
    expect(ids(ticketLanes([], [undated], null, stated, false, NOW).lanes?.done)).toEqual([]);
    expect(ids(ticketLanes([], [undated], null, stated, true, NOW).lanes?.done)).toEqual(['4']);
  });

  it('reads the toggle rows in place of the window rows with the toggle on, newest first and uncapped', () => {
    const toggleRows = Array.from({ length: 25 }, (_, i) => closedRow(String(i + 1), 40 + i));
    const on = ticketLanes([], [closedRow('99', 1)], toggleRows, reading(), true, NOW);
    expect(on.lanes?.done).toHaveLength(25);
    expect(on.lanes?.moreCount).toBe(0);
    expect(ids(on.lanes?.done)[0]).toBe('1');
  });

  it('ignores the toggle rows with the toggle off', () => {
    const result = ticketLanes([], [closedRow('99', 1)], [closedRow('1', 40)], reading(), false, NOW);
    expect(ids(result.lanes?.done)).toEqual(['99']);
  });

  it('falls back to the window rows with the toggle on and no toggle read', () => {
    const result = ticketLanes([], [closedRow('99', 1)], null, reading(), true, NOW);
    expect(ids(result.lanes?.done)).toEqual(['99']);
  });

  it('caps Done at the limit with the toggle off and counts the rest', () => {
    const closed = Array.from({ length: DONE_LANE_LIMIT + 3 }, (_, i) => closedRow(String(i + 1), 1 + i * 0.1));
    const result = ticketLanes([], closed, null, reading(), false, NOW);
    expect(result.lanes?.done).toHaveLength(DONE_LANE_LIMIT);
    expect(result.lanes?.moreCount).toBe(3);
  });

  it('lanes a number once when it is in both lists', () => {
    const result = ticketLanes([row('5')], [closedRow('5', 1)], null, reading(), false, NOW);
    expect(ids(result.lanes?.open)).toEqual(['5']);
    expect(result.lanes?.done).toEqual([]);
  });

  it('answers the kept lanes with plansUnreadable where the plans could not be read', () => {
    const kept: TicketLaneGroups = { open: [], 'in-progress': [], done: [], moreCount: 7 };
    const result = ticketLanes([row('1')], [], null, reading({ named: null, kept }), false, NOW);
    expect(result).toEqual({ lanes: kept, plansUnreadable: true });
  });

  it('answers null lanes where the plans could not be read and nothing is kept', () => {
    expect(ticketLanes([row('1')], [], null, reading({ named: null }), false, NOW))
      .toEqual({ lanes: null, plansUnreadable: true });
  });
});

describe('doneTickets expanded', () => {
  it('returns every row ordered with no remainder', () => {
    const rows = Array.from({ length: DONE_LANE_LIMIT + 2 }, (_, i) => ({ closedAt: ago(i + 1) }));
    const result = doneTickets(rows, true);
    expect(result.rows).toHaveLength(DONE_LANE_LIMIT + 2);
    expect(result.moreCount).toBe(0);
  });
});
