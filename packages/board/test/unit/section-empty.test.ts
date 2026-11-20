import { describe, it, expect } from 'vitest';
import type { DeliveryMine } from '@plot-pm/domain';
import type { MachineHealth } from '@plot-pm/domain/rules/machine-health';
import {
  deliveryEmpties,
  offersScopeOff,
  sectionEmptyKind,
  type EmptyScope,
} from '../../src/app/lib/agent-rows/section-empty.js';
import { sectionHiddenCounts, type DeliveryView } from '../../src/app/lib/agent-rows/delivery-view.js';
import type { Supervisor } from '../../src/contract/schema.js';

const RELEASE: EmptyScope = { kind: 'release', sprints: [] };
const ONE_SPRINT: EmptyScope = { kind: 'my-sprint', sprints: ['Sprint A'] };
const TWO_SPRINTS: EmptyScope = { kind: 'my-sprint', sprints: ['Sprint A', 'Sprint B'] };

const supervisor = (state: Supervisor['state'], detail = ''): Supervisor =>
  ({ state, prominence: 'quiet', shown: true, label: state, detail });

const health = (word: string, line = '', rows: MachineHealth['rows'] = []): MachineHealth =>
  ({ dot: 'grey', word, line, rows });

const you = (over: Partial<{ count: number; unread: number; issueAnswer: 'answered' | 'failed' | 'unsupported' | null; issueNote: string | null; scope: EmptyScope; mine: DeliveryMine; hidden: number }> = {}) =>
  sectionEmptyKind({ section: 'you', count: 0, unread: 0, issueAnswer: 'answered', issueNote: null, scope: RELEASE, mine: 'off', hidden: 0, ...over });

const workItems = (over: Partial<{ count: number; unread: number; scope: EmptyScope; mine: DeliveryMine; hidden: number }> = {}) =>
  sectionEmptyKind({ section: 'work-items', count: 0, unread: 0, scope: RELEASE, mine: 'off', hidden: 0, ...over });

const fleet = (over: Partial<{ count: number; unread: number; supervisor: Supervisor | null; mine: DeliveryMine; hidden: number }> = {}) =>
  sectionEmptyKind({ section: 'fleet', count: 0, unread: 0, supervisor: supervisor('up'), mine: 'off', hidden: 0, ...over });

const tickets = (over: Partial<{ state: 'rows' | 'failed' | 'unsupported' | 'unasked'; count: number; note: string | null; absence: string | null; scope: EmptyScope; mine: DeliveryMine; hidden: number }> = {}) =>
  sectionEmptyKind({ section: 'tickets', state: 'rows', count: 0, note: null, absence: null, scope: RELEASE, mine: 'off', hidden: 0, ...over });

describe('sectionEmptyKind — the table', () => {
  it('Release delivery with no plan is clear', () => {
    expect(sectionEmptyKind({ section: 'release-delivery', count: 0, scope: RELEASE }))
      .toEqual({ kind: 'clear', sentence: 'No approved plan belongs to a release or sprint yet.', note: null, hidden: null });
  });

  it('You with nothing is clear', () => {
    expect(you()).toEqual({ kind: 'clear', sentence: 'Nothing waits on you.', note: null, hidden: null });
  });

  it('You with a failed tracker read is unread, and its note is the failure', () => {
    expect(you({ issueAnswer: 'failed', issueNote: 'gh: 503 Service Unavailable' }))
      .toEqual({ kind: 'unread', sentence: 'The tracker gave no answer.', note: 'gh: 503 Service Unavailable', hidden: null });
  });

  it('Work items with nothing is clear', () => {
    expect(workItems()).toEqual({ kind: 'clear', sentence: 'No work item is at a gate, being built or queued.', note: null, hidden: null });
  });

  it('Fleet up with no agent is clear', () => {
    expect(fleet()).toEqual({ kind: 'clear', sentence: 'No agent runs.', note: null, hidden: null });
  });

  it('Fleet down is stopped', () => {
    expect(fleet({ supervisor: supervisor('down') })).toEqual({ kind: 'stopped', sentence: 'The fleet is not running.', note: null, hidden: null });
  });

  it('Fleet died is stopped and names the detail', () => {
    expect(fleet({ supervisor: supervisor('died', 'exit 1 after a start') }))
      .toEqual({ kind: 'stopped', sentence: 'The fleet stopped unexpectedly.', note: 'exit 1 after a start', hidden: null });
  });

  it('Fleet unknown is stopped, never clear', () => {
    expect(fleet({ supervisor: supervisor('unknown', 'no summary line') })?.kind).toBe('stopped');
  });

  it('Fleet with no supervisor reading is stopped, never clear', () => {
    expect(fleet({ supervisor: null })?.kind).toBe('stopped');
  });

  it('Machine unmeasured is stopped and says "not measured"', () => {
    const empty = sectionEmptyKind({ section: 'machine', headroom: 'unmeasured', health: health('not measured') });
    expect(empty?.kind).toBe('stopped');
    expect(empty?.sentence).toContain('not measured');
    expect(empty?.hidden).toBeNull();
  });

  it('Machine measured shows its meters', () => {
    expect(sectionEmptyKind({ section: 'machine', headroom: 'clear', health: health('healthy', 'load 1.2') })).toBeNull();
  });

  it('Tickets with no row is clear', () => {
    expect(tickets()).toEqual({ kind: 'clear', sentence: 'No ticket waits for a plan.', note: null, hidden: null });
  });

  it('Tickets failed is unread, and its note is the failure', () => {
    expect(tickets({ state: 'failed', note: 'rate limit, resets in 8 min' }))
      .toEqual({ kind: 'unread', sentence: 'The tracker gave no answer.', note: 'rate limit, resets in 8 min', hidden: null });
  });

  it('Tickets unsupported is stopped, and its note is the absence', () => {
    const absence = 'the git host `bitbucket` has no issue list to read';
    expect(tickets({ state: 'unsupported', absence }))
      .toEqual({ kind: 'stopped', sentence: 'The tracker cannot be read here.', note: absence, hidden: null });
  });

  it('Tickets unasked is unread, with no note', () => {
    expect(tickets({ state: 'unasked' })).toEqual({ kind: 'unread', sentence: 'The tracker has not been read yet.', note: null, hidden: null });
  });
});

