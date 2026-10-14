import { describe, expect, it } from 'vitest';
import { groupTicketLanes, type TicketSourceRow } from '../../src/server/ticket-lanes.js';

const now = Date.parse('2026-10-14T12:00:00Z');
const row = (number: string, closedAt: string | null): TicketSourceRow => ({
  number, title: `t${number}`, url: `https://x/${number}`, createdAt: '2026-09-01T00:00:00Z',
  status: closedAt ? 'closed' : 'open', statusCategory: '', closedAt,
});

describe('groupTicketLanes', () => {
  it('lanes a ticket closed 3 days ago as Done with the archived toggle off', () => {
    const lanes = groupTicketLanes([row('1', null)], [row('2', '2026-10-11T12:00:00Z')], new Set(), false, false, now);
    expect(lanes.done.map((r) => r.id)).toEqual(['2']);
    expect(lanes.open.map((r) => r.id)).toEqual(['1']);
  });

  it('leaves a ticket closed 30 days ago out of Done with the toggle off', () => {
    const lanes = groupTicketLanes([], [row('3', '2026-09-14T12:00:00Z')], new Set(), false, false, now);
    expect(lanes.done).toEqual([]);
  });

  it('lanes the recent closed ticket as Done with the toggle on too', () => {
    const lanes = groupTicketLanes([], [row('2', '2026-10-11T12:00:00Z')], new Set(), false, true, now);
    expect(lanes.done.map((r) => r.id)).toEqual(['2']);
  });
});
