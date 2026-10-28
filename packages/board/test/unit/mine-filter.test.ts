import { describe, it, expect } from 'vitest';
import { ticketsForReader, ownedFromTicket, readMineStrict, writeMineStrict } from '../../src/app/lib/agent-rows/mine-filter.js';
import type { IssueRow, TicketLaneRow, TicketSourceShape } from '../../src/contract/schema.js';
import { lanesForReader, ownership, type Reader } from '@plot-pm/domain';

/**
 * `ticketsForReader` is a thin wrapper around the lenient
 * `ownership(...) !== 'theirs'` test over `OwnedRow`'s `ticket` arm — this
 * file asserts the wrapping, not `ticketOwnership` itself, which
 * `packages/domain/test/ownership.test.ts` already covers.
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

// CONTRACT CHANGE (feature/mine-mode-control): `ticketsForReader`'s 4th
// parameter is now the `MineMode` string (`'all' | 'mine-and-unknown' |
// 'mine'`), not a raw boolean. `false` becomes `'all'`; the old `true`
// (lenient «mine» filter) becomes `'mine-and-unknown'`.
describe('ticketsForReader — off returns the array untouched', () => {
  it('returns the same array identity with the filter off', () => {
    const tickets = [ticket()];
    expect(ticketsForReader(tickets, {}, hostLoginSource, 'all')).toBe(tickets);
  });
});

describe('ticketsForReader — on, by host-login assignees', () => {
  const reader: Reader = { hostUser: 'jwloka' };

  it('keeps a ticket assigned to the reader', () => {
    const mine = ticket({ assignees: ['jwloka'] });
    expect(ticketsForReader([mine], reader, hostLoginSource, 'mine-and-unknown')).toEqual([mine]);
  });

  it('hides a ticket assigned to somebody else', () => {
    const theirs = ticket({ assignees: ['eins78'] });
    expect(ticketsForReader([theirs], reader, hostLoginSource, 'mine-and-unknown')).toEqual([]);
  });

  it('keeps an unassigned ticket — unknown stays visible, same as rowsForReader', () => {
    const unassigned = ticket({ assignees: [] });
    expect(ticketsForReader([unassigned], reader, hostLoginSource, 'mine-and-unknown')).toEqual([unassigned]);
  });
});

describe('ticketsForReader — a null source cannot be resolved, so nothing is hidden', () => {
  it('keeps every ticket when the board could not resolve how assignees are written', () => {
    const tickets = [ticket({ assignees: ['jwloka'] }), ticket({ assignees: ['eins78'] })];
    expect(ticketsForReader(tickets, { hostUser: 'jwloka' }, null, 'mine-and-unknown')).toEqual(tickets);
  });
});

// CONTRACT CHANGE (feature/mine-mode-control): the plan's "the box wins"
// decision — this ticket box stays lenient (`ownership(...) !== 'theirs'`)
// even in `mine` mode, unlike every other `mine`-mode call site, which
// switches to `isMineStrict`.
describe('ticketsForReader — stays lenient under `mine` mode', () => {
  const reader: Reader = { hostUser: 'jwloka' };

  it('keeps an unassigned ticket even in `mine` mode', () => {
    const unassigned = ticket({ assignees: [] });
    expect(ticketsForReader([unassigned], reader, hostLoginSource, 'mine')).toEqual([unassigned]);
  });

  it('still hides a ticket assigned to somebody else in `mine` mode', () => {
    const theirs = ticket({ assignees: ['eins78'] });
    expect(ticketsForReader([theirs], reader, hostLoginSource, 'mine')).toEqual([]);
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

describe('Discovery and Delivery answer alike for one ticket', () => {
  // Delivery reads a ticket through this file's `ticketsForReader` and
  // `ownedFromTicket`; Discovery reads its lane row through the domain's
  // `lanesForReader`. Both must keep or hide the same ticket.
  const laneRow = (assignees: string[], source: TicketSourceShape | null): TicketLaneRow => ({
    id: '1', title: 'A ticket', url: '', createdAt: null, body: null, status: '', statusCategory: '',
    closedAt: null, type: null, owner: assignees[0] ?? null, assignees, source,
  });
  const discoveryKeeps = (row: TicketLaneRow, reader: Reader): boolean =>
    lanesForReader([], { open: [row], 'in-progress': [], done: [], moreCount: 0 }, reader, 'mine-and-unknown').tickets!.open.rows.length === 1;
  const deliveryKeeps = (assignees: string[], source: TicketSourceShape | null, reader: Reader): boolean =>
    ticketsForReader([ticket({ assignees })], reader, source, 'mine-and-unknown').length === 1;

  const reader: Reader = { hostUser: 'jwloka', directory: {} };
  const cases: Array<[string, string[], TicketSourceShape | null, boolean]> = [
    ['the reader as the second of two assignees, neither declared', ['alice', 'jwloka'], hostLoginSource, true],
    ['the reader as the only assignee', ['jwloka'], hostLoginSource, true],
    ['somebody else as the only assignee', ['alice'], hostLoginSource, false],
    ['no assignee', [], hostLoginSource, true],
    ['a null source', ['alice'], null, true],
  ];

  it.each(cases)('keeps or hides alike for %s', (_name, assignees, source, expected) => {
    expect(ownership(ownedFromTicket(ticket({ assignees }), source), reader) !== 'theirs').toBe(expected);
    expect(deliveryKeeps(assignees, source, reader)).toBe(expected);
    expect(discoveryKeeps(laneRow(assignees, source), reader)).toBe(expected);
  });
});

describe('readMineStrict / writeMineStrict', () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('reads off where the key is absent', () => {
    expect(readMineStrict(store())).toBe(false);
  });

  it('reads back what it wrote', () => {
    const s = store();
    writeMineStrict(true, s);
    expect(readMineStrict(s)).toBe(true);
    writeMineStrict(false, s);
    expect(readMineStrict(s)).toBe(false);
  });

  it('reads off and writes silently where storage throws', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readMineStrict(broken)).toBe(false);
    expect(() => writeMineStrict(true, broken)).not.toThrow();
  });
});