describe('sectionEmptyKind — a section with rows', () => {
  it('answers null for every section with rows', () => {
    expect(sectionEmptyKind({ section: 'release-delivery', count: 1, scope: RELEASE })).toBeNull();
    expect(you({ count: 1, unread: 2, issueAnswer: 'failed' })).toBeNull();
    expect(workItems({ count: 3, unread: 1 })).toBeNull();
    expect(fleet({ count: 2, supervisor: supervisor('down') })).toBeNull();
    expect(tickets({ count: 4 })).toBeNull();
  });
});

describe('sectionEmptyKind — an unread reading', () => {
  it('items in Not placed make You and Work items unread, never clear', () => {
    expect(you({ unread: 2 })).toEqual({ kind: 'unread', sentence: '2 not read.', note: null, hidden: null });
    expect(workItems({ unread: 1 })).toEqual({ kind: 'unread', sentence: '1 not read.', note: null, hidden: null });
  });

  it('agents in Not placed make an up Fleet unread', () => {
    expect(fleet({ unread: 3 })).toEqual({ kind: 'unread', sentence: '3 not read.', note: null, hidden: null });
  });
});

describe('sectionEmptyKind — scope and Mine', () => {
  const cells: { scope: EmptyScope; mine: DeliveryMine; suffix: string; hidden: number | null }[] = [
    { scope: RELEASE, mine: 'off', suffix: '.', hidden: null },
    { scope: RELEASE, mine: 'mine', suffix: '.', hidden: 2 },
    { scope: RELEASE, mine: 'strict', suffix: '.', hidden: 2 },
    { scope: ONE_SPRINT, mine: 'off', suffix: ' in my sprint · Sprint A.', hidden: null },
    { scope: ONE_SPRINT, mine: 'mine', suffix: ' in my sprint · Sprint A.', hidden: 2 },
    { scope: TWO_SPRINTS, mine: 'strict', suffix: ' in my sprints · Sprint A, Sprint B.', hidden: 2 },
  ];

  for (const cell of cells) {
    it(`${cell.scope.kind} × ${cell.mine} names the scope and the Mine-hidden count`, () => {
      const at = { scope: cell.scope, mine: cell.mine, hidden: 2 };
      expect(you(at)).toEqual({ kind: 'clear', sentence: `Nothing waits on you${cell.suffix}`, note: null, hidden: cell.hidden });
      expect(workItems(at)).toEqual({ kind: 'clear', sentence: `No work item is at a gate, being built or queued${cell.suffix}`, note: null, hidden: cell.hidden });
      expect(tickets(at)).toEqual({ kind: 'clear', sentence: `No ticket waits for a plan${cell.suffix}`, note: null, hidden: cell.hidden });
    });
  }

  it('Release delivery names the scope in both scope kinds', () => {
    expect(sectionEmptyKind({ section: 'release-delivery', count: 0, scope: RELEASE })?.sentence)
      .toBe('No approved plan belongs to a release or sprint yet.');
    expect(sectionEmptyKind({ section: 'release-delivery', count: 0, scope: ONE_SPRINT })?.sentence)
      .toBe('No approved plan belongs to a release or sprint yet in my sprint · Sprint A.');
  });

  it('Fleet never names the scope', () => {
    expect(fleet({ mine: 'mine', hidden: 1 })).toEqual({ kind: 'clear', sentence: 'No agent runs.', note: null, hidden: 1 });
  });

  it('Mine off reports no hidden count, whatever the inbox hides', () => {
    // `waiting.hidden` counts tickets the server did not match to the reader; Mine off hides none.
    expect(tickets({ mine: 'off', hidden: 3 })?.hidden).toBeNull();
  });

  it('offers the scope button under my-sprint, except for Fleet and Machine', () => {
    expect(offersScopeOff('you', 'my-sprint')).toBe(true);
    expect(offersScopeOff('tickets', 'my-sprint')).toBe(true);
    expect(offersScopeOff('release-delivery', 'my-sprint')).toBe(true);
    expect(offersScopeOff('fleet', 'my-sprint')).toBe(false);
    expect(offersScopeOff('machine', 'my-sprint')).toBe(false);
    expect(offersScopeOff('you', 'release')).toBe(false);
  });
});

