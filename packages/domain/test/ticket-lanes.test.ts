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
