import { describe, it, expect } from 'vitest';
import {
  agentsForReader, ownedFromTicket, readMineStrict, rowsForReader, ticketPlanOwners, ticketsForReader, writeMineStrict,
  type PlanOwners,
} from '../../src/app/lib/agent-rows/mine-filter.js';
import { deliveryMapping, sliceItemId, ticketItemId, type DeliveryMapInput, type RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';
import type { AgentRow, IssueRow, TicketLaneRow, TicketSourceShape } from '../../src/contract/schema.js';
import { lanesForReader, ownership, parsePersonDirectory, placeDelivery, type MineMode, type Reader } from '@plot-pm/domain';

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

describe('the lenient Mine mode reads a row\'s own arm and its plan\'s arm', () => {
  const me: Reader = { hostUser: 'jwloka', directory: parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht') };
  const MODES: readonly MineMode[] = ['all', 'mine-and-unknown', 'mine'];
  const mineOf = (assignee: string): PlanOwners => ({ assignee, author: '', approver: '' });

  const branchRow = (branch: string, prAuthor: string, plan: PlanOwners): AgentRow => ({
    branch, plan: 'p', wave: branch, kind: 'branch', phase: 'Development', planState: 'approved', state: 'wip', group: 'working',
    worker: 'running', question: null, blockedBy: null,
    pr: { number: branch.length, author: prAuthor, state: 'pending', open: true, ciChecks: 'pending' },
    ...plan,
  }) as unknown as AgentRow;

  // Three cases the brief names, and a fourth: another person's PR on a plan
  // that names nobody, which the plan arm must leave `theirs`.
  const rowCases = [
    { name: 'a PR of another person on a plan of the reader', row: branchRow('a', 'eins78', mineOf('jwloka')), keep: { all: true, 'mine-and-unknown': true, mine: false } },
    { name: 'a PR of the reader on a plan of another person', row: branchRow('b', 'jwloka', mineOf('eins78')), keep: { all: true, 'mine-and-unknown': true, mine: true } },
    { name: 'a PR of unknown owner on a plan of unknown owner', row: branchRow('c', '', mineOf('')), keep: { all: true, 'mine-and-unknown': true, mine: false } },
    { name: 'a PR of another person on a plan that names nobody', row: branchRow('d', 'eins78', mineOf('')), keep: { all: true, 'mine-and-unknown': false, mine: false } },
  ] as const;

  describe('rowsForReader', () => {
    for (const c of rowCases) {
      for (const mode of MODES) {
        it(`${c.keep[mode] ? 'keeps' : 'hides'} ${c.name} in the mode ${mode}`, () => {
          expect(rowsForReader([c.row], me, mode)).toEqual(c.keep[mode] ? [c.row] : []);
        });
      }
    }

    it('returns the array itself in the mode all', () => {
      const rows = rowCases.map((c) => c.row);
      expect(rowsForReader(rows, me, 'all')).toBe(rows);
    });
  });

  describe('deliveryMapping, through MINE to the DeliveryMine word', () => {
    const shownIds = (rows: AgentRow[], mode: MineMode): string[] => {
      const m = deliveryMapping({
        rows, slices: [], agents: [], drafts: [], reader: me, mode, config: { autoReview: true, correctionBudget: 2 },
      });
      return placeDelivery(m.readings, m.input).items.map((i) => i.id);
    };
    for (const c of rowCases) {
      for (const mode of MODES) {
        it(`${c.keep[mode] ? 'keeps' : 'drops'} ${c.name} in the mode ${mode}`, () => {
          const id = sliceItemId('p', c.row.wave);
          if (c.keep[mode]) expect(shownIds([c.row], mode)).toContain(id);
          else expect(shownIds([c.row], mode)).not.toContain(id);
        });
      }
    }
  });

  describe('agentsForReader, joined to the row its branch names', () => {
    const agentOn = (branch: string, state: string): RegistryAgent =>
      ({ session: 's', branch, state, identity: 'declared', pid: 1 }) as unknown as RegistryAgent;
    const rowByBranch = new Map<string, PlanOwners>([
      ['feature/ours', mineOf('jwloka')],
      ['feature/theirs', mineOf('eins78')],
      ['feature/nobodys', mineOf('')],
    ]);
    // The agent arm answers `mine` for a desk on this machine and `unknown`
    // for `elsewhere`; it never answers `theirs`.
    const agentCases = [
      { name: 'an agent elsewhere on a plan of the reader', agent: agentOn('feature/ours', 'elsewhere'), keep: { all: true, 'mine-and-unknown': true, mine: false } },
      { name: 'an agent of the reader on a plan of another person', agent: agentOn('feature/theirs', 'running'), keep: { all: true, 'mine-and-unknown': true, mine: true } },
      { name: 'an agent elsewhere on a plan of unknown owner', agent: agentOn('feature/nobodys', 'elsewhere'), keep: { all: true, 'mine-and-unknown': true, mine: false } },
      { name: 'an agent elsewhere on a plan of another person', agent: agentOn('feature/theirs', 'elsewhere'), keep: { all: true, 'mine-and-unknown': false, mine: false } },
      { name: 'an agent elsewhere whose branch joins no row', agent: agentOn('feature/unjoined', 'elsewhere'), keep: { all: true, 'mine-and-unknown': true, mine: false } },
    ] as const;
    for (const c of agentCases) {
      for (const mode of MODES) {
        it(`${c.keep[mode] ? 'keeps' : 'hides'} ${c.name} in the mode ${mode}`, () => {
          expect(agentsForReader([c.agent], me, mode, rowByBranch)).toEqual(c.keep[mode] ? [c.agent] : []);
        });
      }
    }

    it('returns the array itself in the mode all', () => {
      const agents = agentCases.map((c) => c.agent);
      expect(agentsForReader(agents, me, 'all', rowByBranch)).toBe(agents);
    });
  });

  describe('ticketsForReader and the ticket reading mineAllows reads', () => {
    const plans = {
      ours: { file: '2026-ours.md', issues: ['11'] },
      theirs: { file: '2026-theirs.md', issues: ['12', '14'] },
      nobodys: { file: '2026-nobodys.md', issues: ['13'] },
    };
    const cards: Record<string, PlanOwners> = {
      '2026-ours.md': mineOf('jwloka'), '2026-theirs.md': mineOf('eins78'), '2026-nobodys.md': mineOf(''),
    };
    const planOwners = ticketPlanOwners(plans, (file) => cards[file]);
    // `ticketsForReader` keeps its lenient answer in the strict mode; the
    // Delivery ticket reading keeps the assignees' arm alone there.
    const ticketCases = [
      { name: 'a ticket of another person on a plan of the reader', t: ticket({ number: '#11', assignees: ['eins78'] }), tickets: { all: true, 'mine-and-unknown': true, mine: true }, delivery: { all: true, 'mine-and-unknown': true, mine: false } },
      { name: 'a ticket of the reader on a plan of another person', t: ticket({ number: '12', assignees: ['jwloka'] }), tickets: { all: true, 'mine-and-unknown': true, mine: true }, delivery: { all: true, 'mine-and-unknown': true, mine: true } },
      { name: 'a ticket of unknown owner on a plan of unknown owner', t: ticket({ number: '13', assignees: [] }), tickets: { all: true, 'mine-and-unknown': true, mine: true }, delivery: { all: true, 'mine-and-unknown': true, mine: false } },
      { name: 'a ticket of another person on a plan of another person', t: ticket({ number: '14', assignees: ['eins78'] }), tickets: { all: true, 'mine-and-unknown': false, mine: false }, delivery: { all: true, 'mine-and-unknown': false, mine: false } },
    ] as const;

    for (const c of ticketCases) {
      for (const mode of MODES) {
        it(`ticketsForReader ${c.tickets[mode] ? 'keeps' : 'hides'} ${c.name} in the mode ${mode}`, () => {
          expect(ticketsForReader([c.t], me, hostLoginSource, mode, planOwners)).toEqual(c.tickets[mode] ? [c.t] : []);
        });

        it(`the Delivery Tickets section ${c.delivery[mode] ? 'shows' : 'filters'} ${c.name} in the mode ${mode}`, () => {
          const m = deliveryMapping({
            rows: [], slices: [], agents: [], drafts: [], reader: me, mode, config: { autoReview: true, correctionBudget: 2 },
            tickets: [c.t], ticketSource: hostLoginSource, ticketPlans: planOwners,
          } satisfies DeliveryMapInput);
          const ids = placeDelivery(m.readings, m.input).tickets.map((t) => t.id);
          expect(ids).toEqual(c.delivery[mode] ? [ticketItemId(c.t.number)] : []);
        });
      }
    }

    it('hides a ticket of another person on the reader\'s plan where no plan map is given, as before', () => {
      expect(ticketsForReader([ticketCases[0].t], me, hostLoginSource, 'mine-and-unknown')).toEqual([]);
    });

    it('returns the array itself in the mode all', () => {
      const tickets = ticketCases.map((c) => c.t);
      expect(ticketsForReader(tickets, me, hostLoginSource, 'all', planOwners)).toBe(tickets);
    });

    it('adds no owner for a plan whose card was not read', () => {
      expect(ticketPlanOwners(plans, () => null).size).toBe(0);
    });
  });
});