describe('deliveryEmpties', () => {
  const view = (over: Partial<Pick<DeliveryView, 'sections' | 'notPlaced' | 'releasePlanCount'>> = {}) =>
    ({ sections: [], notPlaced: [], releasePlanCount: 0, ...over }) as Pick<DeliveryView, 'sections' | 'notPlaced' | 'releasePlanCount'>;
  const context = {
    hidden: { you: 0, 'work-items': 0, fleet: 0, tickets: 0 },
    scope: RELEASE,
    mine: 'off' as DeliveryMine,
    issueAnswer: 'answered' as const,
    issueNote: null,
    supervisor: supervisor('up'),
    headroom: 'clear' as const,
    health: health('healthy', 'load 1.0'),
  };

  it('counts unread items for You and Work items, and unread agents for Fleet', () => {
    const notPlaced = [
      { id: 'a', subject: 'item', reason: 'unread', label: '', note: '', rows: [] },
      { id: 'b', subject: 'agent', reason: 'unread', label: '', note: '', rows: [] },
      { id: 'c', subject: 'item', reason: 'filtered', label: '', note: '', rows: [] },
    ] as unknown as DeliveryView['notPlaced'];
    const empties = deliveryEmpties(view({ notPlaced }), context);
    expect(empties.you?.sentence).toBe('1 not read.');
    expect(empties['work-items']?.sentence).toBe('1 not read.');
    expect(empties.fleet?.sentence).toBe('1 not read.');
    expect(empties.machine).toBeNull();
  });

  it('answers null for a section the view holds rows in', () => {
    const sections = [{ key: 'you', count: 2 }] as unknown as DeliveryView['sections'];
    const empties = deliveryEmpties(view({ sections, releasePlanCount: 1 }), context);
    expect(empties.you).toBeNull();
    expect(empties['release-delivery']).toBeNull();
    expect(empties['work-items']?.kind).toBe('clear');
  });
});

describe('sectionHiddenCounts', () => {
  const base = { shown: [], whole: [], agents: { total: 0, kept: 0 }, tickets: { before: 0, after: 0 } };

  it('You counts the whole placement items under You that are not shown', () => {
    const counts = sectionHiddenCounts({
      ...base,
      shown: [{ id: 'i1', section: 'you' }],
      whole: [{ id: 'i1', section: 'you' }, { id: 'i2', section: 'you' }, { id: 'i3', section: 'work-items' }],
    });
    expect(counts.you).toBe(1);
  });

  it('Work items counts the whole placement items under Work items that are not shown', () => {
    const counts = sectionHiddenCounts({
      ...base,
      shown: [],
      whole: [{ id: 'i1', section: 'work-items' }, { id: 'i2', section: 'work-items' }, { id: 'i3', section: 'you' }],
    });
    expect(counts['work-items']).toBe(2);
  });

  it('Fleet counts the agents Mine dropped', () => {
    expect(sectionHiddenCounts({ ...base, agents: { total: 5, kept: 2 } }).fleet).toBe(3);
    expect(sectionHiddenCounts({ ...base, agents: { total: 1, kept: 2 } }).fleet).toBe(0);
  });

  it('Tickets counts the tickets the reader narrowing dropped', () => {
    expect(sectionHiddenCounts({ ...base, tickets: { before: 4, after: 1 } }).tickets).toBe(3);
    expect(sectionHiddenCounts({ ...base, tickets: { before: 0, after: 1 } }).tickets).toBe(0);
  });
});
