import { describe, it, expect } from 'vitest';
import { SHOW_EVERY_TICKET_LABEL, waitingView } from '../../src/app/lib/agent-rows/waiting-view.js';
import type { FleetWaiting, IssueRow } from '../../src/contract/schema.js';

const ticket = (number: string, assignees: string[] = []): IssueRow => ({
  kind: 'ticket',
  number,
  title: `Ticket ${number}`,
  url: '',
  ageMinutes: null,
  status: '',
  statusCategory: '',
  assignees,
});

const waitingOf = (over: Partial<FleetWaiting> = {}): FleetWaiting => ({
  tickets: [],
  shown: 0,
  hidden: 0,
  complete: true,
  notice: null,
  source: null,
  ...over,
});

const keep = (tickets: IssueRow[]): IssueRow[] => tickets;

describe('waitingView', () => {
  it('renders issues with no sentence and no control where the server sent no waiting', () => {
    const issues = [ticket('1'), ticket('2')];
    for (const waiting of [undefined, null]) {
      expect(waitingView(waiting, issues, false, keep)).toEqual({
        tickets: issues,
        hidden: null,
        notice: null,
        control: null,
        showing: null,
      });
    }
  });

  it('renders waiting.tickets, the hidden-count sentence and the control by default', () => {
    const mine = ticket('9', ['gardener']);
    const view = waitingView(
      waitingOf({ tickets: [mine], shown: 1, hidden: 126 }),
      [ticket('1'), mine],
      false,
      keep,
    );
    expect(view.tickets).toEqual([mine]);
    expect(view.hidden).toBe('126 open tickets are not assigned to you');
    expect(view.control).toBe(SHOW_EVERY_TICKET_LABEL);
    expect(view.showing).toBeNull();
    expect(view.notice).toBeNull();
  });

  it('writes at least into the hidden-count sentence when the read is not complete', () => {
    const view = waitingView(waitingOf({ hidden: 997, complete: false }), [], false, keep);
    expect(view.hidden).toBe('at least 997 open tickets are not assigned to you');
  });

  it('shows no sentence and no control where nothing is hidden', () => {
    const view = waitingView(waitingOf({ tickets: [ticket('1')], shown: 1 }), [ticket('1')], false, keep);
    expect(view.hidden).toBeNull();
    expect(view.control).toBeNull();
  });

  it('carries the notice through', () => {
    const view = waitingView(waitingOf({ notice: 'No login.' }), [], false, keep);
    expect(view.notice).toBe('No login.');
  });

  it('renders issues plus the waiting tickets issues lacks, and says N of M, with the control on', () => {
    const old = ticket('99', ['gardener']);
    const issues = [ticket('1'), ticket('2')];
    const view = waitingView(
      waitingOf({ tickets: [old, ticket('1')], shown: 2, hidden: 125 }),
      issues,
      true,
      keep,
    );
    expect(view.tickets.map((t) => t.number)).toEqual(['1', '2', '99']);
    expect(view.showing).toBe('Showing 3 of 127 open tickets.');
    expect(view.hidden).toBeNull();
    expect(view.control).toBe(SHOW_EVERY_TICKET_LABEL);
  });

  it('keeps the unassigned newest tickets beside the older assigned one with the control on and no narrowing', () => {
    const mine = ticket('127', ['gardener']);
    const newest = Array.from({ length: 50 }, (_, i) => ticket(String(i + 1)));
    const view = waitingView(waitingOf({ tickets: [mine], shown: 1, hidden: 126 }), newest, true, keep);
    expect(view.tickets.map((t) => t.number)).toEqual([...newest.map((t) => t.number), '127']);
    expect(view.tickets.map((t) => t.number)).toContain('1');
    expect(view.showing).toBe('Showing 51 of 127 open tickets.');
  });

  it('keeps the control while it is on even when nothing is hidden', () => {
    const view = waitingView(waitingOf({ shown: 1 }), [ticket('1')], true, keep);
    expect(view.control).toBe(SHOW_EVERY_TICKET_LABEL);
    expect(view.showing).toBe('Showing 1 of 1 open tickets.');
  });

  it('writes at least into the showing sentence when the read is not complete', () => {
    const view = waitingView(waitingOf({ hidden: 996, shown: 1, complete: false }), [ticket('1')], true, keep);
    expect(view.showing).toBe('Showing 1 of at least 997 open tickets.');
  });

  it('applies the reader narrowing last and counts what it leaves', () => {
    const theirs = ticket('2', ['neighbour']);
    const narrow = (tickets: IssueRow[]): IssueRow[] => tickets.filter((t) => t.number !== '2');
    const view = waitingView(waitingOf({ shown: 0, hidden: 2 }), [ticket('1'), theirs], true, narrow);
    expect(view.tickets.map((t) => t.number)).toEqual(['1']);
    expect(view.showing).toBe('Showing 1 of 2 open tickets.');
  });
});
