import { describe, it, expect } from 'vitest';
import { ticketsForReader, ownedFromTicket } from '../../src/app/lib/agent-rows/mine-filter.js';
import type { IssueRow, TicketSourceShape } from '../../src/contract/schema.js';
import type { Reader } from '@plot-pm/domain';

/**
 * `ticketsForReader` is a thin wrapper around `isMine` over `OwnedRow`'s
 * `ticket` arm — this file asserts the wrapping, not `ticketOwnership` itself,
 * which `packages/domain/test/ownership.test.ts` already covers.
 */

const ticket = (overrides: Partial<IssueRow> = {}): IssueRow => ({
  number: '1',
  title: 'A ticket',
  url: '',
  ageMinutes: null,
  status: '',
  statusCategory: '',
  assignees: [],
  ...overrides,
});

const hostLoginSource: TicketSourceShape = { service: 'github', match: 'host-login' };

describe('ticketsForReader — off returns the array untouched', () => {
  it('returns the same array identity with the filter off', () => {
    const tickets = [ticket()];
    expect(ticketsForReader(tickets, {}, hostLoginSource, false)).toBe(tickets);
  });
});

describe('ticketsForReader — on, by host-login assignees', () => {
  const reader: Reader = { hostUser: 'jwloka' };

  it('keeps a ticket assigned to the reader', () => {
    const mine = ticket({ assignees: ['jwloka'] });
    expect(ticketsForReader([mine], reader, hostLoginSource, true)).toEqual([mine]);
  });

  it('hides a ticket assigned to somebody else', () => {
    const theirs = ticket({ assignees: ['eins78'] });
    expect(ticketsForReader([theirs], reader, hostLoginSource, true)).toEqual([]);
  });

  it('keeps an unassigned ticket — unknown stays visible, same as rowsForReader', () => {
    const unassigned = ticket({ assignees: [] });
    expect(ticketsForReader([unassigned], reader, hostLoginSource, true)).toEqual([unassigned]);
  });
});

describe('ticketsForReader — a null source cannot be resolved, so nothing is hidden', () => {
  it('keeps every ticket when the board could not resolve how assignees are written', () => {
    const tickets = [ticket({ assignees: ['jwloka'] }), ticket({ assignees: ['eins78'] })];
    expect(ticketsForReader(tickets, { hostUser: 'jwloka' }, null, true)).toEqual(tickets);
  });
});

describe('ownedFromTicket — the ticket arm of OwnedRow', () => {
  it('carries the row\'s assignees and the given source', () => {
    const row = ticket({ assignees: ['jwloka'] });
    expect(ownedFromTicket(row, hostLoginSource)).toEqual({
      kind: 'ticket',
      assignees: ['jwloka'],
      source: hostLoginSource,
    });
  });

  it('carries a null source as null, not as absent', () => {
    const row = ticket({ assignees: [] });
    expect(ownedFromTicket(row, null)).toEqual({ kind: 'ticket', assignees: [], source: null });
  });
});
